#!/usr/bin/env bash
# Tests scripts/rollback.sh against a throwaway directory tree, a fake linbpq
# and a private tmux server. Touches no real path and no real tmux session.
# Needs: cc, tmux.   Usage: scripts/test_rollback.sh
set -u
cd "$(dirname "${BASH_SOURCE[0]}")/.."
REPO="$PWD"

T="$(mktemp -d)"
SOCK="barbpq-rollback-test-$$"
TM="$(command -v tmux) -L $SOCK"
PROCNAME="fakebpq$$"
PROCNAME="${PROCNAME:0:15}"
cleanup() {
  $TM kill-server 2>/dev/null
  pkill -KILL -x "$PROCNAME" 2>/dev/null
  rm -rf "$T"
}
trap cleanup EXIT
unset TMUX

fails=0
ok() { echo "ok   - $*"; }
no() { echo "FAIL - $*"; fails=$((fails + 1)); }
check() { if eval "$2"; then ok "$1"; else no "$1"; fi; }

# A fake daemon: sleeps; ignores SIGTERM when FAKE_IGNORE_TERM=1.
cat >"$T/fake.c" <<'C'
#include <signal.h>
#include <stdlib.h>
#include <unistd.h>
int main(void) {
  if (getenv("FAKE_IGNORE_TERM")) signal(SIGTERM, SIG_IGN);
  for (;;) pause();
}
C
cc -o "$T/$PROCNAME" "$T/fake.c" || { echo "cc failed"; exit 1; }

# Layout: home/, bin/linbpq (the "new" build), home/linbpq.bak (the "old" one),
# bundle/ holding rollback.sh and the HTML/ the install copied.
setup() {
  rm -rf "$T/home" "$T/bin" "$T/bundle"
  mkdir -p "$T/home/HTML/ui" "$T/bin" "$T/bundle/HTML/ui"
  printf '#!/bin/sh\n# new build\nexec %s\n' "$T/$PROCNAME" >"$T/bin/linbpq"
  printf '#!/bin/sh\n# old build\nexec %s\n' "$T/$PROCNAME" >"$T/home/linbpq.bak"
  chmod +x "$T/bin/linbpq" "$T/home/linbpq.bak"
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
  BARBPQ_BIN="$T/bin/linbpq" BARBPQ_BACKUP="$T/home/linbpq.bak" BARBPQ_HTML="$T/home/HTML" \
  BARBPQ_WORKDIR="$T/home" BARBPQ_SESSION=linbpq BARBPQ_PROC="$PROCNAME" BARBPQ_TMUX="$TM" \
  BARBPQ_STOP_WAIT="${STOP_WAIT:-10}" "$T/bundle/rollback.sh" "$@" >"$T/out" 2>&1
  echo $? >"$T/rc"
}
pid() { pgrep -x "$PROCNAME" | head -1; }

echo "# installed state, install created ui/"
setup; printf 'html_created=0\nui_created=1\n' >"$T/bundle/install-state"; start_fake
p0="$(pid)"
rb --dry-run
check "dry run exits 0" '[ "$(cat "$T/rc")" = 0 ]'
check "dry run leaves the binary" 'grep -q "new build" "$T/bin/linbpq"'
check "dry run leaves the pages" '[ -e "$T/home/HTML/index.html" ] && [ -d "$T/home/HTML/ui" ]'
check "dry run leaves linbpq running, same pid" '[ "$(pid)" = "$p0" ]'
check "dry run says what it would do" 'grep -q "would run: rm -f $T/home/HTML/index.html" "$T/out"'

rb
check "rollback exits 0" '[ "$(cat "$T/rc")" = 0 ]'
check "binary restored from backup" 'cmp -s "$T/home/linbpq.bak" "$T/bin/linbpq"'
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
setup; rm -f "$T/bundle/install-state"; echo old >"$T/home/HTML/ui/theirs.js"; start_fake
rb
check "exits 0" '[ "$(cat "$T/rc")" = 0 ]'
check "only the bundle's ui files removed" '[ ! -e "$T/home/HTML/ui/index-abc.js" ] && [ ! -e "$T/home/HTML/ui/style-abc.css" ] && [ -e "$T/home/HTML/ui/theirs.js" ]'
check "binary restored" 'cmp -s "$T/home/linbpq.bak" "$T/bin/linbpq"'
check "running" '[ -n "$(pid)" ]'

echo "# install created HTML/ too and nothing else is in it"
setup; rm -f "$T/home/HTML/keep.html"; printf 'html_created=1\nui_created=1\n' >"$T/bundle/install-state"; start_fake
rb
check "empty HTML dir removed" '[ ! -e "$T/home/HTML" ]'
check "running" '[ -n "$(pid)" ]'

echo "# linbpq ignores SIGTERM"
setup; printf 'ui_created=1\n' >"$T/bundle/install-state"
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
check "binary left as it is" 'grep -q "new build" "$T/bin/linbpq"'
check "linbpq started anyway, in a new session" '[ -n "$(pid)" ] && $TM has-session -t linbpq'

echo "# killed (SIGTERM) while waiting for linbpq to stop"
setup; printf 'ui_created=1\n' >"$T/bundle/install-state"
export FAKE_IGNORE_TERM=1; start_fake
STOP_WAIT=30 rb & rbpid=$!
for _ in $(seq 1 20); do grep -q "stopping linbpq" "$T/out" 2>/dev/null && break; sleep 0.5; done
pkill -TERM -f "$T/bundle/rollback.sh"
wait "$rbpid"
unset FAKE_IGNORE_TERM
check "exits 1" '[ "$(cat "$T/rc")" = 1 ]'
check "reports the interruption" 'grep -q interrupted "$T/out"'
check "linbpq still running" '[ -n "$(pid)" ]'

echo
if [ "$fails" = 0 ]; then echo "rollback tests: all passed"; else
  echo "rollback tests: $fails failed"; echo "--- last output:"; cat "$T/out"; exit 1; fi
