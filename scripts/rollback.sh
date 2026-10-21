#!/usr/bin/env bash
# Roll a node back from a BarBPQ install, or start linbpq the way it was
# started before. Run it on the node, from the bundle directory, in a shell of
# its own (an SSH session), never inside the tmux pane that runs linbpq.
#
#   ./rollback.sh [--dry-run]
#   ./rollback.sh --record-install-state   (install step: run before copying HTML/)
#   ./rollback.sh --start [--dry-run]      (install step: start linbpq after the move)
#
# What a rollback does:
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
# --start runs step 3 alone. It starts linbpq in the tmux session with the
# working directory and arguments install-state recorded from the running
# node, creating the session if it is gone and using a new window if the
# pane is not at a shell prompt (linbpq run as the pane's own command closes
# the pane, and the session with it, when it exits).
#
# --record-install-state writes install-state: which HTML directory it
# describes, whether that directory and its ui/ exist yet, and, read from the
# running linbpq, its arguments and working directory. A re-run never turns a
# recorded "created" back into 0, keeps the recorded arguments when linbpq is
# not running, and refuses when BARBPQ_HTML names another directory than the
# record. A rollback refuses the same mismatch before it changes anything.
#
# Paths come from these environment variables (defaults in brackets):
#   BARBPQ_BIN       installed binary          [/usr/local/bin/linbpq]
#   BARBPQ_BACKUP    backup binary             [$HOME/linbpq-6.0.26.1.bak]
#   BARBPQ_HTML      node HTML directory       [$HOME/HTML]
#   BARBPQ_WORKDIR   linbpq working directory  [recorded, else $HOME]
#   BARBPQ_ARGS      linbpq arguments, as shell words (e.g. "mail")  [recorded, else none]
#   BARBPQ_SESSION   tmux session name         [linbpq]
#   BARBPQ_PROC      process name to match     [linbpq]
#   BARBPQ_TMUX      tmux command              [tmux]
#   BARBPQ_STATE     install-state file        [<bundle>/../install-state]
#   BARBPQ_STOP_WAIT seconds to wait for stop  [30]
#   BARBPQ_PROCFS    where to read a process's argv and cwd  [/proc]

# No `set -e`: a failed step must never skip the restart at the end.
set -u

BUNDLE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN="${BARBPQ_BIN:-/usr/local/bin/linbpq}"
BACKUP="${BARBPQ_BACKUP:-$HOME/linbpq-6.0.26.1.bak}"
HTML="${BARBPQ_HTML:-$HOME/HTML}"
SESSION="${BARBPQ_SESSION:-linbpq}"
PROC="${BARBPQ_PROC:-linbpq}"
TMUX_CMD="${BARBPQ_TMUX:-tmux}"
STATE="${BARBPQ_STATE:-$(dirname "$BUNDLE")/install-state}"
STOP_WAIT="${BARBPQ_STOP_WAIT:-30}"
PROCFS="${BARBPQ_PROCFS:-/proc}"
TMP="$BIN.rollback-tmp"

DRY=0
FAILED=0
START_ONLY=0
STOP_SENT=0     # 1: about to send SIGTERM; 2: sent, until the stop is seen through
SUDO=""         # for the copy and the move, when the bin directory is not writable
CHOWN_SUDO=""   # for the chown, when the binary belongs to another user
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
state_of() { [ -f "$STATE" ] && grep -E "^$1=" "$STATE" | tail -1 | cut -d= -f2-; }
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
  STOP_SENT=2
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

# The running linbpq's pid, when exactly one runs.
node_pid() {
  local p
  p="$(pgrep -x "$PROC" 2>/dev/null)"
  [ -n "$p" ] && [ "$(printf '%s\n' "$p" | wc -l | tr -d ' ')" = 1 ] && echo "$p"
}

