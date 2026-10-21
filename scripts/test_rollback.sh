#!/usr/bin/env bash
# Tests scripts/rollback.sh against a throwaway directory tree, a fake linbpq
# and a private tmux server. Touches no live path and no live tmux session.
# Needs: cc, tmux.   Usage: scripts/test_rollback.sh
set -u
cd "$(dirname "${BASH_SOURCE[0]}")/.."

T="$(mktemp -d)"
SOCK="barbpq-rollback-test-$$"
TM="$(command -v tmux) -L $SOCK"
PROCNAME="fakebpq$$"
PROCNAME="${PROCNAME:0:15}"
export FAKE_PROC="$PROCNAME" FAKE_T="$T"
cleanup() {
  $TM kill-server 2>/dev/null
  pkill -KILL -x "$PROCNAME" 2>/dev/null
  chmod -R u+w "$T" 2>/dev/null
  rm -rf "$T"
}
trap cleanup EXIT
unset TMUX

fails=0
ok() { echo "ok   - $*"; }
no() { echo "FAIL - $*"; fails=$((fails + 1)); }
check() { if eval "$2"; then ok "$1"; else no "$1"; fi; }

# A fake daemon. FAKE_IGNORE_TERM=1: ignores SIGTERM.
# FAKE_TERM_DELAY=n: exits n seconds after SIGTERM, like a node closing its links.
cat >"$T/fake.c" <<'C'
#include <signal.h>
#include <stdlib.h>
#include <unistd.h>
static volatile sig_atomic_t term;
static void on_term(int s) { (void)s; term = 1; }
int main(void) {
  if (getenv("FAKE_IGNORE_TERM")) signal(SIGTERM, SIG_IGN);
  else if (getenv("FAKE_TERM_DELAY")) signal(SIGTERM, on_term);
  for (;;) {
    pause();
    if (term) { sleep((unsigned)atoi(getenv("FAKE_TERM_DELAY"))); return 0; }
  }
}
C
cc -o "$T/$PROCNAME" "$T/fake.c" || { echo "cc failed"; exit 1; }

# Shims first on rollback.sh's PATH. Each passes through unless its FAKE_* switch is set.
mkdir -p "$T/shim"
# cp: FAKE_CP=fail writes half the file and fails; FAKE_CP=hang writes half and hangs.
cat >"$T/shim/cp" <<'SH'
#!/bin/bash
[ -z "${FAKE_CP:-}" ] && exec /bin/cp "$@"
src="${@: -2:1}"; dst="${@: -1}"
head -c 20 "$src" >"$dst"
echo "$$" >"$FAKE_T/cp.pid"
[ "$FAKE_CP" = hang ] && sleep 60
exit 1
SH
# sudo: logs each call; -v records whether linbpq is still running at that moment;
# other calls run the command with the bin directory made writable for the duration
# (left as it was found afterwards).
cat >"$T/shim/sudo" <<'SH'
#!/bin/bash
if [ "$1" = -v ]; then
  if pgrep -x "$FAKE_PROC" >/dev/null; then echo "-v running" >>"$FAKE_T/sudo.log"
  else echo "-v stopped" >>"$FAKE_T/sudo.log"; fi
  exit 0
fi
echo "$*" >>"$FAKE_T/sudo.log"
export UNDER_SUDO=1
w=0; [ -w "$FAKE_T/bin" ] && w=1
chmod u+w "$FAKE_T/bin"; "$@"; rc=$?; [ "$w" = 1 ] || chmod u-w "$FAKE_T/bin"; exit $rc
SH
# pkill: FAKE_PKILL=hang makes the first SIGTERM hang without being sent, as
# if rollback.sh were interrupted between deciding to stop and sending it.
cat >"$T/shim/pkill" <<'SH'
#!/bin/bash
if [ "${FAKE_PKILL:-}" = hang ] && [ "$1" = -TERM ] && [ ! -e "$FAKE_T/pkill.hung" ]; then
  touch "$FAKE_T/pkill.hung"; echo "$$" >"$FAKE_T/pkill.pid"; exec sleep 60
