/* Tests for the uiapi counter ring. Built with -DUIAPI_TEST by `make uitest`. */

#include <assert.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <dirent.h>
#include <time.h>

#include "../uiapi.h"

#define T0 1760000100	/* multiple of 300 */

static char dir[128];
static char path[192];
static int passed = 0;

static void reset(void)
{
	/* loading a missing file empties the ring */
	char none[192];
	snprintf(none, sizeof none, "%s/none.dat", dir);
	unlink(none);
	assert(uiapi_ring_load(none, T0) == -1);
}

static void write_file(const char *data, size_t len)
{
	FILE *f = fopen(path, "wb");
	assert(f);
	assert(fwrite(data, 1, len, f) == len);
	fclose(f);
}

static void zero_totals(time_t now)
{
	long t[UI_NCOUNTERS];
	time_t ws;
	int full;
	int i;

	uiapi_ring_totals(now, t, &ws, &full);
	for (i = 0; i < UI_NCOUNTERS; i++)
		assert(t[i] == 0);
	assert(full == 0);
}

static void test_counts_sum_within_window(void)
{
	long t[UI_NCOUNTERS];
	time_t ws;
	int full, i;

	reset();
	for (i = 0; i < 3; i++)
		uiapi_count_at(UI_SESSIONS, T0);
	for (i = 0; i < 2; i++)
		uiapi_count_at(UI_SESSIONS, T0 + 3600);
	uiapi_count_at(UI_FRAMES, T0 + 3600);
	uiapi_ring_totals(T0 + 3700, t, &ws, &full);
	assert(t[UI_SESSIONS] == 5);
	assert(t[UI_MESSAGES] == 0);
	assert(t[UI_FRAMES] == 1);
	assert(ws == T0);
	assert(full == 0);
	passed++;
}

static void test_old_buckets_drop(void)
{
	long t[UI_NCOUNTERS];
	time_t ws;
	int full;

	reset();
	uiapi_count_at(UI_MESSAGES, T0);
	uiapi_ring_totals(T0 + 86400 - 300, t, &ws, &full);
	assert(t[UI_MESSAGES] == 1);
	uiapi_ring_totals(T0 + 86400 + 300, t, &ws, &full);
	assert(t[UI_MESSAGES] == 0);
	passed++;
}

static void test_downtime_counts_zero(void)
{
	long t[UI_NCOUNTERS];
	time_t ws;
	int full;

	reset();
	uiapi_count_at(UI_SESSIONS, T0);
	uiapi_count_at(UI_SESSIONS, T0);
	snprintf(path, sizeof path, "%s/dt.dat", dir);
	assert(uiapi_ring_save(path) == 0);

	reset();
	assert(uiapi_ring_load(path, T0 + 7200) == 1);
	uiapi_ring_totals(T0 + 7200, t, &ws, &full);
	assert(t[UI_SESSIONS] == 2);
	assert(full == 0);
	uiapi_ring_totals(T0 + 86100 - 300, t, &ws, &full);
	assert(full == 0);
	/* the oldest bucket is 86100 s old: the window is now full */
	uiapi_ring_totals(T0 + 86100, t, &ws, &full);
	assert(full == 1);
	unlink(path);
	passed++;
}

static void test_corrupt_file_starts_empty(void)
{
	char junk[512];
	size_t i;

	reset();
	uiapi_count_at(UI_SESSIONS, T0);	/* must be wiped by the failed load */
	for (i = 0; i < sizeof junk; i++)
		junk[i] = (char)(i * 37 + 11);
	snprintf(path, sizeof path, "%s/bad.dat", dir);
	write_file(junk, sizeof junk);
	assert(uiapi_ring_load(path, T0) == -1);
	zero_totals(T0);

	/* good magic, hostile lines */
	write_file("BPQUIC2\nsince 0\n100 1 2\n", 26);
	assert(uiapi_ring_load(path, T0) == -1);
	zero_totals(T0);
	{
		char b[128];
		snprintf(b, sizeof b, "BPQUIC2\nsince 0\n%ld -5 0 0\n", (long)T0);
		write_file(b, strlen(b));
		assert(uiapi_ring_load(path, T0 + 300) == -1);
		zero_totals(T0 + 300);
		snprintf(b, sizeof b, "BPQUIC2\nsince 0\n%ld 1 0 0 junk\n", (long)T0);
		write_file(b, strlen(b));
		assert(uiapi_ring_load(path, T0 + 300) == -1);
		snprintf(b, sizeof b, "BPQUIC2\nsince 0\n%ld 1 0 0\n%ld 1 0 0\n", (long)T0, (long)T0);
		write_file(b, strlen(b));
		assert(uiapi_ring_load(path, T0 + 300) == -1);
		snprintf(b, sizeof b, "BPQUIC2\nsince 0\n%ld 1 0 0\n", (long)T0 + 7);
		write_file(b, strlen(b));
		assert(uiapi_ring_load(path, T0 + 300) == -1);
	}
	unlink(path);
	passed++;
}

