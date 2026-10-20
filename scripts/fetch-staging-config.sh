#!/usr/bin/env bash
# Fetch sanitized copies of the gateway's configs into staging/.
# Reads the gateway over ssh and writes nothing there: scripts/sanitize.py is
# piped over stdin, sanitizes and leak-checks on the gateway, and only
# sanitized text comes back.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

GATEWAY=<user>@<gateway-host>
mkdir -p staging
tmp=$(mktemp)
trap 'rm -f "$tmp"' EXIT

ssh -o BatchMode=yes "$GATEWAY" 'python3 - --remote' < scripts/sanitize.py > "$tmp"

python3 -I - "$tmp" staging <<'PY'
import json, os, sys
data = json.load(open(sys.argv[1]))
for name in ("bpq32.cfg", "linmail.cfg"):
    with open(os.path.join(sys.argv[2], name), "w", encoding="latin-1", newline="") as f:
        f.write(data[name])
PY
echo "staging/bpq32.cfg and staging/linmail.cfg written (sanitized)"