fi
exec /usr/bin/pkill "$@"
SH
# stat and chown: FAKE_ROOT_BIN=1 makes bin/linbpq look owned by root (uid 0),
# and a chown run without sudo fails as it would for an ordinary user.
cat >"$T/shim/stat" <<'SH'
#!/bin/bash
last="${@: -1}"
if [ -n "${FAKE_ROOT_BIN:-}" ] && [ "$last" = "$FAKE_T/bin/linbpq" ] && [[ "$*" == *%u* ]]; then echo 0:0; exit 0; fi
for s in /usr/bin/stat /bin/stat; do [ -x "$s" ] && exec "$s" "$@"; done
SH
cat >"$T/shim/chown" <<'SH'
#!/bin/bash
if [ -n "${FAKE_ROOT_BIN:-}" ]; then
  [ -n "${UNDER_SUDO:-}" ] && exit 0
  echo "chown: Operation not permitted" >&2; exit 1
fi
for c in /usr/sbin/chown /bin/chown /usr/bin/chown; do [ -x "$c" ] && exec "$c" "$@"; done
SH
chmod +x "$T/shim/cp" "$T/shim/sudo" "$T/shim/pkill" "$T/shim/stat" "$T/shim/chown"

# Layout: home/, bin/linbpq (the "new" build), home/linbpq.bak (the "old" one),
# bundle/ holding rollback.sh and the HTML/ the install copied, install-state beside bundle/.
setup() {
  chmod -R u+w "$T/bin" 2>/dev/null
  rm -rf "${T:?}/home" "${T:?}/bin" "${T:?}/bundle" "${T:?}/install-state" "${T:?}/sudo.log" "${T:?}/cp.pid" \
    "${T:?}/proc" "${T:?}/pkill.hung" "${T:?}/pkill.pid" "${T:?}/start.log"
  mkdir -p "$T/home/HTML/ui" "$T/bin" "$T/bundle/HTML/ui"
  # Each build logs its working directory and arguments, one per line, then runs the fake.
  printf '#!/bin/sh\n# new build\n{ pwd; for a in "$@"; do echo "$a"; done; } >"%s/start.log"\nexec %s "$@"\n' "$T" "$T/$PROCNAME" >"$T/bin/linbpq"
  printf '#!/bin/sh\n# old build\n{ pwd; for a in "$@"; do echo "$a"; done; } >"%s/start.log"\nexec %s "$@"\n' "$T" "$T/$PROCNAME" >"$T/home/linbpq.bak"
  chmod 750 "$T/bin/linbpq"; chmod 755 "$T/home/linbpq.bak"
  cp "$T/bin/linbpq" "$T/new.orig"
  cp scripts/rollback.sh "$T/bundle/"
  for d in "$T/bundle/HTML" "$T/home/HTML"; do
    echo page >"$d/index.html"; echo page >"$d/indexnoaprs.html"
    echo js >"$d/ui/index-abc.js"; echo css >"$d/ui/style-abc.css"
  done
  echo mine >"$T/home/HTML/keep.html"
}
start_fake() {
  $TM kill-server 2>/dev/null
  pkill -KILL -x "$PROCNAME" 2>/dev/null; sleep 0.5
  $TM new-session -d -s linbpq -c "$T/home"
  $TM send-keys -t linbpq "cd '$T/home' && '$T/bin/linbpq'" Enter
  for _ in 1 2 3 4 5 6 7 8 9 10; do pgrep -x "$PROCNAME" >/dev/null && return; sleep 0.5; done
  echo "fake did not start"; exit 1
}
# RB_WORKDIR= (empty) leaves the working directory to install-state;
# RB_PROCFS points at a fake /proc (the default has none, so ps is used).
rb() {
  PATH="$T/shim:$PATH" \
  BARBPQ_BIN="$T/bin/linbpq" BARBPQ_BACKUP="$T/home/linbpq.bak" BARBPQ_HTML="${RB_HTML:-$T/home/HTML}" \
  BARBPQ_WORKDIR="${RB_WORKDIR-$T/home}" BARBPQ_SESSION=linbpq BARBPQ_PROC="$PROCNAME" BARBPQ_TMUX="$TM" \
  BARBPQ_PROCFS="${RB_PROCFS:-$T/noproc}" \
  BARBPQ_STOP_WAIT="${STOP_WAIT:-10}" "$T/bundle/rollback.sh" "$@" >"$T/out" 2>&1
  echo $? >"$T/rc"
}
# start_fake_as_pane: linbpq is the tmux pane's own command, not typed into a shell,
# so the pane (and the one-window session) closes when it exits.
start_fake_as_pane() {
  $TM kill-server 2>/dev/null
  pkill -KILL -x "$PROCNAME" 2>/dev/null; sleep 0.5
  $TM new-session -d -s linbpq -c "$T/home" "'$T/bin/linbpq' mail"
  for _ in 1 2 3 4 5 6 7 8 9 10; do pgrep -x "$PROCNAME" >/dev/null && return; sleep 0.5; done
  echo "fake did not start"; exit 1
}
# A fake /proc entry for the running fake: argv and cwd.
fake_proc() {
  local p; p="$(pid)"
  mkdir -p "$T/proc/$p"
  printf '%s\0' "$@" >"$T/proc/$p/cmdline"
  ln -s "$T/home" "$T/proc/$p/cwd"
}
st_line() { grep -E "^$1=" "$T/install-state" | cut -d= -f2-; }
log_line() { sed -n "${1}p" "$T/start.log"; }
pid() { pgrep -x "$PROCNAME" | head -1; }
mode() { stat -f %Lp "$1" 2>/dev/null || stat -c %a "$1"; }
no_tmp() { [ ! -e "$T/bin/linbpq.rollback-tmp" ]; }
# Wait until rollback.sh has printed $1, then send it SIGTERM.
interrupt_on() {
  for _ in $(seq 1 40); do grep -q "$1" "$T/out" 2>/dev/null && break; sleep 0.25; done
  pkill -TERM -f "$T/bundle/rollback.sh"
}

