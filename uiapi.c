/* SPDX-License-Identifier: GPL-3.0-or-later
   Copyright (C) 2026 Dennis Mojado */

/* uiapi: read-only data for the web UI: counter ring, event log, CMS state
   and the /api/ui JSON handlers. */

#include <stdio.h>
#include <stdarg.h>
#include <fcntl.h>
#include <sys/types.h>
#include <sys/stat.h>
#include <stdlib.h>
#include <string.h>
#include <ctype.h>
#include <strings.h>
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
#define UI_MAGIC	"BPQUIC2\n"
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
static time_t since;		/* when counting began (0 = unknown); ring_lock */
static pthread_mutex_t save_lock = PTHREAD_MUTEX_INITIALIZER;
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
	int isfull;

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

	if (since > 0)
	{
		/* counting began at since, whether or not any event followed */
		oldest = (since > now - UI_WINDOW_SECS) ? since : now - UI_WINDOW_SECS;
		isfull = (now - since >= UI_FULL_SECS);
	}
	else
		isfull = (oldest != 0 && oldest <= now - UI_FULL_SECS);
	pthread_mutex_unlock(&ring_lock);

	if (window_start)
		*window_start = oldest;
	if (full)
		*full = isfull;
}

/* Read a plain decimal number: a digit must come first (no sign, no space) */
static int parse_num(const char *p, const char **end, long long *v)
{
	char *e;

	if (!isdigit((unsigned char)*p))
		return 0;
	*v = strtoll(p, &e, 10);
	*end = e;
	return 1;
}

/* Parse one "start sessions messages frames" line. All fields must be present,
   nothing may follow, and the line must end with a newline. */
