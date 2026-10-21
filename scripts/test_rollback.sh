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
# other calls run the command with the bin directory made writable for the duration.
cat >"$T/shim/sudo" <<'SH'
#!/bin/bash
if [ "$1" = -v ]; then
  if pgrep -x "$FAKE_PROC" >/dev/null; then echo "-v running" >>"$FAKE_T/sudo.log"
  else echo "-v stopped" >>"$FAKE_T/sudo.log"; fi
  exit 0
fi
echo "$*" >>"$FAKE_T/sudo.log"
chmod u+w "$FAKE_T/bin"; "$@"; rc=$?; chmod u-w "$FAKE_T/bin"; exit $rc
SH
chmod +x "$T/shim/cp" "$T/shim/sudo"

# Layout: home/, bin/linbpq (the "new" build), home/linbpq.bak (the "old" one),
# bundle/ holding rollback.sh and the HTML/ the install copied, install-state beside bundle/.
setup() {
  chmod -R u+w "$T/bin" 2>/dev/null
  rm -rf "$T/home" "$T/bin" "$T/bundle" "$T/install-state" "$T/sudo.log" "$T/cp.pid"
  mkdir -p "$T/home/HTML/ui" "$T/bin" "$T/bundle/HTML/ui"
  printf '#!/bin/sh\n# new build\nexec %s\n' "$T/$PROCNAME" >"$T/bin/linbpq"
  printf '#!/bin/sh\n# old build\nexec %s\n' "$T/$PROCNAME" >"$T/home/linbpq.bak"
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
rb() {
  PATH="$T/shim:$PATH" \
  BARBPQ_BIN="$T/bin/linbpq" BARBPQ_BACKUP="$T/home/linbpq.bak" BARBPQ_HTML="$T/home/HTML" \
  BARBPQ_WORKDIR="$T/home" BARBPQ_SESSION=linbpq BARBPQ_PROC="$PROCNAME" BARBPQ_TMUX="$TM" \
  BARBPQ_STOP_WAIT="${STOP_WAIT:-10}" "$T/bundle/rollback.sh" "$@" >"$T/out" 2>&1
  echo $? >"$T/rc"
}
pid() { pgrep -x "$PROCNAME" | head -1; }
mode() { stat -f %Lp "$1" 2>/dev/null || stat -c %a "$1"; }
no_tmp() { [ ! -e "$T/bin/linbpq.rollback-tmp" ]; }
# Wait until rollback.sh has printed $1, then send it SIGTERM.
interrupt_on() {
  for _ in $(seq 1 40); do grep -q "$1" "$T/out" 2>/dev/null && break; sleep 0.25; done
  pkill -TERM -f "$T/bundle/rollback.sh"
}

echo "# installed state, install created ui/"
setup; printf 'html_created=0\nui_created=1\n' >"$T/install-state"; start_fake
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
setup; rm -f "$T/home/HTML/keep.html"; printf 'html_created=1\nui_created=1\n' >"$T/install-state"; start_fake
rb
check "empty HTML dir removed" '[ ! -e "$T/home/HTML" ]'
check "running" '[ -n "$(pid)" ]'

echo "# --record-install-state never downgrades"
setup; rm -rf "$T/home/HTML"
rb --record-install-state
check "exits 0" '[ "$(cat "$T/rc")" = 0 ]'
check "no HTML dir: both recorded as created" '[ "$(cat "$T/install-state")" = "$(printf "html_created=1\nui_created=1")" ]'
mkdir -p "$T/home/HTML/ui"
rb --record-install-state
check "a re-run after the copy keeps html_created=1 and ui_created=1" '[ "$(cat "$T/install-state")" = "$(printf "html_created=1\nui_created=1")" ]'
setup
rb --record-install-state
check "existing HTML/ui and no record: both 0" '[ "$(cat "$T/install-state")" = "$(printf "html_created=0\nui_created=0")" ]'

echo "# linbpq ignores SIGTERM"
setup; printf 'ui_created=1\n' >"$T/install-state"
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
setup; printf 'ui_created=1\n' >"$T/install-state"
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
setup; printf 'ui_created=1\n' >"$T/install-state"
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
setup; printf 'ui_created=1\n' >"$T/install-state"; start_fake
FAKE_CP=fail rb
check "exits 1" '[ "$(cat "$T/rc")" = 1 ]'
check "installed binary untouched" 'cmp -s "$T/new.orig" "$T/bin/linbpq"'
check "no temp file left" 'no_tmp'
check "linbpq running" '[ -n "$(pid)" ]'

echo "# rollback interrupted during the copy"
setup; printf 'ui_created=1\n' >"$T/install-state"; start_fake
FAKE_CP=hang rb & rbpid=$!
for _ in $(seq 1 40); do [ -s "$T/cp.pid" ] && break; sleep 0.25; done
pkill -TERM -f "$T/bundle/rollback.sh"; kill -TERM "$(cat "$T/cp.pid")"
wait "$rbpid"
check "exits 1" '[ "$(cat "$T/rc")" = 1 ]'
check "installed binary untouched" 'cmp -s "$T/new.orig" "$T/bin/linbpq"'
check "no temp file left" 'no_tmp'
check "linbpq running" '[ -n "$(pid)" ]'

echo "# bin directory not writable: sudo -v first, then sudo for the copy and the move"
setup; printf 'ui_created=1\n' >"$T/install-state"; start_fake; chmod u-w "$T/bin"
rb
chmod u+w "$T/bin"
check "exits 0" '[ "$(cat "$T/rc")" = 0 ]'
check "sudo -v ran first, while linbpq was still running" '[ "$(head -1 "$T/sudo.log")" = "-v running" ]'
check "the copy used sudo" 'grep -q "^cp " "$T/sudo.log"'
check "the move used sudo" 'grep -q "^mv -f " "$T/sudo.log"'
check "binary restored" 'cmp -s "$T/home/linbpq.bak" "$T/bin/linbpq"'
check "running" '[ -n "$(pid)" ]'

echo
if [ "$fails" = 0 ]; then echo "rollback tests: all passed"; else
  echo "rollback tests: $fails failed"; echo "--- last output:"; cat "$T/out"; exit 1; fi
