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

# Sign in (staging test user), keep the cookie
get -c "$JAR" -d 'user=sysop&password=staging' "$BASE/Node/Signon?Node" >"$OUT/node-signon.html"
grep -q BPQSessionCookie "$JAR" || { echo "sign-in failed" >&2; exit 1; }

# Sysop pages
get -b "$JAR" "$BASE/Node/EditCfg.html" >"$OUT/node-editcfg.html"
get -b "$JAR" "$BASE/Mail/Header" >"$OUT/mail-header.html"
KEY="$(grep -ao '/Mail/Status?[A-Za-z0-9]*' "$OUT/mail-header.html" | head -1 | cut -d'?' -f2)"
[ -n "$KEY" ] || { echo "no mail key" >&2; exit 1; }
for p in Status Conf HK FWD Users; do
  get -b "$JAR" "$BASE/Mail/$p?$KEY" >"$OUT/mail-$(echo "$p" | tr A-Z a-z).html"
done
# Forwarding partners and the RMS record: both are POSTs; FwdDetails takes the call as the body
get -b "$JAR" -X POST --data '' "$BASE/Mail/FwdList.txt?$KEY" >"$OUT/mail-fwdlist.txt"
get -b "$JAR" -X POST --data 'RMS' "$BASE/Mail/FwdDetails?$KEY" >"$OUT/mail-fwddetails-rms.html"

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
PY

# Guard: the test password must not appear in any captured fixture (the sign-in reply never echoes it)
LEAK="$(grep -rlai 'staging' "$OUT" || true)"
if [ -n "$LEAK" ]; then
  echo "fixture check failed: test password text in: $LEAK" >&2; exit 1
fi
echo "fixtures written to $OUT"