static int parse_line(const char *line, long long *start, long n[UI_NCOUNTERS])
{
	const char *end;
	int c;
	size_t len = strlen(line);

	if (len == 0 || line[len - 1] != '\n')
		return 0;

	if (!parse_num(line, &end, start))
		return 0;

	for (c = 0; c < UI_NCOUNTERS; c++)
	{
		long long x;

		if (*end != ' ' || !parse_num(end + 1, &end, &x))
			return 0;
		if (x > UI_MAXCOUNT)
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
	long long sincev;
	const char *e;

	pthread_mutex_lock(&ring_lock);
	memset(ring, 0, sizeof(ring));
	memset(tmp, 0, sizeof(tmp));
	since = 0;

	f = fopen(path, "rb");
	if (f == NULL)
		goto reject;

	if (fread(line, 1, UI_MAGIC_LEN, f) != UI_MAGIC_LEN || memcmp(line, UI_MAGIC, UI_MAGIC_LEN) != 0)
		goto reject;

	/* header line: "since <epoch>" (0 = unknown) */
	if (fgets(line, sizeof(line), f) == NULL || strncmp(line, "since ", 6) != 0
		|| !parse_num(line + 6, &e, &sincev) || strcmp(e, "\n") != 0)
		goto reject;
	if (sincev > (long long)now + UI_BUCKET_SECS)
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
	since = (time_t)sincev;
	pthread_mutex_unlock(&ring_lock);
	return kept;

reject:
	if (f)
		fclose(f);
	memset(tmp, 0, sizeof(tmp));
	memset(ring, 0, sizeof(ring));
	since = 0;
	pthread_mutex_unlock(&ring_lock);
	return -1;
}

/* Drop state stamped ahead of now (the clock went backward), which a later load
   would reject. Caller holds ring_lock. */
static void prune_future(time_t now)
{
	int i;

	for (i = 0; i < UI_NBUCKETS; i++)
		if (ring[i].start > now + UI_BUCKET_SECS)
			memset(&ring[i], 0, sizeof(ring[i]));
	if (since > now + UI_BUCKET_SECS)
		since = now;
}

int uiapi_ring_save_at(const char *path, time_t now)
{
	time_t snapsince;
	int rc;

	struct ui_bucket snap[UI_NBUCKETS];
	char tmpname[1100];
	FILE *f;
	int i, ok = 1;

	if (strlen(path) + 5 > sizeof(tmpname))
		return -1;
	snprintf(tmpname, sizeof(tmpname), "%s.tmp", path);

	pthread_mutex_lock(&save_lock);
	pthread_mutex_lock(&ring_lock);
	prune_future(now);
	memcpy(snap, ring, sizeof(snap));
	snapsince = since;
	pthread_mutex_unlock(&ring_lock);

	f = fopen(tmpname, "wb");
	if (f == NULL)
	{
		pthread_mutex_unlock(&save_lock);
		return -1;
	}

	ok = fwrite(UI_MAGIC, 1, UI_MAGIC_LEN, f) == UI_MAGIC_LEN;
	if (ok)
		ok = fprintf(f, "since %lld\n", (long long)snapsince) > 0;
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
		unlink(tmpname);
	rc = ok ? 0 : -1;
	pthread_mutex_unlock(&save_lock);
	return rc;
}

int uiapi_ring_save(const char *path)
{
	return uiapi_ring_save_at(path, time(NULL));
}

static void ev_init(const char *dir);

void uiapi_init_at(const char *bpqdir, time_t now)
{
	const char *dir = (bpqdir && *bpqdir) ? bpqdir : ".";

	snprintf(save_path, sizeof(save_path), "%s/uiapi-counters.dat", dir);
	if (uiapi_ring_load(save_path, now) < 0 || since == 0)
	{
		/* no usable history: counting begins now, and is saved at once so
		   a restart before the first bucket closes keeps it */
		pthread_mutex_lock(&ring_lock);
		since = now;
		pthread_mutex_unlock(&ring_lock);
		uiapi_ring_save_at(save_path, now);
	}
	last_closed = bucket_start(now);
	ev_init(dir);
}

void uiapi_init(const char *bpqdir)
{
	uiapi_init_at(bpqdir, time(NULL));
}

static void fwd_expire(time_t now, int force);

void uiapi_tick(time_t now)
{
	time_t cur = bucket_start(now);

	fwd_expire(now, 0);
	if (save_path[0] == 0)
		return;
	if (cur == last_closed)
		return;
	/* a bucket just closed (or the clock moved) */
	last_closed = cur;
	uiapi_ring_save_at(save_path, now);
}

void uiapi_shutdown(void)
{
	fwd_expire(time(NULL), 1);
	if (save_path[0])
		uiapi_ring_save_at(save_path, time(NULL));
}

/* ---- JSON output into a fixed buffer ---- */

struct jbuf
{
	char *p;
	size_t len, cap;	/* cap includes the terminating NUL */
	int over;		/* a write did not fit; later writes are dropped */
};

static void jb_printf(struct jbuf *b, const char *fmt, ...)
{
	va_list ap;
	int n;

	if (b->over)
		return;
	va_start(ap, fmt);
	n = vsnprintf(b->p + b->len, b->cap - b->len, fmt, ap);
	va_end(ap);
	if (n < 0 || (size_t)n >= b->cap - b->len)
	{
		b->over = 1;
		b->p[b->len] = 0;
		return;
	}
	b->len += n;
}

/* A JSON string of at most max bytes of s. Bytes outside printable ASCII are
   written as \u00XX so the output is valid whatever the input encoding. */
static void jb_str(struct jbuf *b, const char *s, size_t max)
{
	size_t i;

	jb_printf(b, "\"");
	for (i = 0; s && i < max && s[i] && !b->over; i++)
	{
		unsigned char c = (unsigned char)s[i];

		if (c == '"' || c == '\\')
			jb_printf(b, "\\%c", c);
		else if (c < 0x20 || c >= 0x7f)
			jb_printf(b, "\\u%04x", c);
		else
			jb_printf(b, "%c", c);
	}
	jb_printf(b, "\"");
}

static void iso_time(time_t t, char out[21])
{
	struct tm tm;

	gmtime_r(&t, &tm);
	strftime(out, 21, "%Y-%m-%dT%H:%M:%SZ", &tm);
}

/* ---- Event details: flat JSON objects {"k":"str"|true|false|null,...} ---- */

static const char *jv_string(const char *p)
{
	if (*p++ != '"')
		return NULL;
	for (; *p != '"'; p++)
	{
		if ((unsigned char)*p < 0x20 || (unsigned char)*p >= 0x7f)
			return NULL;		/* we only ever write printable ASCII */
		if (*p != '\\')
			continue;
		if (*++p == 'u')
		{
			if (!isxdigit((unsigned char)p[1]) || !isxdigit((unsigned char)p[2])
				|| !isxdigit((unsigned char)p[3]) || !isxdigit((unsigned char)p[4]))
				return NULL;
			p += 4;
		}
		else if (*p == 0 || strchr("\"\\/bfnrt", *p) == NULL)
			return NULL;
	}
	return p + 1;
}

/* 1 if s is exactly one flat object of string, bool or null values, no spaces */
static int detail_ok(const char *s)
{
	const char *p = s;

	if (*p++ != '{')
		return 0;
	if (*p == '}')
		return p[1] == 0;
	for (;;)
	{
		if ((p = jv_string(p)) == NULL || *p++ != ':')
			return 0;
		if (*p == '"')
			p = jv_string(p);
		else if (strncmp(p, "true", 4) == 0 || strncmp(p, "null", 4) == 0)
			p += 4;
		else if (strncmp(p, "false", 5) == 0)
			p += 5;
		else
			return 0;
		if (p == NULL)
			return 0;
		if (*p == '}')
			return p[1] == 0;
		if (*p++ != ',')
			return 0;
	}
}

/* ---- Event log: last UI_EV_MAX in memory, all appended to uiapi-events.log ---- */

#define UI_EV_MAX	200
#define UI_KIND_MAX	16
#define UI_DETAIL_MAX	384
#define UI_EV_LINE_MAX	(UI_DETAIL_MAX + 80)
#define UI_EV_TAIL	((off_t)UI_EV_MAX * UI_EV_LINE_MAX)	/* bytes read back at init */
#define UI_EV_COMPACT	((off_t)1024 * 1024)	/* rewrite the file at init above this */

struct ui_event
{
	char t[21];
	char kind[UI_KIND_MAX];
	char detail[UI_DETAIL_MAX];
};

static struct ui_event events[UI_EV_MAX];
static int ev_next, ev_count;		/* ev_lock */
static char ev_path[1024];
static pthread_mutex_t ev_lock = PTHREAD_MUTEX_INITIALIZER;

/* CMS link state, ev_lock */
static time_t cms_attempt, cms_success;
static int cms_ok = -1;			/* -1 unknown */

static int kind_ok(const char *k)
{
	size_t i, n = strlen(k);

	if (n == 0 || n >= UI_KIND_MAX)
		return 0;
	for (i = 0; i < n; i++)
		if (!islower((unsigned char)k[i]))
			return 0;
	return 1;
}

static int ev_format(const struct ui_event *e, char *line, size_t cap)
{
	int n = snprintf(line, cap, "{\"t\":\"%s\",\"kind\":\"%s\",\"detail\":%s}\n", e->t, e->kind, e->detail);

	return (n < 0 || (size_t)n >= cap) ? -1 : n;
}

/* caller holds ev_lock */
static void ev_push(const struct ui_event *e)
{
	events[ev_next] = *e;
	ev_next = (ev_next + 1) % UI_EV_MAX;
	if (ev_count < UI_EV_MAX)
		ev_count++;
}

/* Parse one line as written by ev_format. Returns 1 if it is well formed. */
static int ev_parse(char *line, struct ui_event *e)
{
	size_t n = strlen(line);
	char *p, *q;
	int i;

	if (n < 2 || line[n - 1] != '\n' || line[n - 2] != '}')
		return 0;
	line[n - 2] = 0;		/* drop the outer brace and newline */
	if (strncmp(line, "{\"t\":\"", 6) != 0)
		return 0;
	p = line + 6;
	for (i = 0; i < 20; i++)
		if (p[i] == 0 || !strchr("0123456789-:TZ", p[i]))
			return 0;
	memcpy(e->t, p, 20);
	e->t[20] = 0;
	p += 20;
	if (strncmp(p, "\",\"kind\":\"", 10) != 0)
		return 0;
	p += 10;
	if ((q = strchr(p, '"')) == NULL || q - p >= UI_KIND_MAX)
		return 0;
	memcpy(e->kind, p, q - p);
	e->kind[q - p] = 0;
	if (!kind_ok(e->kind) || strncmp(q, "\",\"detail\":", 11) != 0)
		return 0;
	p = q + 11;
	if (strlen(p) >= UI_DETAIL_MAX || !detail_ok(p))
		return 0;
	strcpy(e->detail, p);
	return 1;
}

/* Rewrite the log as the events in memory. Caller holds ev_lock. */
static void ev_rewrite(void)
{
	char tmp[1100], line[UI_EV_LINE_MAX];
	FILE *f;
	int i, n, ok = 1;

	if (strlen(ev_path) + 5 > sizeof(tmp))
		return;
	snprintf(tmp, sizeof(tmp), "%s.tmp", ev_path);
	if ((f = fopen(tmp, "wb")) == NULL)
		return;
	for (i = 0; ok && i < ev_count; i++)
	{
		n = ev_format(&events[(ev_next - ev_count + i + UI_EV_MAX) % UI_EV_MAX], line, sizeof(line));
		ok = n > 0 && fwrite(line, 1, n, f) == (size_t)n;
	}
	ok = (fflush(f) == 0 && fsync(fileno(f)) == 0) && ok;
	if (fclose(f) != 0)
		ok = 0;
	if (!ok || rename(tmp, ev_path) != 0)
		unlink(tmp);
}

/* Load the tail of the log: bad, over-long or NUL-holding lines are skipped.
   The file is rewritten from what was kept if it is large or ends in a torn line. */
static void ev_init(const char *dir)
{
	FILE *f;
	char *buf = NULL, *p, *nl, line[UI_EV_LINE_MAX];
	struct ui_event e;
	off_t size = 0, start = 0;
	size_t got = 0, n;
	int torn = 0;

	pthread_mutex_lock(&ev_lock);
	snprintf(ev_path, sizeof(ev_path), "%s/uiapi-events.log", dir);
	ev_next = ev_count = 0;
	f = fopen(ev_path, "rb");
	if (f && fseeko(f, 0, SEEK_END) == 0 && (size = ftello(f)) > 0)
	{
		start = size > UI_EV_TAIL ? size - UI_EV_TAIL : 0;
		if (fseeko(f, start, SEEK_SET) == 0 && (buf = malloc(UI_EV_TAIL)) != NULL)
			got = fread(buf, 1, (size_t)(size - start), f);
	}
	if (f)
		fclose(f);

	p = buf;
	if (p && start > 0)
	{
		/* the first line read is partial */
		nl = memchr(p, '\n', got);
		torn = nl == NULL;	/* no line end in the whole window */
		got = nl ? got - (size_t)(nl + 1 - p) : 0;
		p = nl ? nl + 1 : p;
	}
	while (p && got > 0 && (nl = memchr(p, '\n', got)) != NULL)
	{
		n = (size_t)(nl + 1 - p);
		if (n < sizeof(line) && memchr(p, 0, n) == NULL)
		{
			memcpy(line, p, n);
			line[n] = 0;
			if (ev_parse(line, &e))
				ev_push(&e);
		}
		p += n;
		got -= n;
	}
	free(buf);
	if (size > UI_EV_COMPACT || got > 0 || torn)	/* got > 0: a torn last line */
		ev_rewrite();
	pthread_mutex_unlock(&ev_lock);
}

void uiapi_event_at(const char *kind, const char *detail_json, time_t now)
{
	struct ui_event e;
	char line[UI_EV_LINE_MAX];
	int fd, n;

	if (kind == NULL || !kind_ok(kind))
		return;
	if (detail_json == NULL || strlen(detail_json) >= UI_DETAIL_MAX || !detail_ok(detail_json))
		detail_json = "{}";
	iso_time(now, e.t);
	strcpy(e.kind, kind);
	strcpy(e.detail, detail_json);
	n = ev_format(&e, line, sizeof(line));

	pthread_mutex_lock(&ev_lock);
	ev_push(&e);
	if (ev_path[0] && n > 0)
	{
		fd = open(ev_path, O_WRONLY | O_APPEND | O_CREAT, 0644);
		if (fd >= 0)
		{
			if (write(fd, line, n) != n)
				n = (int)write(fd, "\n", 1);	/* end a torn line so the next starts clean */
			close(fd);
		}
	}
	pthread_mutex_unlock(&ev_lock);
}

void uiapi_event(const char *kind, const char *detail_json)
{
	uiapi_event_at(kind, detail_json, time(NULL));
}

int uiapi_events_json(char *buf, size_t cap, int limit)
{
	struct jbuf b = { buf, 0, cap - 2, 0 };
	int i;

	buf[0] = 0;
	jb_printf(&b, "[");
	pthread_mutex_lock(&ev_lock);
	for (i = 0; i < ev_count && i < limit; i++)
	{
		const struct ui_event *e = &events[(ev_next - 1 - i + UI_EV_MAX) % UI_EV_MAX];
		size_t mark = b.len;

		jb_printf(&b, "%s{\"t\":\"%s\",\"kind\":\"%s\",\"detail\":%s}", i ? "," : "", e->t, e->kind, e->detail);
		if (b.over)
		{
			/* the element that does not fit is dropped and the list ends */
			b.len = mark;
			buf[mark] = 0;
			break;
		}
	}
	pthread_mutex_unlock(&ev_lock);
	b.cap = cap;
	b.over = 0;
	jb_printf(&b, "]");
	return (int)b.len;
}

/* A forward run waits here for the CMS attempt its connect script makes, so
   its event carries that attempt's outcome rather than the one before it.
   A run with no CMS result within UI_FWD_WAIT seconds is logged as null. */
#define UI_FWD_WAIT	120

static struct
{
	time_t at;		/* 0: none pending */
	char route[64];
} fwd_pending;			/* ev_lock */

static void forward_log(const char *route, int ok, time_t now)
{
	char detail[UI_DETAIL_MAX];
	struct jbuf b = { detail, 0, sizeof(detail), 0 };

	jb_printf(&b, "{\"route\":");
	jb_str(&b, route, 64);
	jb_printf(&b, ",\"cmsReachable\":%s}", ok < 0 ? "null" : ok ? "true" : "false");
	uiapi_event_at("forward", b.over ? "{}" : detail, now);
}

/* Take the pending run if the caller should log it: always when force, else
   only once its wait has run out. Returns 1 and fills route when taken. */
static int fwd_take(time_t now, int force, char route[64])
{
	int took = 0;

	pthread_mutex_lock(&ev_lock);
	if (fwd_pending.at && (force || now - fwd_pending.at > UI_FWD_WAIT))
	{
		memcpy(route, fwd_pending.route, 64);
		fwd_pending.at = 0;
		took = 1;
	}
	pthread_mutex_unlock(&ev_lock);
	return took;
}

static void fwd_expire(time_t now, int force)
{
	char route[64];

	if (fwd_take(now, force, route))
		forward_log(route, -1, now);
}

void uiapi_cms_result_at(int ok, time_t now)
{
	char route[64];
	int have = 0;

	fwd_expire(now, 0);		/* a run whose wait ran out does not take this result */
	pthread_mutex_lock(&ev_lock);
	cms_attempt = now;
	if (ok)
		cms_success = now;
	cms_ok = ok ? 1 : 0;
	if (fwd_pending.at)
	{
		memcpy(route, fwd_pending.route, 64);
		fwd_pending.at = 0;
		have = 1;
	}
	pthread_mutex_unlock(&ev_lock);
	if (have)
		forward_log(route, ok ? 1 : 0, now);
}

void uiapi_cms_result(int ok)
{
	uiapi_cms_result_at(ok, time(NULL));
}

void uiapi_forward_event_at(const char *bbs, const char *script, int alt, time_t now)
{
	char route[64];
	int port = 0;
	const char *p = script;

	/* Only the port number is taken from the connect script: other words
	   in it (hosts, logins) are never read. */
	if (p && (strncasecmp(p, "C ", 2) == 0 || strncasecmp(p, "ATT ", 4) == 0
		|| strncasecmp(p, "ATTACH ", 7) == 0 || strncasecmp(p, "CONNECT ", 8) == 0))
	{
		p = strchr(p, ' ');
		while (*p == ' ')
			p++;
		if (isdigit((unsigned char)*p))
			port = atoi(p);
	}
	if (port > 0 && port < 100)
		snprintf(route, sizeof(route), "%.12s via port %d", bbs ? bbs : "", port);
	else
		snprintf(route, sizeof(route), "%.12s", bbs ? bbs : "");

	if (alt)
	{
		/* An ELSE leg belongs to the session its first leg started, and the
		   session is one event. Still waiting: the wait restarts, so a CMS
		   result from this leg decides it. Already logged, or another
		   partner's run waiting: nothing to do. */
		fwd_expire(now, 0);
		pthread_mutex_lock(&ev_lock);
		if (fwd_pending.at && strcmp(fwd_pending.route, route) == 0)
			fwd_pending.at = now ? now : 1;
		pthread_mutex_unlock(&ev_lock);
		return;
	}
	fwd_expire(now, 1);		/* an earlier run still waiting is logged as unknown */
	pthread_mutex_lock(&ev_lock);
	memcpy(fwd_pending.route, route, sizeof(route));
	fwd_pending.at = now ? now : 1;
	pthread_mutex_unlock(&ev_lock);
}

void uiapi_forward_event(const char *bbs, const char *script, int alt)
{
	uiapi_forward_event_at(bbs, script, alt, time(NULL));
}

void uiapi_cms_refused_at(time_t now)
{
	char route[64];

	fwd_expire(now, 0);
	if (fwd_take(now, 1, route))
		forward_log(route, 0, now);
}

void uiapi_cms_refused(void)
{
	uiapi_cms_refused_at(time(NULL));
}

/* ---- /api/ui/events: sysop only ---- */

/* Set by the HTTP layer before each /api request: 1 when it carries a node
   sysop session cookie that matches a live session. Per thread, since each
   HTTP connection is served on its own thread. */
static __thread int req_sysop;

void uiapi_set_sysop(int signed_in)
{
	req_sysop = signed_in ? 1 : 0;
}

/* limit=N anywhere in the query string, default 20, 1..200 */
static int events_limit(const char *param)
{
	char q[128];
	const char *p;
	int n;

	snprintf(q, sizeof(q), "%.*s", (int)strcspn(param, " \r\n"), param);
	if ((p = strstr(q, "limit=")) == NULL || !isdigit((unsigned char)p[6]))
		return 20;
	n = atoi(p + 6);
	return n < 1 ? 1 : n > UI_EV_MAX ? UI_EV_MAX : n;
}

int uiapi_events_reply(char *response, size_t cap, const char *param, int sysop)
{
	static const char refusal[] = "{\"error\":\"sysop sign-in required\"}";
	int n;

	if (!sysop)
		return snprintf(response, cap, "HTTP/1.1 401 Unauthorized\r\n"
			"Content-Type: application/json\r\n"
			"Content-Length: %d\r\n"
			"Cache-Control: no-cache\r\n"
			"Connection: close\r\n"
			"\r\n%s", (int)strlen(refusal), refusal);
	n = uiapi_events_json(response, cap - 2, events_limit(param));
	strcpy(response + n, "\r\n");
	return n + 2;
}

/* ---- link state from plain fields (tested on its own) ---- */

static const char *linked_by(const char *ev, const char **evidence)
{
	*evidence = ev;
	return "linked";
}

const char *uiapi_kiss_link(const struct ui_kiss_link *k, char *detail, size_t cap,
	const char **evidence)
{
	*evidence = NULL;
	if (!k->have)
	{
		snprintf(detail, cap, "driver reports no link state");
		return "unknown";
	}
	if (k->stopped)
	{
		snprintf(detail, cap, "port stopped");
		return "down";
	}
	if (k->ip && k->tcp && k->slave)
	{
		snprintf(detail, cap, k->connected ? "KISS TCP client connected" : "KISS TCP listening, no client");
		return k->connected ? linked_by("link", evidence) : "down";
	}
	if (k->ip && k->tcp)
	{
		snprintf(detail, cap, k->connected ? "KISS TCP connected" : "KISS TCP not connected");
		return k->connected ? linked_by("link", evidence) : "down";
	}
	if (k->ip)
	{
		snprintf(detail, cap, "KISS over UDP reports no link state");
		return "unknown";
	}
	/* The node knows only that it holds the device open, not that the TNC answers */
	snprintf(detail, cap, k->open ? "serial device open" : "serial device not open");
	return k->open ? linked_by("device", evidence) : "down";
}

const char *uiapi_axip_link(const struct ui_axip_link *a, time_t now, char *detail, size_t cap,
	const char **evidence)
{
	char lead[48], peers[64];
	int i, recent = 0;

	*evidence = NULL;
	if (a->udp_n > 0 && a->udp_bound <= 0)
	{
		if (a->udp_n == 1)
			snprintf(detail, cap, "AXIP UDP %d not bound", a->udp_unbound);
		else
			snprintf(detail, cap, "none of %d AXIP UDP ports bound", a->udp_n);
		return "down";
	}
	if (a->raw_open + a->udp_bound + a->tcp_open <= 0)
	{
		snprintf(detail, cap, "AXIP socket not open");
		return "down";
	}
	if (a->udp_n > 1)
		snprintf(lead, sizeof(lead), "%d of %d UDP ports bound", a->udp_bound, a->udp_n);
	else
		snprintf(lead, sizeof(lead), "socket open");
	if (a->n <= 0)
		snprintf(peers, sizeof(peers), "no peers mapped");
	else
	{
		for (i = 0; i < a->n; i++)
			if (a->heard[i] != 0 && now - a->heard[i] <= 3600)
				recent++;
		snprintf(peers, sizeof(peers), "%d of %d peers heard in the last hour", recent, a->n);
	}
	snprintf(detail, cap, "%s, %s%s", lead, peers, a->raw_open ? ", raw IP socket bind not checked" : "");
	return linked_by("socket", evidence);
}

/* ---- /api/ui handlers (linbpq only) ---- */

#ifndef UIAPI_TEST

#include "cheaders.h"
#include "tncinfo.h"
#include "kiss.h"

#include <arpa/inet.h>
#include <sys/socket.h>
#include <netinet/in.h>

/* The HTTP layer's reply buffer is 250000 bytes (HTTPcode.c); stay well under. */
#define UI_RESP_MAX	120000
#define UI_RESP_ROOM	64		/* kept back for closing brackets */

extern char LOCATOR[];
extern char MYALIASLOPPED[];
extern char TextVerstring[];
extern time_t TimeLoaded;
int send_http_response(char *response, const char *msg);

static void jb_time(struct jbuf *b, time_t t)
{
	char iso[21];

	if (t <= 0)
	{
		jb_printf(b, "null");
		return;
	}
	iso_time(t, iso);
	jb_printf(b, "\"%s\"", iso);
}

static void jb_open(struct jbuf *b, char *response)
{
	b->p = response;
	b->len = 0;
	b->cap = UI_RESP_MAX - UI_RESP_ROOM;
	b->over = 0;
	response[0] = 0;
}

/* List helpers: an element that does not fit is removed and the list ends there */
static int jb_elem_fits(struct jbuf *b, size_t mark)
{
	if (!b->over)
		return 1;
	b->len = mark;
	b->p[mark] = 0;
	b->over = 0;
	return 0;
}

static int jb_close(struct jbuf *b, const char *tail)
{
	b->cap = UI_RESP_MAX;
	b->over = 0;
	jb_printf(b, "%s", tail);
	return (int)b->len;
}

static void call_text(const unsigned char *ax, char out[16])
{
	int n = ConvFromAX25((unsigned char *)ax, (unsigned char *)out);

	if (n < 0 || n > 15)
		n = 0;
	out[n] = 0;
	strlop(out, ' ');
}

static void trimmed(const char *in, size_t max, char *out)
{
	size_t n = strnlen(in, max);

	while (n > 0 && in[n - 1] == ' ')
		n--;
	memcpy(out, in, n);
	out[n] = 0;
}

static struct TNCINFO *port_tnc(struct PORTCONTROL *P)
{
	int n = P->PORTNUMBER;

	if (P->PORTTYPE != 0x10 || n <= 0 || n >= 71)
		return NULL;
	return TNCInfo[n];
}

static const char *port_driver(struct PORTCONTROL *P, char out[20])
{
	switch (P->PORTTYPE)
	{
	case 0x10:
		trimmed(((struct _EXTPORTDATA *)P)->PORT_DLL_NAME, 16, out);
		strlop(out, '.');
		return out;
	case 0: return P->PROTOCOL == 0 ? "KISS" : "ASYNC";
	case 14: return "INTERNAL";
	case 22: return "I2C";
	default: return (P->PORTTYPE > 0 && P->PORTTYPE < 14) ? "HDLC" : "UNKNOWN";
	}
}

/* Mode name for a WL2KREPORT mode number, as DecodeWL2KReportLine parsed it */
static void wl2k_mode(const struct WL2KInfo *W, char out[16])
{
	static const struct { int mode; const char *name; } names[] = {
		{11, "P1"}, {12, "P12"}, {13, "P123"}, {14, "P2"}, {15, "P23"}, {16, "P3"},
		{17, "P1234"}, {18, "P234"}, {19, "P34"}, {20, "P4"}, {21, "WINMOR500"},
		{22, "WINMOR1600"}, {30, "ROBUST"}, {40, "ARDOP200"}, {41, "ARDOP500"},
		{42, "ARDOP1000"}, {43, "ARDOP2000"}, {44, "ARDOP2000FM"}, {50, "VARA"},
		{51, "VARAFM"}, {52, "VARAFM96"}, {53, "VARA500"}, {54, "VARA2750"}
	};
	size_t i;

	out[0] = 0;
	if (W->mode >= 0 && W->mode <= 6)
	{
		snprintf(out, 16, "PKT%d", W->baud);
		return;
	}
	for (i = 0; i < sizeof(names) / sizeof(names[0]); i++)
		if (names[i].mode == W->mode)
			snprintf(out, 16, "%s", names[i].name);
}

/* The WL2KREPORT for a port: the driver's own (CONFIG section) or the port
   block's, both parsed at startup */
static const struct WL2KInfo *port_wl2k(struct PORTCONTROL *P)
{
	struct TNCINFO *TNC = port_tnc(P);

	if (TNC && TNC->WL2K && TNC->WL2K->Freq)
		return TNC->WL2K;
	if (P->WL2KInfo.Freq)
		return &P->WL2KInfo;
	return NULL;
}

/* For a KISS port: the device record of the first port on it, as sendPortList does */
static NPASYINFO port_kiss(struct PORTCONTROL **P)
{
	struct KISSINFO *K = (struct KISSINFO *)*P;
	int n;

	if (K->FIRSTPORT && K->FIRSTPORT != K)
		*P = (struct PORTCONTROL *)K->FIRSTPORT;
	n = (*P)->PORTNUMBER;
	return (n > 0 && n < MAXBPQPORTS) ? KISSInfo[n] : NULL;
}

static void port_addr(struct PORTCONTROL *P, struct jbuf *b)
{
	struct TNCINFO *TNC = port_tnc(P);
	char ip[INET_ADDRSTRLEN], a[300] = "";

	if (P->PORTTYPE == 0 && P->KISSTCP && inet_ntop(AF_INET, &P->PORTIPADDR, ip, sizeof(ip)))
		snprintf(a, sizeof(a), "%s:%d", ip, P->IOBASE);
	else if (P->PORTTYPE == 0 && P->SerialPortName)
		snprintf(a, sizeof(a), "%.255s", P->SerialPortName);
	else if (TNC && TNC->Hardware != H_TELNET && TNC->HostName)
		snprintf(a, sizeof(a), "%.255s:%d", TNC->HostName, ntohs(TNC->destaddr.sin_port));
	if (a[0])
		jb_str(b, a, sizeof(a));
	else
		jb_printf(b, "null");
}

int uiapi_api_station(char *response, char *token, char *param, int Local)
{
	struct jbuf b;
	struct PORTCONTROL *P;
	char call[16], id[32], drv[20], mode[16];
	const struct WL2KInfo *W;
	int telnet = 0, n;

	jb_open(&b, response);
	trimmed((char *)MYNODECALL, 10, call);
	jb_printf(&b, "{\"call\":");
	jb_str(&b, call, sizeof(call));
	jb_printf(&b, ",\"alias\":");
	jb_str(&b, MYALIASLOPPED, 10);
	jb_printf(&b, ",\"locator\":");
	jb_str(&b, LOCATOR, 80);
	jb_printf(&b, ",\"version\":");
	jb_str(&b, TextVerstring, 50);
	if (TimeLoaded)
		jb_printf(&b, ",\"uptimeSec\":%lld", (long long)(time(NULL) - TimeLoaded));
	else
		jb_printf(&b, ",\"uptimeSec\":null");
	jb_printf(&b, ",\"ports\":[");

	for (P = PORTTABLE, n = 0; P && n < MAXBPQPORTS && !b.over; P = P->PORTPOINTER, n++)
	{
		size_t mark = b.len;
		struct TNCINFO *TNC = port_tnc(P);

		if (TNC && TNC->Hardware == H_TELNET && TNC->TCPInfo && !telnet)
			telnet = TNC->TCPInfo->TCPPort;
		trimmed(P->PORTDESCRIPTION, 30, id);
		jb_printf(&b, "%s{\"number\":%d,\"id\":", n ? "," : "", P->PORTNUMBER);
		jb_str(&b, id, sizeof(id));
		jb_printf(&b, ",\"driver\":");
		jb_str(&b, port_driver(P, drv), 20);
		W = port_wl2k(P);
		if (W)
		{
			wl2k_mode(W, mode);
			jb_printf(&b, ",\"freqHz\":%lld,\"modes\":[", (long long)W->Freq);
			if (mode[0])
				jb_str(&b, mode, sizeof(mode));
			jb_printf(&b, "]");
		}
		else
			jb_printf(&b, ",\"freqHz\":null,\"modes\":[]");
		jb_printf(&b, ",\"addr\":");
		port_addr(P, &b);
		/* KISS ports hold TXTAIL in 10 ms units (cMain.c); other port types
		   use the field for something else, so they report null */
		if (P->PORTTYPE == 0)
			jb_printf(&b, ",\"txtailMs\":%d}", P->PORTTAILTIME * 10);
		else
			jb_printf(&b, ",\"txtailMs\":null}");
		if (!jb_elem_fits(&b, mark))
			break;
	}
	b.cap = UI_RESP_MAX;	/* the room kept back covers this and the close */
	if (telnet)
		jb_printf(&b, "],\"telnetPort\":%d", telnet);
	else
		jb_printf(&b, "],\"telnetPort\":null");
	return jb_close(&b, "}\r\n");
}

/* bpqaxip.c:310; NULL for a port that is not BPQAXIP, as Cmd.c AXRESOLVER tests */
extern struct AXIPPORTINFO *Portlist[];

/* arp_table_entry.TCPState values, bpqaxip.c:275-277 */
#define UI_AXIP_TCPLISTENING	1
#define UI_AXIP_TCPCONNECTED	4

static struct AXIPPORTINFO *port_axip(struct PORTCONTROL *P)
{
	int n = P->PORTNUMBER;

	if (P->PORTTYPE != 0x10 || n <= 0 || n > MaxBPQPortNo)
		return NULL;
	return Portlist[n];
}

/* Whether s is a UDP socket bound to the driver's configured port. The driver
   keeps no bind result: OpenSockets (bpqaxip.c:933-944) reports a failed bind
   on the console and keeps the socket, and the first sendto through it
   (SendFrame, bpqaxip.c:736-763) makes the kernel bind an ephemeral port. So
   any port is not enough; it must be htons(udpport[i]), in the family the
   driver asked for (bpqaxip.c:896-898).

   CloseSockets (bpqaxip.c:1025-1037) closes the sockets without zeroing the
   numbers, and a reinit (ExtProc fn 4, bpqaxip.c:678-691) reopens them on
   another thread, so a number read here may be closed or already reused. A closed number fails
   getsockname. A reused one passes only if it is a UDP socket of the same
   family bound to the configured port, which in this process means the
   driver's own reopened socket. Nothing in the driver marks a socket as
   closed (no generation or state field), so this is as far as a read
   without an upstream edit can go. */
static int axip_udp_bound(SOCKET s, int want_port, int want_v6)
{
	struct sockaddr_storage ss;
	socklen_t len = sizeof(ss);
	int type = 0;
	socklen_t tlen = sizeof(type);

	if (s <= 0)
		return 0;
	if (getsockopt(s, SOL_SOCKET, SO_TYPE, &type, &tlen) != 0 || type != SOCK_DGRAM)
		return 0;
	if (getsockname(s, (struct sockaddr *)&ss, &len) != 0)
		return 0;
	if (want_v6)
		return ss.ss_family == AF_INET6
			&& ((struct sockaddr_in6 *)&ss)->sin6_port == htons(want_port);
	return ss.ss_family == AF_INET && ((struct sockaddr_in *)&ss)->sin_port == htons(want_port);
}

/* The AXIP driver's open sockets, into a. The raw IP 93 socket binds to any
   address with port 0 (bpqaxip.c:874-878), so for it being open is all there
   is to read; the detail says its bind was not checked. A TCP map counts
   while connected or listening (bpqaxip.c:1021, 2784, 3031). */
static void axip_sockets(struct AXIPPORTINFO *A, struct ui_axip_link *a)
{
	int i;

	a->raw_open = A->needip && A->sock > 0;
	for (i = 0; i < A->NumberofUDPPorts && i < MAXUDPPORTS + 2; i++)
	{
		a->udp_n++;
		if (axip_udp_bound(A->udpsock[i], A->udpport[i], A->IPv6[i]))
			a->udp_bound++;
		else if (!a->udp_unbound)
			a->udp_unbound = A->udpport[i] > 0 ? A->udpport[i] : -1;
	}
	for (i = 0; i < A->arp_table_len && i < MAX_ENTRIES; i++)
		if (A->arp_table[i].TCPState == UI_AXIP_TCPLISTENING
			|| A->arp_table[i].TCPState == UI_AXIP_TCPCONNECTED)
			a->tcp_open++;
}

static const char *link_state(struct PORTCONTROL *P, char *detail, size_t cap, const char **evidence)
{
	struct TNCINFO *TNC = port_tnc(P);
	struct AXIPPORTINFO *A = TNC ? NULL : port_axip(P);
	struct PORTCONTROL *F = P;
	NPASYINFO K;
	struct ui_kiss_link k;

	*evidence = NULL;
	/* STOPPORT sets PortStopped on any port with a stop routine
	   (Cmd.c:5983-5988), and on a serial KISS port (Cmd.c:6022-6023). The
	   node's own PORTS command and /api/ports read it before anything else
	   (Cmd.c:1753, nodeapi.c:414). */
	if (P->PortStopped)
	{
		snprintf(detail, cap, "port stopped");
		return "down";
	}
	if (TNC && TNC->Hardware == H_VARA)
	{
		snprintf(detail, cap, TNC->CONNECTED ? "connected to VARA modem" : "VARA modem not connected");
		return TNC->CONNECTED ? linked_by("link", evidence) : "down";
	}
	if (A)
	{
		time_t heard[MAX_ENTRIES];
		struct ui_axip_link a;
		int i, n = A->arp_table_len;

		if (n < 0)
			n = 0;
		if (n > MAX_ENTRIES)
			n = MAX_ENTRIES;
		/* arp_table_entry.LastHeard, set on each packet from the peer (bpqaxip.c:2628) */
		for (i = 0; i < n; i++)
			heard[i] = A->arp_table[i].LastHeard;
		memset(&a, 0, sizeof(a));
		axip_sockets(A, &a);
		a.heard = heard;
		a.n = n;
		return uiapi_axip_link(&a, time(NULL), detail, cap, evidence);
	}
	if (P->PORTTYPE == 0)
	{
		/* The node's own PORTS command (Cmd.c:1753-1806) and /api/ports
		   (nodeapi.c:414-460) read these fields of the device's first port:
		   PortStopped first, then Connected for KISS TCP (KISSSLAVE: listening
		   until a client connects, kiss.c:2134-2145), "UDP" for KISS over UDP,
		   and idComDev for a serial device. idComDev is 0 when the open failed
		   (kiss.c:485-490), after a read error closes it (kiss.c:553-558,
		   612-616) and until the reopen every 30 s succeeds (kiss.c:535-545).
		   STOPPORT sets the first port's flag only, so a later port of a
		   multidrop set reads it from there. */
		K = port_kiss(&F);
		memset(&k, 0, sizeof(k));
		k.have = K != NULL;
		k.stopped = F->PortStopped;
		k.ip = F->PORTIPADDR.s_addr != 0 || F->KISSSLAVE;
		k.tcp = F->KISSTCP;
		k.slave = F->KISSSLAVE;
		if (K)
		{
			k.connected = K->Connected;
			k.open = K->idComDev != 0;
		}
		return uiapi_kiss_link(&k, detail, cap, evidence);
	}
	snprintf(detail, cap, "driver reports no link state");
	return "unknown";
}

int uiapi_api_links(char *response, char *token, char *param, int Local)
{
	struct jbuf b;
	struct PORTCONTROL *P;
	char detail[160];
	const char *state, *evidence;
	int n;

	jb_open(&b, response);
	jb_printf(&b, "{\"ports\":[");
	for (P = PORTTABLE, n = 0; P && n < MAXBPQPORTS && !b.over; P = P->PORTPOINTER, n++)
	{
		size_t mark = b.len;

		state = link_state(P, detail, sizeof(detail), &evidence);
		jb_printf(&b, "%s{\"number\":%d,\"state\":\"%s\",\"detail\":", n ? "," : "", P->PORTNUMBER, state);
		jb_str(&b, detail, sizeof(detail));
		/* added field: an overlay that ignores it reads the entry as before */
		if (evidence)
			jb_printf(&b, ",\"evidence\":\"%s\"}", evidence);
		else
			jb_printf(&b, ",\"evidence\":null}");
		if (!jb_elem_fits(&b, mark))
			break;
	}
	return jb_close(&b, "]}\r\n");
}

int uiapi_api_cms(char *response, char *token, char *param, int Local)
{
	struct jbuf b;
	time_t a, s;
	int ok;

	pthread_mutex_lock(&ev_lock);
	a = cms_attempt;
	s = cms_success;
	ok = cms_ok;
	pthread_mutex_unlock(&ev_lock);

	jb_open(&b, response);
	jb_printf(&b, "{\"lastAttempt\":");
	jb_time(&b, a);
	jb_printf(&b, ",\"lastSuccess\":");
	jb_time(&b, s);
	jb_printf(&b, ",\"ok\":%s", ok < 0 ? "null" : ok ? "true" : "false");
	return jb_close(&b, "}\r\n");
}

int uiapi_api_counts(char *response, char *token, char *param, int Local)
{
	struct jbuf b;
	long t[UI_NCOUNTERS];
	time_t ws;
	int full;

	uiapi_ring_totals(time(NULL), t, &ws, &full);
	jb_open(&b, response);
	jb_printf(&b, "{\"windowStart\":");
	jb_time(&b, ws);
	jb_printf(&b, ",\"full\":%s,\"sessions\":%ld,\"messages\":%ld,\"frames\":%ld",
		full ? "true" : "false", t[UI_SESSIONS], t[UI_MESSAGES], t[UI_FRAMES]);
	return jb_close(&b, "}\r\n");
}

/* param is the raw request after the URL prefix, e.g. "/2 HTTP/1.1..." */
int uiapi_api_mheard(char *response, char *token, char *param, int Local)
{
	struct jbuf b;
	struct PORTCONTROL *P = NULL;
	MHSTRUC *MH;
	char call[16];
	int i, d, first = 1;

	if (param[0] == '/' && isdigit((unsigned char)param[1]))
		P = GetPortTableEntryFromPortNum(atoi(param + 1));
	if (P == NULL)
		return send_http_response(response, "404 Not Found");

	jb_open(&b, response);
	jb_printf(&b, "[");
	for (MH = P->PORTMHEARD, i = 0; MH && i < MHENTRIES && MH->MHCALL[0] && !b.over; MH++, i++)
	{
		size_t mark = b.len;
		const UCHAR *ptr = &MH->MHCALL[6];	/* end-of-address bit */

		call_text(MH->MHCALL, call);
		jb_printf(&b, "%s{\"call\":", first ? "" : ",");
		jb_str(&b, call, sizeof(call));
		jb_printf(&b, ",\"packets\":%d,\"lastHeard\":", MH->MHCOUNT);
		jb_time(&b, MH->MHTIME);
		jb_printf(&b, ",\"via\":[");
		/* digis follow the call in 7-byte AX.25 addresses (MHDIGIS), up to 8 */
		for (d = 0; d < 8 && (*ptr & 1) == 0; d++, ptr += 7)
		{
			call_text(ptr + 1, call);
			jb_printf(&b, "%s", d ? "," : "");
			jb_str(&b, call, sizeof(call));
		}
		jb_printf(&b, "]}");
		if (!jb_elem_fits(&b, mark))
			break;
		first = 0;
	}
	return jb_close(&b, "]\r\n");
}

int uiapi_api_events(char *response, char *token, char *param, int Local)
{
	return uiapi_events_reply(response, UI_RESP_MAX, param, req_sysop);
}

#endif /* UIAPI_TEST */