# Arguments after argv[0], as shell words (each one quoted with printf %q).
node_args() {
  local pid="$1" a out="" first=1
  if [ -r "$PROCFS/$pid/cmdline" ]; then
    while IFS= read -r -d '' a || [ -n "$a" ]; do
      if [ "$first" = 1 ]; then first=0; continue; fi
      out="$out $(printf '%q' "$a")"
    done <"$PROCFS/$pid/cmdline"
  else
    say "no $PROCFS/$pid/cmdline; reading the arguments from ps (an argument with a space in it is split)" >&2
    local w i
    read -r -a w <<<"$(ps -o args= -p "$pid")"
    for ((i = 1; i < ${#w[@]}; i++)); do out="$out $(printf '%q' "${w[$i]}")"; done
  fi
  echo "${out# }"
}

node_cwd() {
  local pid="$1"
  if [ -e "$PROCFS/$pid/cwd" ]; then
    readlink "$PROCFS/$pid/cwd"
  else
    lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -1
  fi
}

# A directory name without trailing slashes, so "~/HTML/" and "~/HTML" compare equal.
norm_dir() {
  local d="$1"
  while [ "$d" != / ] && [ "${d%/}" != "$d" ]; do d="${d%/}"; done
  echo "$d"
}

# The record describes one HTML directory; its created flags mean nothing for another.
check_state_html() {
  local rec
  rec="$(state_of html)"
  if [ -z "$rec" ]; then
    if [ -f "$STATE" ] && grep -qE '^(html|ui)_created=1' "$STATE"; then
      echo "rollback: $STATE does not name the HTML directory its created flags describe; nothing changed." >&2
      echo "rollback: add a line html=<the directory the install copied into> to it, then run this again." >&2
      return 1
    fi
    return 0
  fi
  if [ "$(norm_dir "$rec")" != "$(norm_dir "$HTML")" ]; then
    echo "rollback: $STATE describes $rec, but BARBPQ_HTML is $HTML; nothing changed." >&2
    echo "rollback: run it again with BARBPQ_HTML=$rec." >&2
    return 1
  fi
}

record_install_state() {
  local h=0 u=0 pid args workdir
  check_state_html || exit 1
  [ -d "$HTML" ] || h=1
  [ -d "$HTML/ui" ] || u=1
  # A first run's "created" is the truth; a re-run after the copy must not erase it.
  [ "$(state_of html_created)" = 1 ] && h=1
  [ "$(state_of ui_created)" = 1 ] && u=1
  args="$(state_of args)"
  workdir="$(state_of workdir)"
  pid="$(node_pid)"
  if [ -n "$pid" ]; then
    args="$(node_args "$pid")"
    workdir="$(node_cwd "$pid")"
    say "linbpq pid $pid, parent $(ps -o ppid= -p "$pid" | tr -d ' ')"
    say "tmux panes in '$SESSION': $(tmuxc list-panes -s -t "$SESSION" -F '#{window_index}.#{pane_index} #{pane_current_command} pid #{pane_pid}' 2>/dev/null | tr '\n' ';')"
  elif running; then
    say "more than one $PROC is running; arguments not recorded"
  else
    say "linbpq is not running; keeping the recorded arguments and working directory"
  fi
  { printf 'html=%s\nhtml_created=%s\nui_created=%s\n' "$(norm_dir "$HTML")" "$h" "$u"
    [ -n "$workdir" ] && printf 'workdir=%s\n' "$workdir"
    printf 'args=%s\n' "$args"
  } >"$STATE" || { echo "rollback: cannot write $STATE" >&2; exit 1; }
  say "recorded in $STATE: html=$(norm_dir "$HTML") html_created=$h ui_created=$u workdir=${workdir:-unknown} args=${args:-none}"
  exit 0
}

usage() { echo "usage: $0 [--dry-run] | --record-install-state | --start [--dry-run]" >&2; exit 2; }
REC=0
for a in "$@"; do
  case "$a" in
    --dry-run) DRY=1 ;;
    --start) START_ONLY=1 ;;
    --record-install-state) REC=1 ;;
    -h|--help) sed -n '2,/^$/p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) usage ;;
  esac