static void test_truncated_file_starts_empty(void)
{
	char b[128];

	reset();
	snprintf(path, sizeof path, "%s/trunc.dat", dir);
	snprintf(b, sizeof b, "BPQUIC2\nsince 0\n%ld 4 0 0\n%ld 3 0", (long)T0, (long)T0 + 300);
	write_file(b, strlen(b));
	assert(uiapi_ring_load(path, T0 + 600) == -1);
	zero_totals(T0 + 600);
	write_file("BPQU", 4);
	write_file("BPQUIC2\n", 8);
	assert(uiapi_ring_load(path, T0 + 600) == -1);
	write_file("BPQUIC2\nsince 0\n", 16);
	assert(uiapi_ring_load(path, T0 + 600) == 0);
	write_file("BPQUIC1\nsince 0\n", 16);
	assert(uiapi_ring_load(path, T0 + 600) == -1);
	zero_totals(T0 + 600);
	write_file("", 0);
	assert(uiapi_ring_load(path, T0 + 600) == -1);
	unlink(path);
	passed++;
}

static void test_future_stamped_bucket_rejected(void)
{
	char b[128];

	reset();
	snprintf(path, sizeof path, "%s/future.dat", dir);
	snprintf(b, sizeof b, "BPQUIC2\nsince 0\n%ld 4 0 0\n%ld 1 0 0\n", (long)T0, (long)T0 + 900);
	write_file(b, strlen(b));
	assert(uiapi_ring_load(path, T0 + 300) == -1);
	zero_totals(T0 + 300);
	/* one bucket ahead of now is tolerated (clock skew) */
	snprintf(b, sizeof b, "BPQUIC2\nsince 0\n%ld 4 0 0\n", (long)T0 + 300);
	write_file(b, strlen(b));
	assert(uiapi_ring_load(path, T0 + 300) == 1);
	unlink(path);
	passed++;
}

static void test_save_is_atomic(void)
{
	char tmp[256], magic[9] = {0};
	FILE *f;
	DIR *d;
	struct dirent *e;

	reset();
	uiapi_count_at(UI_FRAMES, T0);
	snprintf(path, sizeof path, "%s/atomic.dat", dir);
	assert(uiapi_ring_save(path) == 0);
	snprintf(tmp, sizeof tmp, "%s.tmp", path);
	assert(access(tmp, F_OK) != 0);
	d = opendir(dir);
	assert(d);
	while ((e = readdir(d)) != NULL) {
		size_t n = strlen(e->d_name);
		assert(!(n >= 4 && strcmp(e->d_name + n - 4, ".tmp") == 0));
	}
	closedir(d);
	f = fopen(path, "rb");
	assert(f);
	assert(fread(magic, 1, 8, f) == 8);
	fclose(f);
	assert(strcmp(magic, "BPQUIC2\n") == 0);
	unlink(path);
	passed++;
}

static void test_since_fresh_start(void)
{
	long t[UI_NCOUNTERS];
	time_t ws;
	int full;

	reset();
	uiapi_init_at(dir, T0);		/* no file: counting begins now */
	uiapi_ring_totals(T0 + 600, t, &ws, &full);
	assert(t[UI_SESSIONS] == 0 && ws == T0 && full == 0);
	uiapi_count_at(UI_SESSIONS, T0 + 3000);
	uiapi_ring_totals(T0 + 3100, t, &ws, &full);
	assert(ws == T0 && t[UI_SESSIONS] == 1);
	passed++;
}

static void test_since_sparse_traffic_stays_full(void)
{
	long t[UI_NCOUNTERS];
	time_t ws;
	int full;

	reset();
	uiapi_init_at(dir, T0);
	uiapi_count_at(UI_SESSIONS, T0 + 100);
	/* a quiet day and a half: the only event aged out, window is still full */
	uiapi_ring_totals(T0 + 129600, t, &ws, &full);
	assert(t[UI_SESSIONS] == 0);
	assert(full == 1);
	assert(ws == T0 + 129600 - 86400);
	passed++;
}

