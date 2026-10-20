/* uiapi: read-only data for the web UI. Counter ring part. */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <pthread.h>
#include <time.h>

#include "uiapi.h"

/* Code that needs linbpq headers goes inside #ifndef UIAPI_TEST so the
   ring can be built and tested on its own. */

#define UI_NBUCKETS	288
#define UI_BUCKET_SECS	300
#define UI_WINDOW_SECS	(UI_NBUCKETS * UI_BUCKET_SECS)	/* 86400 */
#define UI_FULL_SECS	(UI_WINDOW_SECS - UI_BUCKET_SECS)	/* 86100 */
#define UI_MAXCOUNT	1000000000L
#define UI_MAGIC	"BPQUIC1\n"
#define UI_MAGIC_LEN	8
#define UI_LINE_MAX	128

struct ui_bucket
{
	time_t start;		/* 0 = unused */
	long n[UI_NCOUNTERS];
};

static struct ui_bucket ring[UI_NBUCKETS];
static pthread_mutex_t ring_lock = PTHREAD_MUTEX_INITIALIZER;

static char save_path[1024];
static time_t last_closed;	/* start of the last bucket we saved after */

static time_t bucket_start(time_t t)
{
	return t - (t % UI_BUCKET_SECS);
}

static struct ui_bucket *slot_for(time_t start)
{
	return &ring[(start / UI_BUCKET_SECS) % UI_NBUCKETS];
}

void uiapi_count_at(enum ui_counter c, time_t when)
{
	time_t start;
	struct ui_bucket *b;

	if ((int)c < 0 || c >= UI_NCOUNTERS || when <= 0)
		return;

	start = bucket_start(when);
	pthread_mutex_lock(&ring_lock);
	b = slot_for(start);
	if (b->start != start)
	{
		/* slot held an older bucket (or none): reuse it */
		memset(b, 0, sizeof(*b));
		b->start = start;
	}
	if (b->n[c] < UI_MAXCOUNT)
		b->n[c]++;
	pthread_mutex_unlock(&ring_lock);
}

void uiapi_count(enum ui_counter c)
{
	uiapi_count_at(c, time(NULL));
}

void uiapi_ring_totals(time_t now, long out[UI_NCOUNTERS], time_t *window_start, int *full)
{
	int i, c;
	time_t oldest = 0;

	for (c = 0; c < UI_NCOUNTERS; c++)
		out[c] = 0;

	pthread_mutex_lock(&ring_lock);
	for (i = 0; i < UI_NBUCKETS; i++)
	{
		struct ui_bucket *b = &ring[i];

		if (b->start == 0 || b->start + UI_WINDOW_SECS <= now || b->start > now)
			continue;
		for (c = 0; c < UI_NCOUNTERS; c++)
			out[c] += b->n[c];
		if (oldest == 0 || b->start < oldest)
			oldest = b->start;
	}
	pthread_mutex_unlock(&ring_lock);

	if (window_start)
		*window_start = oldest;
	if (full)
		*full = (oldest != 0 && oldest <= now - UI_FULL_SECS);
}

/* Parse one "start sessions messages frames" line. All fields must be present,
   nothing may follow, and the line must end with a newline. */
static int parse_line(const char *line, long long *start, long n[UI_NCOUNTERS])
{
	char *end;
	long long v;
	int c;
	size_t len = strlen(line);

	if (len == 0 || line[len - 1] != '\n')
		return 0;

	v = strtoll(line, &end, 10);
	if (end == line)
		return 0;
	*start = v;

	for (c = 0; c < UI_NCOUNTERS; c++)
	{
		const char *p = end;
		long long x;

		if (*p != ' ')
			return 0;
		x = strtoll(p, &end, 10);
		if (end == p + 1 || x < 0 || x > UI_MAXCOUNT)
			return 0;
		n[c] = (long)x;
	}
	return *end == '\n' && end[1] == '\0';
}