echo "# installed state, install created ui/"
setup; printf 'html=%s\nhtml_created=0\nui_created=1\n' "$T/home/HTML" >"$T/install-state"; start_fake
p0="$(pid)"
rb --dry-run
check "dry run exits 0" '[ "$(cat "$T/rc")" = 0 ]'
check "dry run leaves the binary" 'cmp -s "$T/new.orig" "$T/bin/linbpq"'
check "dry run leaves the pages" '[ -e "$T/home/HTML/index.html" ] && [ -d "$T/home/HTML/ui" ]'
check "dry run leaves linbpq running, same pid" '[ "$(pid)" = "$p0" ]'
check "dry run says what it would do" 'grep -q "would run: rm -f $T/home/HTML/index.html" "$T/out"'
check "dry run leaves no temp file" 'no_tmp'

rb
check "rollback exits 0" '[ "$(cat "$T/rc")" = 0 ]'
check "binary restored from backup" 'cmp -s "$T/home/linbpq.bak" "$T/bin/linbpq"'
check "restored binary keeps the installed file mode (750)" '[ "$(mode "$T/bin/linbpq")" = 750 ]'
check "no temp file left" 'no_tmp'
check "index.html and indexnoaprs.html removed" '[ ! -e "$T/home/HTML/index.html" ] && [ ! -e "$T/home/HTML/indexnoaprs.html" ]'
check "ui/ removed (install created it)" '[ ! -e "$T/home/HTML/ui" ]'
check "other HTML files kept" '[ -e "$T/home/HTML/keep.html" ]'
p1="$(pid)"
check "linbpq running again, new pid" '[ -n "$p1" ] && [ "$p1" != "$p0" ]'
check "it reports the restart" 'grep -q "linbpq started" "$T/out"'

echo "# second run"
rb
check "second run exits 0" '[ "$(cat "$T/rc")" = 0 ]'
check "second run does not restart linbpq" '[ "$(pid)" = "$p1" ]'
check "second run sees the binary already restored" 'grep -q "already matches the backup" "$T/out"'