static void test_since_survives_reload(void)
{
	long t[UI_NCOUNTERS];
	time_t ws;
	int full;
	char file[192];

	reset();
	uiapi_init_at(dir, T0);
	uiapi_count_at(UI_FRAMES, T0 + 10);
	snprintf(file, sizeof file, "%s/uiapi-counters.dat", dir);
	assert(uiapi_ring_save(file) == 0);
	uiapi_init_at(dir, T0 + 7200);	/* restart two hours later */
	uiapi_ring_totals(T0 + 7200, t, &ws, &full);
	assert(ws == T0 && t[UI_FRAMES] == 1 && full == 0);
	uiapi_init_at(dir, T0 + 90000);
	uiapi_ring_totals(T0 + 90000, t, &ws, &full);
	assert(full == 1 && ws == T0 + 90000 - 86400);
	/* a since stamped in the future rejects the file */
	{
		char b[128];
		snprintf(b, sizeof b, "BPQUIC2\nsince %ld\n", (long)T0 + 1000);
		write_file(b, strlen(b));
		snprintf(path, sizeof path, "%s/uiapi-counters.dat", dir);
		write_file(b, strlen(b));
		assert(uiapi_ring_load(path, T0) == -1);
	}
	unlink(file);
	passed++;
}

static void test_clock_jump_back_stays_loadable(void)
{
	long t[UI_NCOUNTERS];
	time_t ws;
	int full;
	time_t later = T0 + 7200, now2 = T0;

	reset();
	uiapi_init_at(dir, T0 - 3600);
	uiapi_count_at(UI_SESSIONS, later);	/* stamped ahead of the clock after the jump */
	uiapi_count_at(UI_SESSIONS, now2);
	snprintf(path, sizeof path, "%s/jump.dat", dir);
	assert(uiapi_ring_save_at(path, now2) == 0);
	assert(uiapi_ring_load(path, now2) == 1);
	uiapi_ring_totals(now2, t, &ws, &full);
	assert(t[UI_SESSIONS] == 1);
	unlink(path);
	passed++;
}

static void test_shutdown_saves(void)
{
	char file[192];

	reset();
	uiapi_init_at(dir, T0);
	uiapi_count_at(UI_MESSAGES, T0);
	uiapi_shutdown();
	snprintf(file, sizeof file, "%s/uiapi-counters.dat", dir);
	assert(access(file, F_OK) == 0);
	{
		long t[UI_NCOUNTERS];
		time_t ws;
		int full;
		assert(uiapi_ring_load(file, T0 + 60) == 1);
		uiapi_ring_totals(T0 + 60, t, &ws, &full);
		assert(t[UI_MESSAGES] == 1);
	}
	unlink(file);
	passed++;
}

/* ---- event log ---- */

static char evlog[192], evjson[8192];

static int count_of(const char *hay, const char *needle)
{
	int n = 0;

	while ((hay = strstr(hay, needle)) != NULL)
		n++, hay++;
	return n;
}

static void ev_reset(void)
{
	snprintf(evlog, sizeof evlog, "%s/uiapi-events.log", dir);
	unlink(evlog);
	uiapi_init_at(dir, T0);
}

static void ev_append(const char *data)
{
	FILE *f = fopen(evlog, "ab");
	assert(f);
	fputs(data, f);
	fclose(f);
}

static void test_event_round_trip(void)
{
	ev_reset();
	uiapi_event_at("cfgsave", "{\"ok\":true}", T0);
	uiapi_event_at("forward", "{\"route\":\"N0\\\"X\\\\ \\u00e9\",\"cmsReachable\":null}", T0 + 1);
	uiapi_init_at(dir, T0 + 10);		/* reload from disk */
	uiapi_events_json(evjson, sizeof evjson, 20);
	assert(count_of(evjson, "\"kind\"") == 2);
	assert(strstr(evjson, "[{\"t\":\"") == evjson);
	assert(strstr(evjson, "\"kind\":\"forward\",\"detail\":{\"route\":\"N0\\\"X\\\\ \\u00e9\",\"cmsReachable\":null}},{"));
	assert(strstr(evjson, "\"kind\":\"cfgsave\",\"detail\":{\"ok\":true}}]"));
	uiapi_events_json(evjson, sizeof evjson, 1);
	assert(count_of(evjson, "\"kind\"") == 1);
	passed++;
}