int uiapi_ring_load(const char *path, time_t now)
{
	FILE *f;
	char line[UI_LINE_MAX];
	static struct ui_bucket tmp[UI_NBUCKETS];	/* protected by ring_lock */
	int kept = 0, lines = 0;

	pthread_mutex_lock(&ring_lock);
	memset(ring, 0, sizeof(ring));
	memset(tmp, 0, sizeof(tmp));

	f = fopen(path, "rb");
	if (f == NULL)
		goto reject;

	if (fread(line, 1, UI_MAGIC_LEN, f) != UI_MAGIC_LEN || memcmp(line, UI_MAGIC, UI_MAGIC_LEN) != 0)
		goto reject;

	while (fgets(line, sizeof(line), f) != NULL)
	{
		long long start;
		long n[UI_NCOUNTERS];
		struct ui_bucket *b;
		int c;

		if (++lines > UI_NBUCKETS)
			goto reject;
		if (!parse_line(line, &start, n))
			goto reject;
		if (start <= 0 || start % UI_BUCKET_SECS != 0)
			goto reject;
		if (start > (long long)now + UI_BUCKET_SECS)
			goto reject;

		/* a bucket that has aged out of the window is dropped, not an error */
		if (start + UI_WINDOW_SECS <= (long long)now)
			continue;

		b = &tmp[(start / UI_BUCKET_SECS) % UI_NBUCKETS];
		if (b->start != 0)
			goto reject;		/* duplicate or colliding start */
		b->start = (time_t)start;
		for (c = 0; c < UI_NCOUNTERS; c++)
			b->n[c] = n[c];
		kept++;
	}
	if (ferror(f))
		goto reject;

	fclose(f);
	memcpy(ring, tmp, sizeof(ring));
	pthread_mutex_unlock(&ring_lock);
	return kept;

reject:
	if (f)
		fclose(f);
	memset(tmp, 0, sizeof(tmp));
	memset(ring, 0, sizeof(ring));
	pthread_mutex_unlock(&ring_lock);
	return -1;
}

int uiapi_ring_save(const char *path)
{
	struct ui_bucket snap[UI_NBUCKETS];
	char tmpname[1100];
	FILE *f;
	int i, ok = 1;

	if (strlen(path) + 5 > sizeof(tmpname))
		return -1;
	snprintf(tmpname, sizeof(tmpname), "%s.tmp", path);

	pthread_mutex_lock(&ring_lock);
	memcpy(snap, ring, sizeof(snap));
	pthread_mutex_unlock(&ring_lock);

	f = fopen(tmpname, "wb");
	if (f == NULL)
		return -1;

	ok = fwrite(UI_MAGIC, 1, UI_MAGIC_LEN, f) == UI_MAGIC_LEN;
	for (i = 0; ok && i < UI_NBUCKETS; i++)
	{
		if (snap[i].start == 0)
			continue;
		ok = fprintf(f, "%lld %ld %ld %ld\n", (long long)snap[i].start,
			snap[i].n[UI_SESSIONS], snap[i].n[UI_MESSAGES], snap[i].n[UI_FRAMES]) > 0;
	}
	if (ok)
		ok = fflush(f) == 0 && fsync(fileno(f)) == 0;
	if (fclose(f) != 0)
		ok = 0;
	if (ok)
		ok = rename(tmpname, path) == 0;
	if (!ok)
	{
		unlink(tmpname);
		return -1;
	}
	return 0;
}

void uiapi_init(const char *bpqdir)
{
	time_t now = time(NULL);

	snprintf(save_path, sizeof(save_path), "%s/uiapi-counters.dat",
		(bpqdir && *bpqdir) ? bpqdir : ".");
	uiapi_ring_load(save_path, now);
	last_closed = bucket_start(now);
}

void uiapi_tick(time_t now)
{
	time_t cur = bucket_start(now);

	if (save_path[0] == 0 || cur == last_closed)
		return;
	/* a bucket just closed */
	last_closed = cur;
	uiapi_ring_save(save_path);
}
