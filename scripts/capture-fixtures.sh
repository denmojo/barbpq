#!/usr/bin/env bash
# Capture data-layer test fixtures from the staging node (never from a real node).
# Usage: scripts/capture-fixtures.sh [base-url]   default http://127.0.0.1:18088
# The sign-in uses the sanitized staging config's made-up test user (sysop / staging).
set -euo pipefail
BASE="${1:-http://127.0.0.1:18088}"
OUT="$(cd "$(dirname "$0")/.." && pwd)/overlay/src/data/__fixtures__"
JAR="$(mktemp)"
trap 'rm -f "$JAR"' EXIT
mkdir -p "$OUT"
get() { curl -sf -m 10 "$@"; }

# Public JSON
for p in info ports users links nodes; do get "$BASE/api/$p" >"$OUT/api-$p.json"; done
get "$BASE/api/mheard/2" >"$OUT/api-mheard.json"
get "$BASE/api/ui/station" >"$OUT/ui-station.json"
get "$BASE/api/ui/links" >"$OUT/ui-links.json"
get "$BASE/api/ui/cms" >"$OUT/ui-cms.json"
get "$BASE/api/ui/counts" >"$OUT/ui-counts.json"
get "$BASE/api/ui/mheard/2" >"$OUT/ui-mheard.json"
get "$BASE/api/ui/events?limit=5" >"$OUT/ui-events.json"

# Public old pages
get "$BASE/Node/Stats.html" >"$OUT/node-stats.html"
get "$BASE/Node/Routes.html" >"$OUT/node-routes.html"

# Protected page without a session: the not-authorized reply
get "$BASE/node/ShowLog.html?date=2026-10-20&NodeDebug=Node+Debug+Log" >"$OUT/node-not-authorized.html"

# Web terminal page without a session: the node's terminal sign-in form
get "$BASE/Node/WebSockTerm.html" >"$OUT/node-termsignon.html"

# Sign in (staging test user), keep the cookie
get -c "$JAR" -d 'user=sysop&password=staging' "$BASE/Node/Signon?Node" >"$OUT/node-signon.html"
grep -q BPQSessionCookie "$JAR" || { echo "sign-in failed" >&2; exit 1; }

# Sysop pages
get -b "$JAR" "$BASE/Node/EditCfg.html" >"$OUT/node-editcfg.html"
get -b "$JAR" "$BASE/Mail/Header" >"$OUT/mail-header.html"
KEY="$(grep -ao '/Mail/Status?[A-Za-z0-9]*' "$OUT/mail-header.html" | head -1 | cut -d'?' -f2)"
[ -n "$KEY" ] || { echo "no mail key" >&2; exit 1; }
for p in Status Conf HK FWD Users Wel; do
  get -b "$JAR" "$BASE/Mail/$p?$KEY" >"$OUT/mail-$(echo "$p" | tr A-Z a-z).html"
done
# Forwarding partners and the RMS record: both are POSTs; FwdDetails takes the call as the body
get -b "$JAR" -X POST --data '' "$BASE/Mail/FwdList.txt?$KEY" >"$OUT/mail-fwdlist.txt"
# FwdDetails for a call that is not a forwarding partner crashes linbpq (NULL ForwardingInfo):
# ask for RMS only when the list just read holds it.
if tr '|' '\n' <"$OUT/mail-fwdlist.txt" | grep -qx 'RMS'; then
  get -b "$JAR" -X POST --data 'RMS' "$BASE/Mail/FwdDetails?$KEY" >"$OUT/mail-fwddetails-rms.html"
else
  echo "capture-fixtures: RMS is not a forwarding partner; skipped mail-fwddetails-rms.html" >&2