echo "# no install-state: ui/ was there before"
setup; echo old >"$T/home/HTML/ui/theirs.js"; start_fake
rb
check "exits 0" '[ "$(cat "$T/rc")" = 0 ]'
check "only the bundle's ui files removed" '[ ! -e "$T/home/HTML/ui/index-abc.js" ] && [ ! -e "$T/home/HTML/ui/style-abc.css" ] && [ -e "$T/home/HTML/ui/theirs.js" ]'
check "binary restored" 'cmp -s "$T/home/linbpq.bak" "$T/bin/linbpq"'
check "running" '[ -n "$(pid)" ]'

echo "# install created HTML/ too and nothing else is in it"
setup; rm -f "$T/home/HTML/keep.html"; printf 'html=%s\nhtml_created=1\nui_created=1\n' "$T/home/HTML" >"$T/install-state"; start_fake
rb
check "empty HTML dir removed" '[ ! -e "$T/home/HTML" ]'
check "running" '[ -n "$(pid)" ]'

echo "# --record-install-state never downgrades"
setup; rm -rf "$T/home/HTML"
rb --record-install-state
check "exits 0" '[ "$(cat "$T/rc")" = 0 ]'
check "no HTML dir: both recorded as created" '[ "$(st_line html_created)" = 1 ] && [ "$(st_line ui_created)" = 1 ]'
mkdir -p "$T/home/HTML/ui"
rb --record-install-state
check "a re-run after the copy keeps html_created=1 and ui_created=1" '[ "$(st_line html_created)" = 1 ] && [ "$(st_line ui_created)" = 1 ]'
setup
rb --record-install-state
check "existing HTML/ui and no record: both 0" '[ "$(st_line html_created)" = 0 ] && [ "$(st_line ui_created)" = 0 ]'

echo "# linbpq ignores SIGTERM"
setup; printf 'html=%s\nui_created=1\n' "$T/home/HTML" >"$T/install-state"
export FAKE_IGNORE_TERM=1; start_fake; p0="$(pid)"
STOP_WAIT=2 rb
unset FAKE_IGNORE_TERM
check "exits 0" '[ "$(cat "$T/rc")" = 0 ]'
check "fell back to SIGKILL" 'grep -q SIGKILL "$T/out"'
check "binary restored" 'cmp -s "$T/home/linbpq.bak" "$T/bin/linbpq"'
check "running, new pid" '[ -n "$(pid)" ] && [ "$(pid)" != "$p0" ]'

echo "# backup missing, linbpq stopped, no tmux session"
setup; rm -f "$T/home/linbpq.bak"; $TM kill-server 2>/dev/null; pkill -KILL -x "$PROCNAME"; sleep 0.5
rb
check "exits 1" '[ "$(cat "$T/rc")" = 1 ]'
check "says the backup is missing" 'grep -q "backup .* missing" "$T/out"'
check "binary left as it is" 'cmp -s "$T/new.orig" "$T/bin/linbpq"'
check "linbpq started anyway, in a new session" '[ -n "$(pid)" ] && $TM has-session -t linbpq'

echo "# rollback killed (SIGTERM) while waiting for a linbpq that ignores SIGTERM"
setup; printf 'html=%s\nui_created=1\n' "$T/home/HTML" >"$T/install-state"
export FAKE_IGNORE_TERM=1; start_fake; p0="$(pid)"
STOP_WAIT=4 rb & rbpid=$!
interrupt_on "stopping linbpq"
wait "$rbpid"
unset FAKE_IGNORE_TERM
check "exits 1" '[ "$(cat "$T/rc")" = 1 ]'
check "reports the interruption" 'grep -q interrupted "$T/out"'
check "binary untouched" 'cmp -s "$T/new.orig" "$T/bin/linbpq"'
check "linbpq running, new pid (the stop was finished, then it was started)" '[ -n "$(pid)" ] && [ "$(pid)" != "$p0" ]'

echo "# rollback killed while linbpq is still closing after SIGTERM"
setup; printf 'html=%s\nui_created=1\n' "$T/home/HTML" >"$T/install-state"
export FAKE_TERM_DELAY=3; start_fake; p0="$(pid)"
STOP_WAIT=10 rb & rbpid=$!
interrupt_on "stopping linbpq"
wait "$rbpid"
unset FAKE_TERM_DELAY
sleep 4
check "exits 1" '[ "$(cat "$T/rc")" = 1 ]'
check "waited for the old process to exit" 'grep -q "waiting for linbpq to exit" "$T/out"'
check "linbpq running afterwards, new pid" '[ -n "$(pid)" ] && [ "$(pid)" != "$p0" ]'

