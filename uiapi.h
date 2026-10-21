/* SPDX-License-Identifier: GPL-3.0-or-later
   Copyright (C) 2026 Dennis Mojado */

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

/* A forward run to partner BBS bbs is starting. Only a port number is taken
   from the first connect script line, never any other word of it. The
   "forward" event is written when the next CMS result arrives, carrying it
   as cmsReachable, or with cmsReachable null if none comes within 120 s
   (checked by uiapi_tick), if another run starts first, or at shutdown.
   alt is 1 for a connect script's ELSE leg: it continues the run its first
   leg started and logs no event of its own. */
void uiapi_forward_event(const char *bbs, const char *script, int alt);
void uiapi_forward_event_at(const char *bbs, const char *script, int alt, time_t now);

/* Outcome of a CMS connect attempt (1 connected, 0 all servers failed) */
void uiapi_cms_result(int ok);
void uiapi_cms_result_at(int ok, time_t now);

/* The Telnet port refused a CMS connect without trying it, because it holds
   the CMS down ("Error - CMS Not Available"). A forward run waiting for its
   CMS result is logged unreachable; the CMS state is left as it is, since no
   attempt was made. */
void uiapi_cms_refused(void);
void uiapi_cms_refused_at(time_t now);

/* The HTTP layer calls this before each /api request: 1 when the request
   carries a live node sysop session cookie. /api/ui/events reads it. */
void uiapi_set_sysop(int signed_in);

/* The /api/ui/events reply: the newest events as JSON for a sysop, or a full
   401 reply with a JSON body for anyone else. Returns the length. */
int uiapi_events_reply(char *response, size_t cap, const char *param, int sysop);

/* Link state of a KISS port (PORTTYPE 0), from the same fields of its
   device's first port that the node's own PORTS command reads (Cmd.c:1753-1806).
   Returns "linked", "down" or "unknown" and puts the reason in detail. */
struct ui_kiss_link
{
	int have;	/* KISSInfo[] holds a device record for the port */
	int stopped;	/* PORTCONTROL.PortStopped (STOPPORT) */
	int ip;		/* PORTIPADDR set or KISSSLAVE: KISS over UDP or TCP */
	int tcp;	/* PORTCONTROL.KISSTCP */
	int slave;	/* PORTCONTROL.KISSSLAVE: the node listens for the TCP client */
	int connected;	/* ASYINFO.Connected (TCP) */
	int open;	/* ASYINFO.idComDev != 0 (serial device open) */
};
const char *uiapi_kiss_link(const struct ui_kiss_link *k, char *detail, size_t cap);

/* Link state of a BPQAXIP port. sockets is the count of the driver's sockets
   that are open (and bound to their configured port, for UDP); unbound_udp
   is a configured UDP port with no socket bound to it (0 = none); heard holds
   each MAP entry's LastHeard (0 = never). "down" when a UDP port is unbound
   or no socket is open, else "linked"; detail counts the entries heard within
   the hour, the node's own AXIP Up test (HTTPcode.c:4289). */
const char *uiapi_axip_link(int sockets, int unbound_udp, const time_t *heard, int n,
	time_t now, char *detail, size_t cap);

/* /api/ui handlers for nodeapi.c APIList */
int uiapi_api_station(char *response, char *token, char *param, int Local);
int uiapi_api_links(char *response, char *token, char *param, int Local);
int uiapi_api_cms(char *response, char *token, char *param, int Local);
int uiapi_api_counts(char *response, char *token, char *param, int Local);
int uiapi_api_mheard(char *response, char *token, char *param, int Local);
int uiapi_api_events(char *response, char *token, char *param, int Local);

#endif
