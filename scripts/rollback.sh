#!/usr/bin/env bash
# Roll a node back from a BarBPQ install. Run it on the node, from the bundle
# directory (the one holding SHA256SUMS and install-state).
#
#   ./rollback.sh [--dry-run]
#
# What it does:
#   1. removes index.html and indexnoaprs.html from the HTML directory, and
#      the ui/ directory when install-state says the install created it
#      (otherwise only the ui/ files this bundle shipped)
#   2. if the installed binary differs from the backup: stops linbpq and
#      copies the backup over the installed binary
#   3. always, on any exit: starts linbpq in its tmux session if it is not
#      running
# Safe to run twice: every step checks the current state first.
#
# Paths come from these environment variables (defaults are the gateway's):
#   BARBPQ_BIN       installed binary          /usr/local/bin/linbpq
#   BARBPQ_BACKUP    backup binary             /home/<user>/linbpq-6.0.26.1.bak
#   BARBPQ_HTML      node HTML directory       /home/<user>/HTML
#   BARBPQ_WORKDIR   linbpq working directory  /home/<user>
#   BARBPQ_SESSION   tmux session name         linbpq
#   BARBPQ_PROC      process name to match     linbpq
#   BARBPQ_TMUX      tmux command              tmux
#   BARBPQ_STATE     install-state file        <bundle>/install-state
#   BARBPQ_STOP_WAIT seconds to wait for stop  30

# No `set -e`: a failed step must never skip the restart at the end.
set -u

BUNDLE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN="${BARBPQ_BIN:-/usr/local/bin/linbpq}"
BACKUP="${BARBPQ_BACKUP:-/home/<user>/linbpq-6.0.26.1.bak}"
HTML="${BARBPQ_HTML:-/home/<user>/HTML}"
WORKDIR="${BARBPQ_WORKDIR:-/home/<user>}"
SESSION="${BARBPQ_SESSION:-linbpq}"
PROC="${BARBPQ_PROC:-linbpq}"
TMUX_CMD="${BARBPQ_TMUX:-tmux}"
STATE="${BARBPQ_STATE:-$BUNDLE/install-state}"
STOP_WAIT="${BARBPQ_STOP_WAIT:-30}"

DRY=0
case "${1:-}" in
  "") ;;
  --dry-run) DRY=1 ;;
  -h|--help) sed -n '2,/^$/p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
  *) echo "usage: $0 [--dry-run]" >&2; exit 2 ;;
esac

FAILED=0
say() { echo "rollback: $*"; }
fail() { echo "rollback: FAILED: $*" >&2; FAILED=1; }
# Run a command, or only show it under --dry-run.
act() {
  if [ "$DRY" = 1 ]; then echo "rollback: would run: $*"; return 0; fi
  echo "rollback: run: $*"
  "$@"
}
running() { pgrep -x "$PROC" >/dev/null 2>&1; }
tmuxc() { $TMUX_CMD "$@"; }

# Step 3, registered first so it runs on every exit path, including Ctrl-C.
ensure_running() {
  trap - EXIT INT TERM HUP
  if running; then
    say "linbpq is running (pid $(pgrep -x "$PROC" | tr '\n' ' '))"
  elif [ "$DRY" = 1 ]; then
    say "would start linbpq in tmux session '$SESSION': cd $WORKDIR && $BIN"
  else
    local start="cd '$WORKDIR' && '$BIN'"
    if ! tmuxc has-session -t "$SESSION" 2>/dev/null; then
      say "tmux session '$SESSION' not found; creating it"
      tmuxc new-session -d -s "$SESSION" -c "$WORKDIR" || fail "could not create tmux session '$SESSION'"
    fi
    # Type into the pane only when it sits at a shell; otherwise use a new window.
    local cmd
    cmd="$(tmuxc display-message -p -t "$SESSION" '#{pane_current_command}' 2>/dev/null)"
    case "$cmd" in
      bash|sh|dash|zsh|ksh|fish) ;;
      *) say "pane is running '$cmd'; starting linbpq in a new window"
         tmuxc new-window -t "$SESSION" -c "$WORKDIR" || fail "could not open a tmux window" ;;
    esac
    say "starting linbpq in tmux session '$SESSION': $start"
    tmuxc send-keys -t "$SESSION" "$start" Enter || fail "tmux send-keys failed"
    local i
    for ((i = 0; i < 15; i++)); do running && break; sleep 1; done
    if running; then
      say "linbpq started (pid $(pgrep -x "$PROC" | tr '\n' ' '))"
    else
      fail "linbpq is not running after start; attach with: $TMUX_CMD attach -t $SESSION"
    fi
  fi
  if [ "$FAILED" = 1 ]; then say "done, with failures (see above)"; exit 1; fi
  say "done"
  exit 0
}
trap ensure_running EXIT
trap 'say "interrupted"; FAILED=1; exit 1' INT TERM HUP

