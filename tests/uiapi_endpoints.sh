#!/usr/bin/env bash
# Checks the read-only /api/ui/* endpoints against the staging node.
# Usage: tests/uiapi_endpoints.sh   (staging must be up: docker/staging.sh up)
# Restarts the bpq-staging container once (docker restart) to check that
# events and counts survive.
set -uo pipefail

BASE="${UIAPI_BASE:-http://127.0.0.1:18088}"
NAME=bpq-staging
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
fails=0

fail() { echo "FAIL: $*"; fails=$((fails + 1)); }
pass() { echo "ok:   $*"; }

JAR="$TMP/jar"
# fetch <path> <outfile> [curl args]: body to outfile, prints the HTTP status
fetch() {
  local path="$1" out="$2"
  shift 2
  curl -s -m 10 "$@" -o "$out" -w '%{http_code}' "$BASE$path"
}

# Sign in as the sanitized staging config's made-up test user; the node's
# session cookie lands in $JAR.
sign_in() {
  rm -f "$JAR"
  curl -s -m 10 -c "$JAR" -d 'user=sysop&password=staging' -o /dev/null "$BASE/Node/Signon?Node"
  grep -q BPQSessionCookie "$JAR"
}

wait_up() {
  local i
  for ((i = 0; i < 30; i++)); do
    if [[ "$(fetch /api/info "$TMP/w" 2>/dev/null)" == 200 ]]; then
      return 0
    fi
    sleep 1
  done
  return 1
}

# check <path> <python expression over j, the parsed body>
# AUTH=1 check ... sends the sysop session cookie.
check() {
  local path="$1" expr="$2" f="$TMP/body" code
  if [[ "${AUTH:-0}" == 1 ]]; then code="$(fetch "$path" "$f" -b "$JAR")"; else code="$(fetch "$path" "$f")"; fi
  if [[ "$code" != 200 ]]; then
    fail "$path: HTTP $code $(head -c 80 "$f" 2>/dev/null)"
    return
  fi
  if grep -qi 'staging' "$f"; then fail "$path: body contains the staging password value"; return; fi
  if grep -qi 'CMSPASS' "$f"; then fail "$path: body contains CMSPASS"; return; fi
  if python3 -c '
import json, sys
j = json.load(open(sys.argv[1], encoding="utf-8"))
sys.exit(0 if eval(sys.argv[2]) else 1)
' "$f" "$expr" 2>"$TMP/err"; then
    pass "$path"
  else
    fail "$path: check failed: $expr $(cat "$TMP/err")"
    head -c 400 "$f"; echo
  fi
}

wait_up || { echo "FAIL: staging not answering on $BASE"; exit 1; }

PORTKEYS='{"number","id","driver","freqHz","modes","addr","txtailMs"}'
check /api/ui/station "set(j) >= {'call','alias','locator','version','uptimeSec','telnetPort','ports'} and all(set(p) >= $PORTKEYS for p in j['ports'])"
check /api/ui/station "[p for p in j['ports'] if p['number'] == 2][0]['txtailMs'] == 100"
check /api/ui/station "[p for p in j['ports'] if p['number'] == 2][0]['freqHz'] == 145630000"
check /api/ui/station "[p for p in j['ports'] if p['number'] == 3][0]['modes'] == ['VARAFM96'] and [p for p in j['ports'] if p['number'] == 2][0]['modes'] == ['PKT1200']"
check /api/ui/station "j['telnetPort'] == 8010"
check /api/ui/links "all(set(p) >= {'number','state','detail'} and p['state'] in ('linked','down','unknown') for p in j['ports'])"
check /api/ui/links "[p for p in j['ports'] if p['number'] == 3][0]['state'] == 'down'"
check /api/ui/links "[p for p in j['ports'] if p['number'] == 2][0]['state'] == 'down'"
check /api/ui/cms "set(j) == {'lastAttempt','lastSuccess','ok'}"
check /api/ui/counts "set(j) == {'windowStart','full','sessions','messages','frames'} and isinstance(j['full'], bool)"
check /api/ui/mheard/2 "isinstance(j, list) and all(set(e) >= {'call','packets','lastHeard','via'} for e in j)"

# /api/ui/events answers only a signed-in sysop
code="$(fetch /api/ui/events "$TMP/b")"
if [[ "$code" == 401 ]] && python3 -c 'import json,sys; sys.exit(0 if json.load(open(sys.argv[1])) == {"error": "sysop sign-in required"} else 1)' "$TMP/b"; then
  pass "/api/ui/events without a session -> 401 with a JSON refusal"
else
  fail "/api/ui/events without a session -> $code $(head -c 80 "$TMP/b")"
fi
code="$(fetch /api/ui/events "$TMP/b" -H 'Cookie: BPQSessionCookie=N000000000000')"
[[ "$code" == 401 ]] && pass "/api/ui/events with a made-up session cookie -> 401" || fail "/api/ui/events with a made-up cookie -> $code"
sign_in || fail "staging sign-in did not set a session cookie"
AUTH=1 check /api/ui/events "isinstance(j, list) and len(j) <= 20 and all(set(e) >= {'t','kind','detail'} and isinstance(e['detail'], dict) for e in j)"
AUTH=1 check '/api/ui/events?limit=500' "isinstance(j, list) and len(j) <= 200"

code="$(fetch /api/ui/mheard/99 "$TMP/b")"
[[ "$code" == 404 ]] && pass "/api/ui/mheard/99 -> 404" || fail "/api/ui/mheard/99 -> $code"

# Restart: a restart event appears, counts keep their window start, and a
# damaged event log loads its good lines (written while the node runs, so
# they land before the shutdown and restart lines)
fetch /api/ui/counts "$TMP/c1" >/dev/null
before="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["windowStart"])' "$TMP/c1" 2>/dev/null)"
python3 - "$(dirname "$0")/../staging/uiapi-events.log" <<'EOF'
import sys
with open(sys.argv[1], 'ab') as f:
    f.write(b'not json\n\xff\xfe\x00binary\n')
    f.write(b'{"t":"2026-01-01T00:00:00Z","kind":"cfgsave","detail":{"a":"' + b'x' * 5000 + b'"}}\n')
    f.write(b'{"t":"2026-01-01T00:00:01Z","kind":"cfgsave","detail":{"marker":"q\\"b\\\\s"}}\n')
    f.write(b'{"t":"2026-01-01T00:00:02Z","kind":"cfgsave","detail":{"bad":tru}}\n')
EOF
docker restart -t 20 "$NAME" >/dev/null || fail "docker restart"
sleep 2
wait_up || { fail "staging did not come back"; echo "$fails failed"; exit 1; }
sign_in || fail "staging sign-in after the restart did not set a session cookie"
AUTH=1 check '/api/ui/events?limit=1' "len(j) == 1 and j[0]['kind'] == 'restart'"
AUTH=1 check '/api/ui/events?limit=2' "j[1]['detail'] == {'marker': 'q\"b\\\\s'}"
check /api/ui/counts "j['windowStart'] == '$before'"

if ((fails)); then
  echo "$fails check(s) failed"
  exit 1
fi
echo "all checks passed"
