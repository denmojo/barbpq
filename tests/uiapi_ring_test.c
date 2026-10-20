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
	write_file("BPQUIC1\n100 1 2\n", 16);
	assert(uiapi_ring_load(path, T0) == -1);
	zero_totals(T0);
	{
		char b[128];
		snprintf(b, sizeof b, "BPQUIC1\n%ld -5 0 0\n", (long)T0);
		write_file(b, strlen(b));
		assert(uiapi_ring_load(path, T0 + 300) == -1);
		zero_totals(T0 + 300);
		snprintf(b, sizeof b, "BPQUIC1\n%ld 1 0 0 junk\n", (long)T0);
		write_file(b, strlen(b));
		assert(uiapi_ring_load(path, T0 + 300) == -1);
		snprintf(b, sizeof b, "BPQUIC1\n%ld 1 0 0\n%ld 1 0 0\n", (long)T0, (long)T0);
		write_file(b, strlen(b));
		assert(uiapi_ring_load(path, T0 + 300) == -1);
		snprintf(b, sizeof b, "BPQUIC1\n%ld 1 0 0\n", (long)T0 + 7);
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
	snprintf(b, sizeof b, "BPQUIC1\n%ld 4 0 0\n%ld 3 0", (long)T0, (long)T0 + 300);
	write_file(b, strlen(b));
	assert(uiapi_ring_load(path, T0 + 600) == -1);
	zero_totals(T0 + 600);
	write_file("BPQU", 4);
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
	snprintf(b, sizeof b, "BPQUIC1\n%ld 4 0 0\n%ld 1 0 0\n", (long)T0, (long)T0 + 900);
	write_file(b, strlen(b));
	assert(uiapi_ring_load(path, T0 + 300) == -1);
	zero_totals(T0 + 300);
	/* one bucket ahead of now is tolerated (clock skew) */
	snprintf(b, sizeof b, "BPQUIC1\n%ld 4 0 0\n", (long)T0 + 300);
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
	assert(strcmp(magic, "BPQUIC1\n") == 0);
	unlink(path);
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

	rmdir(dir);
	printf("uiapi ring: %d passed\n", passed);
	return 0;
}