echo "# the copy of the backup fails half-written"
setup; printf 'html=%s\nui_created=1\n' "$T/home/HTML" >"$T/install-state"; start_fake
FAKE_CP=fail rb
check "exits 1" '[ "$(cat "$T/rc")" = 1 ]'
check "installed binary untouched" 'cmp -s "$T/new.orig" "$T/bin/linbpq"'
check "no temp file left" 'no_tmp'
check "linbpq running" '[ -n "$(pid)" ]'

echo "# rollback interrupted during the copy"
setup; printf 'html=%s\nui_created=1\n' "$T/home/HTML" >"$T/install-state"; start_fake
FAKE_CP=hang rb & rbpid=$!
for _ in $(seq 1 40); do [ -s "$T/cp.pid" ] && break; sleep 0.25; done
pkill -TERM -f "$T/bundle/rollback.sh"; kill -TERM "$(cat "$T/cp.pid")"
wait "$rbpid"
check "exits 1" '[ "$(cat "$T/rc")" = 1 ]'
check "installed binary untouched" 'cmp -s "$T/new.orig" "$T/bin/linbpq"'
check "no temp file left" 'no_tmp'
check "linbpq running" '[ -n "$(pid)" ]'

echo "# bin directory not writable: sudo -v first, then sudo for the copy and the move"
setup; printf 'html=%s\nui_created=1\n' "$T/home/HTML" >"$T/install-state"; start_fake; chmod u-w "$T/bin"
rb
chmod u+w "$T/bin"
check "exits 0" '[ "$(cat "$T/rc")" = 0 ]'
check "sudo -v ran first, while linbpq was still running" '[ "$(head -1 "$T/sudo.log")" = "-v running" ]'
check "the copy used sudo" 'grep -q "^cp " "$T/sudo.log"'
check "the move used sudo" 'grep -q "^mv -f " "$T/sudo.log"'
check "binary restored" 'cmp -s "$T/home/linbpq.bak" "$T/bin/linbpq"'
check "running" '[ -n "$(pid)" ]'

echo "# --record-install-state records the running node's arguments and working directory"
setup; start_fake; fake_proc /usr/local/bin/linbpq mail 'logdir=/var/log/a b'
RB_PROCFS="$T/proc" rb --record-install-state
check "exits 0" '[ "$(cat "$T/rc")" = 0 ]'
check "arguments recorded as shell words, argv[0] left out" '[ "$(st_line args)" = "mail logdir=/var/log/a\ b" ]'
check "working directory recorded" '[ "$(st_line workdir)" = "$T/home" ]'
check "it reports the tmux pane layout" 'grep -q "tmux panes in .linbpq.: 0.0 " "$T/out"'
pkill -KILL -x "$PROCNAME"; sleep 0.5
RB_PROCFS="$T/proc" rb --record-install-state
check "a re-run with linbpq stopped keeps the recorded arguments" '[ "$(st_line args)" = "mail logdir=/var/log/a\ b" ] && [ "$(st_line workdir)" = "$T/home" ]'
setup; $TM kill-server 2>/dev/null; pkill -KILL -x "$PROCNAME" 2>/dev/null; sleep 0.5
$TM new-session -d -s linbpq -c "$T/home"
$TM send-keys -t linbpq "cd '$T/home' && '$T/bin/linbpq' mail" Enter
for _ in 1 2 3 4 5 6 7 8 9 10; do [ -n "$(pid)" ] && break; sleep 0.5; done
rb --record-install-state
check "without /proc the arguments come from ps" '[ "$(st_line args)" = mail ] && grep -q "reading the arguments from ps" "$T/out"'

