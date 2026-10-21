#!/usr/bin/env bash
# Roll a node back from a BarBPQ install. Run it on the node, from the bundle
# directory, in a shell of its own (an SSH session), never inside the tmux
# pane that runs linbpq.
#
#   ./rollback.sh [--dry-run]
#   ./rollback.sh --record-install-state   (install step: run before copying HTML/)
#
# What it does:
#   1. removes index.html and indexnoaprs.html from the HTML directory, and
#      the ui/ directory when install-state says the install created it
#      (otherwise only the ui/ files this bundle shipped)
#   2. if the installed binary differs from the backup: copies the backup to
#      <binary>.rollback-tmp and checks it, stops linbpq, then moves the copy
#      over the binary with mv -f (the binary is never half-written)
#   3. always, on any exit: finishes a stop already begun, then starts linbpq
#      in its tmux session if it is not running
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
#   BARBPQ_STATE     install-state file        <bundle>/../install-state
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
STATE="${BARBPQ_STATE:-$(dirname "$BUNDLE")/install-state}"
STOP_WAIT="${BARBPQ_STOP_WAIT:-30}"
TMP="$BIN.rollback-tmp"

DRY=0
FAILED=0
STOP_SENT=0     # 1 from SIGTERM until the stop is seen through
SUDO=""
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
state_of() { [ -f "$STATE" ] && grep -E "^$1=" "$STATE" | tail -1 | cut -d= -f2; }
file_mode() { stat -c %a "$1" 2>/dev/null || stat -f %Lp "$1"; }
file_owner() { stat -c %u:%g "$1" 2>/dev/null || stat -f %u:%g "$1"; }

# Wait up to $1 seconds for linbpq to exit; 0 if it is gone.
wait_gone() {
  local i
  for ((i = 0; i < $1; i++)); do running || return 0; sleep 1; done
  ! running
}

# SIGTERM, wait, SIGKILL, wait. 0 when linbpq is no longer running.
stop_linbpq() {
  say "stopping linbpq (SIGTERM)"
  STOP_SENT=1
  pkill -TERM -x "$PROC"
  finish_stop
}
finish_stop() {
  if ! wait_gone "$STOP_WAIT"; then
    say "linbpq still running after ${STOP_WAIT}s; sending SIGKILL"
    pkill -KILL -x "$PROC"
    wait_gone 5
  fi
  local rc=$?
  STOP_SENT=0
  return $rc
}

record_install_state() {
  local h=0 u=0
  [ -d "$HTML" ] || h=1
  [ -d "$HTML/ui" ] || u=1
  # A first run's "created" is the truth; a re-run after the copy must not erase it.
  [ "$(state_of html_created)" = 1 ] && h=1
  [ "$(state_of ui_created)" = 1 ] && u=1
  printf 'html_created=%s\nui_created=%s\n' "$h" "$u" >"$STATE" || { echo "rollback: cannot write $STATE" >&2; exit 1; }
  say "recorded in $STATE: html_created=$h ui_created=$u"
  exit 0
}

case "${1:-}" in
  "") ;;
  --dry-run) DRY=1 ;;
  --record-install-state) record_install_state ;;
  -h|--help) sed -n '2,/^$/p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
  *) echo "usage: $0 [--dry-run | --record-install-state]" >&2; exit 2 ;;
esac

# Step 3, registered first so it runs on every exit path, including an interrupt.
ensure_running() {
  # Finish the job even if interrupted again: leaving linbpq stopped is the worse outcome.
  trap '' INT TERM HUP
  trap - EXIT
  if [ "$DRY" = 0 ] && [ -e "$TMP" ]; then
    $SUDO rm -f "$TMP" && say "removed leftover $TMP"
  fi
  if [ "$DRY" = 0 ] && [ "$STOP_SENT" = 1 ]; then
    say "a stop was under way; waiting for linbpq to exit"
    finish_stop || fail "linbpq did not exit even after SIGKILL"
  fi
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

# Step 2: the binary. Any failure before the mv leaves $BIN as it was.
restore_binary() {
  if [ ! -s "$BACKUP" ]; then
    fail "backup $BACKUP missing or empty; binary left as it is"; return
  fi
  if [ -e "$BIN" ] && cmp -s "$BACKUP" "$BIN"; then
    say "$BIN already matches the backup"; return
  fi
  if [ ! -w "$(dirname "$BIN")" ]; then
    SUDO="sudo"
    say "$(dirname "$BIN") is not writable by $(id -un); the copy and the move use sudo"
    act sudo -v || { fail "sudo -v failed; linbpq not stopped, binary left as it is"; return; }
  fi
  # Stage the copy while linbpq still runs.
  act $SUDO rm -f "$TMP"
  if ! act $SUDO cp "$BACKUP" "$TMP"; then
    fail "could not copy $BACKUP to $TMP; linbpq not stopped, binary left as it is"; return
  fi
  if [ "$DRY" = 0 ] && ! cmp -s "$BACKUP" "$TMP"; then
    fail "$TMP does not match $BACKUP; linbpq not stopped, binary left as it is"; return
  fi
  if [ -e "$BIN" ] && [ "$DRY" = 0 ]; then
    act $SUDO chmod "$(file_mode "$BIN")" "$TMP" || { fail "could not set the mode of $TMP"; return; }
    if [ "$(file_owner "$BIN")" != "$(file_owner "$TMP")" ]; then
      act $SUDO chown "$(file_owner "$BIN")" "$TMP" || { fail "could not set the owner of $TMP"; return; }
    fi
  fi
  if running; then
    if [ "$DRY" = 1 ]; then
      say "would stop linbpq (SIGTERM, then SIGKILL after ${STOP_WAIT}s)"
    elif ! stop_linbpq; then
      fail "linbpq would not stop; binary left as it is"; return
    fi
  else
    say "linbpq is not running"
  fi
  if act $SUDO mv -f "$TMP" "$BIN" && { [ "$DRY" = 1 ] || cmp -s "$BACKUP" "$BIN"; }; then
    say "restored $BIN from $BACKUP"
  else
    fail "could not move $TMP over $BIN"
  fi
}
restore_binary
# ensure_running runs from the EXIT trap.