done
if [ "$REC" = 1 ]; then
  [ "$#" = 1 ] || usage
  record_install_state
fi

# How linbpq is started: the environment, else install-state, else defaults.
WORKDIR="${BARBPQ_WORKDIR:-$(state_of workdir)}"
WORKDIR="${WORKDIR:-$HOME}"
if [ -n "${BARBPQ_ARGS+set}" ]; then ARGS="$BARBPQ_ARGS"; else ARGS="$(state_of args)"; fi

# Step 3, registered first so it runs on every exit path, including an interrupt.
ensure_running() {
  # Finish the job even if interrupted again: leaving linbpq stopped is the worse outcome.
  trap '' INT TERM HUP
  trap - EXIT
  if [ "$DRY" = 0 ] && [ -e "$TMP" ]; then
    $SUDO rm -f "$TMP" && say "removed leftover $TMP"
  fi
  if [ "$DRY" = 0 ] && [ "$STOP_SENT" = 1 ]; then
    # Interrupted before SIGTERM was known to be sent: send it, so the wait
    # below never ends in a SIGKILL of a linbpq that was never asked to stop.
    say "a stop was starting; sending SIGTERM"
    pkill -TERM -x "$PROC"
    STOP_SENT=2
  fi
  if [ "$DRY" = 0 ] && [ "$STOP_SENT" = 2 ]; then
    say "a stop was under way; waiting for linbpq to exit"
    finish_stop || fail "linbpq did not exit even after SIGKILL"
  fi
  local start
  start="cd $(printf '%q' "$WORKDIR") && $(printf '%q' "$BIN")${ARGS:+ $ARGS}"
  if running; then
    say "linbpq is running (pid $(pgrep -x "$PROC" | tr '\n' ' '))"
  elif [ "$DRY" = 1 ]; then
    say "would start linbpq in tmux session '$SESSION': $start"
  else
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
      say "linbpq started (pid $(pgrep -x "$PROC" | tr '\n' ' ')): $(ps -o args= -p "$(pgrep -x "$PROC" | head -1)")"
    else
      fail "linbpq is not running after start; attach with: $TMUX_CMD attach -t $SESSION"
    fi
  fi
  if [ "$FAILED" = 1 ]; then say "done, with failures (see above)"; exit 1; fi
  if [ "$START_ONLY" = 0 ] && [ "$DRY" = 0 ]; then
    say "a browser that loaded the new UI may hold it in its cache: reload the page with Ctrl+Shift+R (Cmd+Shift+R on a Mac)"
  fi
  say "done"
  exit 0
}
trap ensure_running EXIT
trap 'say "interrupted"; FAILED=1; exit 1' INT TERM HUP

[ "$DRY" = 1 ] && say "dry run: nothing is changed"
if [ "$START_ONLY" = 1 ]; then
  say "start only: binary $BIN, working directory $WORKDIR, arguments ${ARGS:-none}, state $STATE"
  exit 0    # ensure_running runs from the EXIT trap
fi
say "binary $BIN, backup $BACKUP, HTML $HTML, state $STATE"
check_state_html || { FAILED=1; exit 1; }    # ensure_running still runs from the EXIT trap

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
  fi
  # Giving the copy another user's ownership (root's, say) needs sudo even
  # when the directory is writable.
  CHOWN_SUDO="$SUDO"
  if [ -e "$BIN" ] && [ "$(id -u)" != 0 ] && [ "$(file_owner "$BIN" | cut -d: -f1)" != "$(id -u)" ]; then
    CHOWN_SUDO="sudo"
    say "$BIN belongs to uid $(file_owner "$BIN" | cut -d: -f1), not $(id -un); the chown uses sudo"
  fi
  if [ -n "$SUDO$CHOWN_SUDO" ]; then
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
      act $CHOWN_SUDO chown "$(file_owner "$BIN")" "$TMP" || { fail "could not set the owner of $TMP; linbpq not stopped, binary left as it is"; return; }
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