echo "# --start: tmux session gone, linbpq stopped; recorded directory and arguments reused"
setup; $TM kill-server 2>/dev/null; pkill -KILL -x "$PROCNAME" 2>/dev/null; sleep 0.5
printf 'html_created=0\nui_created=0\nworkdir=%s\nargs=mail logdir=/var/log/a\\ b\n' "$T/home/HTML" >"$T/install-state"
RB_WORKDIR= rb --start
check "exits 0" '[ "$(cat "$T/rc")" = 0 ]'
check "running, in a new session" '[ -n "$(pid)" ] && $TM has-session -t linbpq'
check "started in the recorded working directory" '[ "$(log_line 1)" = "$T/home/HTML" ]'
check "started with the recorded arguments" '[ "$(log_line 2)" = mail ] && [ "$(log_line 3)" = "logdir=/var/log/a b" ] && [ -z "$(log_line 4)" ]'
check "binary and pages untouched" 'cmp -s "$T/new.orig" "$T/bin/linbpq" && [ -e "$T/home/HTML/index.html" ]'
p0="$(pid)"
rb --start
check "a second --start leaves the running linbpq alone" '[ "$(cat "$T/rc")" = 0 ] && [ "$(pid)" = "$p0" ] && grep -q "linbpq is running" "$T/out"'

echo "# --start: BARBPQ_ARGS overrides the record; --dry-run starts nothing"
setup; $TM kill-server 2>/dev/null; pkill -KILL -x "$PROCNAME" 2>/dev/null; sleep 0.5
printf 'args=mail\n' >"$T/install-state"
BARBPQ_ARGS= rb --start --dry-run
check "dry run starts nothing and shows the command" '[ "$(cat "$T/rc")" = 0 ] && [ -z "$(pid)" ] && grep -q "would start linbpq" "$T/out"'
BARBPQ_ARGS="chat" rb --start
check "started with BARBPQ_ARGS" '[ "$(log_line 2)" = chat ] && [ -z "$(log_line 3)" ]'

echo "# --start: the pane is not at a shell prompt"
setup; $TM kill-server 2>/dev/null; pkill -KILL -x "$PROCNAME" 2>/dev/null; sleep 0.5
printf 'args=mail\n' >"$T/install-state"
$TM new-session -d -s linbpq -c "$T/home" "sleep 600"
rb --start
check "exits 0" '[ "$(cat "$T/rc")" = 0 ]'
check "used a new window" 'grep -q "starting linbpq in a new window" "$T/out" && [ "$($TM list-windows -t linbpq | wc -l | tr -d " ")" = 2 ]'
check "running with the recorded arguments" '[ -n "$(pid)" ] && [ "$(log_line 2)" = mail ]'

echo "# rollback where linbpq is the tmux pane's own process (its exit closes the session)"
setup; printf 'html=%s\nui_created=1\nargs=mail\n' "$T/home/HTML" >"$T/install-state"; start_fake_as_pane; p0="$(pid)"
rb
check "exits 0" '[ "$(cat "$T/rc")" = 0 ]'
check "binary restored" 'cmp -s "$T/home/linbpq.bak" "$T/bin/linbpq"'
check "running again, new pid, in a recreated session" '[ -n "$(pid)" ] && [ "$(pid)" != "$p0" ] && $TM has-session -t linbpq'
check "said the session was gone" 'grep -q "tmux session .linbpq. not found" "$T/out"'
check "restarted with the recorded arguments" '[ "$(log_line 2)" = mail ]'

echo "# defaults are relative to \$HOME"
setup; start_fake
HOME="$T/home" PATH="$T/shim:$PATH" BARBPQ_BIN="$T/bin/linbpq" BARBPQ_PROC="$PROCNAME" BARBPQ_TMUX="$TM" \
  "$T/bundle/rollback.sh" --dry-run >"$T/out" 2>&1
check "backup and HTML default under \$HOME" 'grep -q "backup $T/home/linbpq-6.0.26.1.bak, HTML $T/home/HTML," "$T/out"'

