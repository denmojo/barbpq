/* uiapi: read-only data for the web UI. Counter ring part. */

#ifndef UIAPI_H
#define UIAPI_H

#include <time.h>

enum ui_counter { UI_SESSIONS, UI_MESSAGES, UI_FRAMES, UI_NCOUNTERS };

/* Count one event now / at a given time (the _at form is for tests) */
void uiapi_count(enum ui_counter c);
void uiapi_count_at(enum ui_counter c, time_t when);

/* Totals over the 24 hours before now. window_start is max(since, now-86400), where
   since is when counting began (persisted); full is 1 once now-since >= 86100.
   If since is unknown (0), the oldest bucket stands in for it. */
void uiapi_ring_totals(time_t now, long out[UI_NCOUNTERS], time_t *window_start, int *full);

/* Replace the ring from a file. Returns buckets kept, or -1 for a missing or
   rejected file (the ring is then empty). */
int uiapi_ring_load(const char *path, time_t now);

/* Write the ring to path.tmp, fsync, rename over path. Returns 0, or -1 on error. */
int uiapi_ring_save(const char *path);

/* Same, with the clock supplied (buckets stamped after now+300 are dropped) */
int uiapi_ring_save_at(const char *path, time_t now);

/* Set the save path to <bpqdir>/uiapi-counters.dat and load it */
void uiapi_init(const char *bpqdir);
void uiapi_init_at(const char *bpqdir, time_t now);

/* Save to the path given to uiapi_init; call on clean shutdown */
void uiapi_shutdown(void);

/* Call about once a second; saves the ring each time a 5 minute bucket closes */
void uiapi_tick(time_t now);

#endif