fi
# Web terminal page with a session: its script URL carries the user's password in clear.
# Swap it for a placeholder in the pipe, so the password never reaches the file.
get -b "$JAR" -H 'Cache-Control: no-store' "$BASE/Node/WebSockTerm.html" | python3 -I -c '
import re, sys
b = sys.stdin.buffer.read()
b, n = re.subn(rb"(WEBTERM\?T[0-9A-Fa-f]+&[^&]*&)[^&\x27\x22]*(&[0-9]+)", rb"\1hunter2x\2", b)
if n != 1: sys.exit("capture-fixtures: no WEBTERM URL in the terminal page")
sys.stdout.buffer.write(b)' >"$OUT/node-websockterm.html"
# Logs: one present file (BBS, today UTC) and one the node reports missing (CMS, an old day).
# The missing reply names the node's log path; keep only its file name.
TODAY="$(date -u +%F)"
get -b "$JAR" "$BASE/node/ShowLog.html?date=$TODAY&BBS=BBS+Log" >"$OUT/node-showlog-bbs.html"
get -b "$JAR" "$BASE/node/ShowLog.html?date=2026-01-01&CMS=CMS+Log" \
  | python3 -I -c '
import re, sys
b = sys.stdin.buffer.read()
sys.stdout.buffer.write(re.sub(rb"name=Msg>Log [^<\r\n]*/(CMSAccess_[0-9]+\.log) not found", rb"name=Msg>Log logs/\1 not found", b))' \
  >"$OUT/node-showlog-missing.html"

# BBS users, white pages and messages: lists, then one record each (POSTs; the body is the call or number)
get -b "$JAR" -X POST --data '' "$BASE/Mail/UserList.txt?$KEY" >"$OUT/mail-userlist.txt"
get -b "$JAR" -X POST --data 'RMS' "$BASE/Mail/UserDetails?$KEY" >"$OUT/mail-userdetails-rms.html"
get -b "$JAR" "$BASE/Mail/WPInfo.txt?$KEY" >"$OUT/mail-wpinfo.txt"
get -b "$JAR" -X POST --data 'N0CALL' "$BASE/Mail/WPDetails?$KEY" >"$OUT/mail-wpdetails-n0call.html"
get -b "$JAR" -X POST --data '||||' "$BASE/Mail/MsgInfo.txt?$KEY" >"$OUT/mail-msginfo.txt"
get -b "$JAR" -X POST --data '2' "$BASE/Mail/MsgDetails?$KEY" >"$OUT/mail-msgdetails-2.html"

# Scrub: the config text on the Edit Config page holds the staging test password,
# and the mail Conf page carries an ISP password blob. Replace both bodies.
python3 -I - "$OUT" <<'PY'
import re, sys
out = sys.argv[1]
p = out + "/node-editcfg.html"
b = open(p, "rb").read()
b = re.sub(rb"(<textarea[^>]*>).*?(</textarea>)", rb"\1; fixture config text\n\2", b, flags=re.S)
open(p, "wb").write(b)
p = out + "/mail-conf.html"
b = open(p, "rb").read()
b = re.sub(rb'(<input value=")[^"]*(" name="ISPPassword">)', rb"\1\2", b)
open(p, "wb").write(b)
# The BBS user page carries the user's password in clear and the CMS pass as stars.
p = out + "/mail-userdetails-rms.html"
b = open(p, "rb").read()
b = re.sub(rb'(name="(?:Password|CMSPass)" value=")[^"]*(")', rb"\1\2", b)
open(p, "wb").write(b)
PY

# Guard: the test password must not appear in any captured fixture (the sign-in reply never echoes it)
LEAK="$(grep -rlai 'staging' "$OUT" || true)"
if [ -n "$LEAK" ]; then
  echo "fixture check failed: test password text in: $LEAK" >&2; exit 1
fi
# Guard: the terminal page's password slot holds the placeholder and nothing else.
grep -aq 'WEBTERM?T[0-9A-Fa-f]*&[^&]*&hunter2x&' "$OUT/node-websockterm.html" \
  || { echo "fixture check failed: node-websockterm.html password slot not scrubbed" >&2; exit 1; }
echo "fixtures written to $OUT"