echo "# rollback interrupted after deciding to stop, before SIGTERM went out"
setup; printf 'html=%s\nui_created=1\n' "$T/home/HTML" >"$T/install-state"
export FAKE_TERM_DELAY=1; start_fake; p0="$(pid)"
FAKE_PKILL=hang STOP_WAIT=4 rb & rbpid=$!
for _ in $(seq 1 40); do [ -s "$T/pkill.pid" ] && break; sleep 0.25; done
pkill -TERM -f "$T/bundle/rollback.sh"; kill -TERM "$(cat "$T/pkill.pid")"
wait "$rbpid"
unset FAKE_TERM_DELAY
check "exits 1" '[ "$(cat "$T/rc")" = 1 ]'
check "sent the SIGTERM it had not sent" 'grep -q "a stop was starting; sending SIGTERM" "$T/out"'
check "no SIGKILL: linbpq exited on the SIGTERM" '! grep -q SIGKILL "$T/out"'
check "linbpq running afterwards, new pid" '[ -n "$(pid)" ] && [ "$(pid)" != "$p0" ]'

echo "# bin directory writable, binary owned by root: sudo for the chown only"
setup; printf 'html=%s\nui_created=1\n' "$T/home/HTML" >"$T/install-state"; start_fake
FAKE_ROOT_BIN=1 rb
check "exits 0" '[ "$(cat "$T/rc")" = 0 ]'
check "sudo -v ran first, while linbpq was still running" '[ "$(head -1 "$T/sudo.log")" = "-v running" ]'
check "the chown used sudo" 'grep -q "^chown 0:0 $T/bin/linbpq.rollback-tmp" "$T/sudo.log"'
check "the copy and the move did not" '! grep -q "^cp \|^mv " "$T/sudo.log"'
check "binary restored" 'cmp -s "$T/home/linbpq.bak" "$T/bin/linbpq"'
check "running" '[ -n "$(pid)" ]'

echo "# install-state names the HTML directory it describes"
setup; rm -rf "$T/home/HTML/ui"
rb --record-install-state
check "the record names the HTML directory" '[ "$(st_line html)" = "$T/home/HTML" ]'
RB_HTML="$T/home/HTML/" rb --record-install-state
check "a re-run naming the same directory with a trailing slash is accepted" '[ "$(cat "$T/rc")" = 0 ] && [ "$(st_line ui_created)" = 1 ]'
mkdir -p "$T/other"
RB_HTML="$T/other" rb --record-install-state
check "a re-run naming another directory is refused" '[ "$(cat "$T/rc")" = 1 ] && grep -q "describes $T/home/HTML" "$T/out"'
check "the refused re-run leaves the record as it was" '[ "$(st_line html)" = "$T/home/HTML" ] && [ "$(st_line ui_created)" = 1 ]'

setup; printf 'html=%s\nhtml_created=0\nui_created=1\n' "$T/elsewhere/HTML" >"$T/install-state"; start_fake; p0="$(pid)"
rb
check "rollback with another BARBPQ_HTML than the record: exits 1" '[ "$(cat "$T/rc")" = 1 ]'
check "it names both directories" 'grep -q "describes $T/elsewhere/HTML" "$T/out" && grep -q "BARBPQ_HTML is $T/home/HTML" "$T/out"'
check "it removes no page" '[ -e "$T/home/HTML/index.html" ] && [ -e "$T/home/HTML/ui/index-abc.js" ]'
check "it leaves the binary" 'cmp -s "$T/new.orig" "$T/bin/linbpq"'
check "linbpq left running, same pid" '[ "$(pid)" = "$p0" ]'
RB_HTML="$T/elsewhere/HTML" rb
check "the same rollback with the recorded BARBPQ_HTML goes ahead" '[ "$(cat "$T/rc")" = 0 ] && cmp -s "$T/home/linbpq.bak" "$T/bin/linbpq"'

setup; printf 'html_created=0\nui_created=1\n' >"$T/install-state"; start_fake; p0="$(pid)"
rb
check "a record with created flags and no html= line is refused" '[ "$(cat "$T/rc")" = 1 ] && grep -q "does not name the HTML directory" "$T/out"'
check "nothing removed, binary left, same pid" '[ -d "$T/home/HTML/ui" ] && cmp -s "$T/new.orig" "$T/bin/linbpq" && [ "$(pid)" = "$p0" ]'

echo
if [ "$fails" = 0 ]; then echo "rollback tests: all passed"; else
  echo "rollback tests: $fails failed"; echo "--- last output:"; cat "$T/out"; exit 1; fi