[ "$DRY" = 1 ] && say "dry run: nothing is changed"
say "binary $BIN, backup $BACKUP, HTML $HTML, state $STATE"

# Step 1: the UI files.
for f in index.html indexnoaprs.html; do
  if [ -e "$HTML/$f" ]; then
    act rm -f "$HTML/$f" || fail "could not remove $HTML/$f"
  else
    say "$HTML/$f not present"
  fi
done

state_of() { [ -f "$STATE" ] && grep -E "^$1=" "$STATE" | tail -1 | cut -d= -f2; }
if [ -d "$HTML/ui" ]; then
  if [ "$(state_of ui_created)" = 1 ]; then
    act rm -rf "$HTML/ui" || fail "could not remove $HTML/ui"
  else
    say "install-state does not say the install created $HTML/ui; removing only this bundle's files"
    for f in "$BUNDLE"/HTML/ui/*; do
      [ -e "$f" ] || continue
      n="$(basename "$f")"
      if [ -e "$HTML/ui/$n" ]; then act rm -f "$HTML/ui/$n" || fail "could not remove $HTML/ui/$n"; fi
    done
  fi
else
  say "$HTML/ui not present"
fi
# An HTML directory the install created and that is now empty goes too.
if [ -d "$HTML" ] && [ "$(state_of html_created)" = 1 ] && [ -z "$(ls -A "$HTML" 2>/dev/null)" ]; then
  act rmdir "$HTML" || fail "could not remove empty $HTML"
fi

# Step 2: the binary.
if [ ! -s "$BACKUP" ]; then
  fail "backup $BACKUP missing or empty; binary left as it is"
elif [ -e "$BIN" ] && cmp -s "$BACKUP" "$BIN"; then
  say "$BIN already matches the backup"
else
  SUDO=""
  if { [ -e "$BIN" ] && [ ! -w "$BIN" ]; } || { [ ! -e "$BIN" ] && [ ! -w "$(dirname "$BIN")" ]; }; then
    SUDO="sudo"
    say "$BIN is not writable by $(id -un); the copy uses sudo"
  fi
  if running; then
    say "stopping linbpq (SIGTERM)"
    act pkill -TERM -x "$PROC"
    if [ "$DRY" = 0 ]; then
      for ((i = 0; i < STOP_WAIT; i++)); do running || break; sleep 1; done
      if running; then
        say "linbpq still running after ${STOP_WAIT}s; sending SIGKILL"
        pkill -KILL -x "$PROC"
        sleep 2
      fi
    fi
  else
    say "linbpq is not running"
  fi
  if [ "$DRY" = 0 ] && running; then
    fail "linbpq would not stop; binary left as it is"
  elif act $SUDO cp "$BACKUP" "$BIN" && { [ "$DRY" = 1 ] || cmp -s "$BACKUP" "$BIN"; }; then
    say "restored $BIN from $BACKUP"
  else
    fail "could not copy $BACKUP to $BIN"
  fi
fi
# ensure_running runs from the EXIT trap.
