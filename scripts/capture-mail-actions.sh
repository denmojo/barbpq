#!/usr/bin/env bash
# Capture the replies of the sysop mail actions from the staging node (never from a real node):
# message details, text, release, hold, kill, a forwarding step, Start Forwarding, WP Delete.
# These change the staging BBS (message 2 is released and held again, message 1 is killed,
# message 3 gets an odd title, the
# white pages record N0CALL is deleted), so they are kept apart from capture-fixtures.sh, which
# only reads. Put the staging data back afterwards from a copy taken before.
# Usage: scripts/capture-mail-actions.sh [base-url]   default http://127.0.0.1:18088
set -euo pipefail
BASE="${1:-http://127.0.0.1:18088}"
case "$BASE" in http://127.0.0.1:*|http://localhost:*) ;; *) echo "staging only (127.0.0.1)" >&2; exit 2 ;; esac
OUT="$(cd "$(dirname "$0")/.." && pwd)/overlay/src/data/__fixtures__"
JAR="$(mktemp)"
get() { curl -sf -m 20 "$@"; }

get -c "$JAR" -d 'user=sysop&password=staging' "$BASE/Node/Signon?Node" >/dev/null
grep -q BPQSessionCookie "$JAR" || { echo "sign-in failed" >&2; exit 1; }
KEY="$(get -b "$JAR" "$BASE/Mail/Header" | grep -ao '/Mail/Status?[A-Za-z0-9]*' | head -1 | cut -d'?' -f2)"
[ -n "$KEY" ] || { echo "no mail key" >&2; exit 1; }
post() { get -b "$JAR" -X POST --data-binary "$2" "$BASE/Mail/$1?$KEY"; }
# MsgDetails for a number with no message leaves the session with no current message, and
# MsgSave or EditM after that crashes the node: every pick here is checked for its heading.
PICK="$(mktemp)"
trap 'rm -f "$JAR" "$PICK"' EXIT
pick() {
  post MsgDetails "$1" >"$PICK"
  grep -q "<h4>Message $1</h4>" "$PICK" || { echo "message $1 not found; stopping" >&2; exit 1; }
}

# A number with no message: the node's empty reply. Then pick a real one again at once.
post MsgDetails 99 >"$OUT/mail-msgdetails-missing.html"
pick 2

# Message text (EditM is a GET; it shows the current message).
get -b "$JAR" "$BASE/Mail/EditM?$KEY?2" >"$OUT/mail-editm-2.html"

# Release message 2 (H to N), then hold it again: the MsgSave replies.
pick 2
post MsgSave 'N0CALL|SYSOP|2_AD6DM|||uiapi test|P|N|' >"$OUT/mail-msgsave-2-released.html"
pick 2
post MsgSave 'N0CALL|SYSOP|2_AD6DM|||uiapi test|P|H|' >"$OUT/mail-msgsave-2-held.html"

# Kill message 1.
pick 1
post MsgSave 'SYSTEM|SYSOP|1_AD6DM|||New User N0CALL|P|K|' >"$OUT/mail-msgsave-1-killed.html"

# One forwarding step for message 4 and partner RMS: none to queued. The Msgs page GET
# refreshes the node's BBS list, which MsgFwdUpdate reads. RMS's BBS number is read from the
# picked message's own forwarding table, as the UI does. Two more steps put it back.
post FwdList.txt '' | tr '|' '\n' | grep -qx RMS || { echo "RMS is not a partner" >&2; exit 1; }
get -b "$JAR" "$BASE/Mail/Msgs?$KEY" >/dev/null
pick 4
RMSNO="$(grep -ao 'onclick=ck("[0-9]*")>RMS<' "$PICK" | grep -o '[0-9][0-9]*' | head -1)"
[ -n "$RMSNO" ] || { echo "no RMS cell in message 4's forwarding table" >&2; exit 1; }
post MsgFwdUpdate "$RMSNO" >"$OUT/mail-msgfwdupdate-4-queued.html"
post MsgFwdUpdate "$RMSNO" >"$OUT/mail-msgfwdupdate-4-sent.html"
post MsgFwdUpdate "$RMSNO" >/dev/null

# A title the node prints unescaped: a quote, an entity written literally, a tag, a Latin-1 byte.
pick 3
post MsgSave "$(printf 'SYSTEM|SYSOP|3_AD6DM|||Odd "q" &amp; <b> caf\351|P|N|')" >/dev/null
pick 3
cp "$PICK" "$OUT/mail-msgdetails-3-oddtitle.html"

# Start Forwarding for RMS: partner check, pick, StartForward.
post FwdList.txt '' | tr '|' '\n' | grep -qx RMS || { echo "RMS is not a partner" >&2; exit 1; }
post FwdDetails RMS >/dev/null
post FWDSave StartForward >"$OUT/mail-fwdsave-startforward-rms.html"

# WP Delete of N0CALL, the only staging record, and the list after it. The reply shows the
# node reading the freed record (its call box holds garbage); the UI refuses this case.
post WPDetails N0CALL >/dev/null
post WPSave Delete >"$OUT/mail-wpsave-delete.html"
get -b "$JAR" "$BASE/Mail/WPInfo.txt?$KEY" >"$OUT/mail-wpinfo-after-delete.txt"

# A mail post with a key the node does not know: its "Session had been lost" reply.
curl -s -m 20 -X POST --data-binary '2' "$BASE/Mail/MsgDetails?M0000000000000" >"$OUT/mail-lost.html"

# Guard: the test password must not appear in any captured fixture.
LEAK="$(grep -rlai 'staging' "$OUT" || true)"
if [ -n "$LEAK" ]; then echo "fixture check failed: test password text in: $LEAK" >&2; exit 1; fi
echo "mail action fixtures written to $OUT"
