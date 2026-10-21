/* uiapi: read-only data for the web UI: counter ring, event log, CMS state, JSON handlers. */

#ifndef UIAPI_H
#define UIAPI_H

#include <stddef.h>
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

/* Event log. kind is lower-case letters; detail_json a flat JSON object
   {"k":"str"|true|false|null,...} of printable ASCII, no spaces, under 384
   bytes (anything else is logged as {}). Kept in
   memory (last 200) and appended to uiapi-events.log; any thread. */
void uiapi_event(const char *kind, const char *detail_json);
void uiapi_event_at(const char *kind, const char *detail_json, time_t now);

/* The newest limit events, newest first, as a JSON array in buf (cap >= 8
   bytes); an event that does not fit ends the list. Returns the length. */
int uiapi_events_json(char *buf, size_t cap, int limit);

/* A "forward" event for a connect to partner BBS bbs. Only a port number is
   taken from the first connect script line, never any other word of it. */
void uiapi_forward_event(const char *bbs, const char *script);

/* Outcome of a CMS connect attempt (1 connected, 0 all servers failed) */
void uiapi_cms_result(int ok);

/* /api/ui handlers for nodeapi.c APIList */
int uiapi_api_station(char *response, char *token, char *param, int Local);
int uiapi_api_links(char *response, char *token, char *param, int Local);
int uiapi_api_cms(char *response, char *token, char *param, int Local);
int uiapi_api_counts(char *response, char *token, char *param, int Local);
int uiapi_api_mheard(char *response, char *token, char *param, int Local);
int uiapi_api_events(char *response, char *token, char *param, int Local);

#endif
