#!/usr/bin/env bash
# Build a BarBPQ release bundle. Runs every test, builds the binary and the
# web UI, and assembles out/release/barbpq-<upstream version>-<n>/ holding
# linbpq, HTML/, rollback.sh and SHA256SUMS. <n> is the next unused number.
# Never contacts a node.
#
# Usage: scripts/release.sh          (run on the build host, Docker available)
#   KEEP_DOCKER=1 leaves Docker Desktop running afterwards.
#   BARBPQ_ALLOW_DIRTY=1 builds from a tree with uncommitted changes
#   (VERSION then says -dirty).
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

step() { printf '\n== %s\n' "$*"; }
die() { echo "release: $*" >&2; exit 1; }

UPVER="$(LC_ALL=C sed -n 's/^#define KVerstring "\([0-9.]*\)\\0".*/\1/p' Versions.h)"
[ -n "$UPVER" ] || die "could not read KVerstring from Versions.h"

COMMIT="$(git rev-parse HEAD)"
if [ -n "$(git status --porcelain)" ]; then
  [ "${BARBPQ_ALLOW_DIRTY:-0}" = 1 ] || die "uncommitted changes; commit them or set BARBPQ_ALLOW_DIRTY=1"
  COMMIT="$COMMIT-dirty"
fi

step "sanitizer tests"
python3 -I -m pytest -q scripts/test_sanitize.py

step "rollback tests"
scripts/test_rollback.sh

step "C tests (docker/build.sh test)"
docker/build.sh test

step "web UI tests and build"
(cd overlay && npm test && npm run build)

step "binary (docker/build.sh binary)"
docker/build.sh binary

step "checks"
file out/linbpq | grep -q 'ELF 64-bit LSB .*x86-64' || die "out/linbpq is not a 64-bit x86-64 ELF"
bad="$(cd overlay/dist && find . -type f ! -name '*.html' ! -name '*.js' ! -name '*.css')"
[ -z "$bad" ] || die "overlay/dist holds files other than .html/.js/.css: $bad"
if grep -rl '##' overlay/dist >/dev/null; then die "overlay/dist has a file containing ##"; fi
cmp -s overlay/dist/index.html overlay/dist/indexnoaprs.html || die "index.html and indexnoaprs.html differ"
for js in overlay/dist/ui/*.js; do
  top="$(head -c 20000 "$js")"
  [[ "$top" == '/*!'* ]] || die "$js does not open with the license banner"
  for holder in 'Jason Miller' 'Preact Team' 'Lucide Icons and Contributors' 'Cole Bemis'; do
    [[ "$top" == *"$holder"* ]] || die "$js banner lacks the notice for $holder"
  done
done
echo "binary is x86-64 ELF; dist holds only .html/.js/.css, no ##, index.html = indexnoaprs.html; license banner present"

step "bundle"
mkdir -p out/release
n=1
while [ -e "out/release/barbpq-$UPVER-$n" ]; do n=$((n + 1)); done
DIR="out/release/barbpq-$UPVER-$n"
mkdir "$DIR"
cp out/linbpq "$DIR/linbpq"
chmod 755 "$DIR/linbpq"
cp scripts/rollback.sh "$DIR/rollback.sh"
chmod 755 "$DIR/rollback.sh"
mkdir "$DIR/HTML"
cp -R overlay/dist/. "$DIR/HTML/"
echo "$COMMIT" >"$DIR/VERSION"
(cd "$DIR" && find . -type f ! -name SHA256SUMS | sed 's|^\./||' | LC_ALL=C sort \
  | while IFS= read -r f; do shasum -a 256 "$f"; done >SHA256SUMS)
(cd "$DIR" && shasum -a 256 -c SHA256SUMS >/dev/null) || die "SHA256SUMS does not verify"
echo "release: $DIR ($(wc -l <"$DIR/SHA256SUMS" | tr -d ' ') files in SHA256SUMS)"