static void test_event_corrupt_line_skipped(void)
{
	ev_reset();
	uiapi_event_at("restart", "{}", T0);
	ev_append("not json\n{\"t\":\"2026-01-01T00:00:00Z\",\"kind\":\"cfgsave\",\"detail\":{\"ok\":tru}}\n");
	ev_append("{\"t\":\"2026-01-01T00:00:01Z\",\"kind\":\"mailsave\",\"detail\":{\"what\":\"users\"}}\n");
	ev_append("{\"t\":\"2026-01-01T00:00:02Z\",\"kind\":\"cfgsave\",\"detail\":{\"ok\"");	/* torn */
	uiapi_init_at(dir, T0 + 10);
	uiapi_events_json(evjson, sizeof evjson, 20);
	assert(count_of(evjson, "\"kind\"") == 2);
	assert(strstr(evjson, "mailsave") && !strstr(evjson, "tru}"));
	/* the torn tail made the loader rewrite the file, so appends start clean */
	uiapi_event_at("cfgsave", "{\"ok\":false}", T0 + 20);
	uiapi_init_at(dir, T0 + 30);
	uiapi_events_json(evjson, sizeof evjson, 20);
	assert(count_of(evjson, "\"kind\"") == 3);
	passed++;
}

static void test_event_oversize_line_skipped(void)
{
	char big[3000];

	ev_reset();
	snprintf(big, sizeof big, "{\"t\":\"2026-01-01T00:00:00Z\",\"kind\":\"cfgsave\",\"detail\":{\"a\":\"%02000d\"}}\n", 0);
	ev_append(big);
	ev_append("{\"t\":\"2026-01-01T00:00:01Z\",\"kind\":\"restart\",\"detail\":{}}\n");
	uiapi_init_at(dir, T0 + 10);
	uiapi_events_json(evjson, sizeof evjson, 20);
	assert(count_of(evjson, "\"kind\"") == 1 && strstr(evjson, "restart"));
	/* a valid but oversize detail passed in is logged as {} */
	snprintf(big, sizeof big, "{\"a\":\"%0400d\"}", 0);
	uiapi_event_at("cfgsave", big, T0 + 20);
	uiapi_events_json(evjson, sizeof evjson, 1);
	assert(strstr(evjson, "\"detail\":{}}]"));
	passed++;
}

static void test_event_flat_validator(void)
{
	static const char *bad[] = { "{\"a\":{\"b\":true}}", "{\"a\":[1]}", "{\"n\":01}", "{\"a\":1}",
		"{\"a\": true}", "{\"a\":\"x\\q\"}", "{\"a\":\"\\u00zz\"}", "{\"a\":true", "[]", "{\"a\":true}x" };
	size_t i;

	ev_reset();
	for (i = 0; i < sizeof bad / sizeof bad[0]; i++)
	{
		uiapi_event_at("cfgsave", bad[i], T0);
		uiapi_events_json(evjson, sizeof evjson, 1);
		assert(strstr(evjson, "\"detail\":{}}]"));
	}
	uiapi_event_at("cfgsave", "{\"a\":\"x\",\"b\":false,\"c\":null}", T0);
	uiapi_events_json(evjson, sizeof evjson, 1);
	assert(strstr(evjson, "\"detail\":{\"a\":\"x\",\"b\":false,\"c\":null}}]"));
	uiapi_event_at("Bad", "{}", T0);		/* bad kind: not logged */
	uiapi_events_json(evjson, sizeof evjson, 1);
	assert(!strstr(evjson, "Bad"));
	passed++;
}

int main(void)
{
	snprintf(dir, sizeof dir, "/tmp/uiapi-ring-test-%d", (int)getpid());
	assert(mkdir(dir, 0700) == 0);

	test_counts_sum_within_window();
	test_old_buckets_drop();
	test_downtime_counts_zero();
	test_corrupt_file_starts_empty();
	test_truncated_file_starts_empty();
	test_future_stamped_bucket_rejected();
	test_save_is_atomic();
	test_since_fresh_start();
	test_since_sparse_traffic_stays_full();
	test_since_survives_reload();
	test_clock_jump_back_stays_loadable();
	test_shutdown_saves();
	test_event_round_trip();
	test_event_corrupt_line_skipped();
	test_event_oversize_line_skipped();
	test_event_flat_validator();

	unlink(evlog);
	snprintf(path, sizeof path, "%s/uiapi-counters.dat", dir);
	unlink(path);
	rmdir(dir);
	printf("uiapi ring and events: %d passed\n", passed);
	return 0;
}
