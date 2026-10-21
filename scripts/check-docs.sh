#!/usr/bin/env bash
# Checks BarBPQ's own markdown (README.md, INSTALL.md, docs/) reads for anyone
# who clones the repository: no maintainer's name outside the License section,
# no approvals to wait for, no paths or tools from one person's machine, no
# notes dated to the day a fact was read off one node. Exits 1 on a hit.
# Usage: scripts/check-docs.sh [file...]
set -u
cd "$(dirname "${BASH_SOURCE[0]}")/.."

if [ $# -gt 0 ]; then files=("$@"); else files=(README.md INSTALL.md docs/*.md); fi

# Each pattern names one class of text that belongs to a maintainer's own setup.
patterns=(
  "'s (yes|go|ok|approval)"           # a person's sign-off as a step
  "\\b(his|her|their) (yes|go|own client|account|gateway)"
  "~/bin/"                           # a tool from one person's home directory
  "\\(read [0-9]{4}-[0-9]{2}-[0-9]{2}\\)"   # facts dated to one reading of one node
  "\\b(Mac only|the Mac)\\b"         # one machine
)
# The maintainer by name: the first name of whoever commits here (the License
# section, which names the copyright holder, is exempt).
me="$(git config user.name 2>/dev/null | awk '{print $1}')"
[ -n "$me" ] && patterns+=("\\b$me\\b")

fails=0
for f in "${files[@]}"; do
  # Drop the License section before matching: the copyright line names the holder.
  body="$(awk '/^## License/{skip=1; next} /^## /{skip=0} !skip' "$f")"
  for p in "${patterns[@]}"; do
    hits="$(printf '%s\n' "$body" | grep -n -E -i "$p" || true)"
    if [ -n "$hits" ]; then
      printf '%s: matches /%s/\n%s\n' "$f" "$p" "$hits" >&2
      fails=$((fails + 1))
    fi
  done
done
[ "$fails" = 0 ] && echo "docs read for a new reader (${#files[@]} files)" || exit 1
