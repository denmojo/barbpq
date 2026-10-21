#!/bin/sh
# Copy the built overlay (overlay/dist) into the staging node's HTML/ folder,
# which linbpq serves for / and /ui/*. Run `npm run build` in overlay/ first.
set -eu
root=$(cd "$(dirname "$0")/.." && pwd)
dist="$root/overlay/dist"
html="$root/staging/HTML"

if [ ! -f "$dist/index.html" ]; then
  echo "install-staging: $dist/index.html is missing; run npm run build in overlay/ first" >&2
  exit 1
fi
mkdir -p "$html"
# Old hashed bundles would pile up in ui/; the overlay owns that folder outright.
rm -rf "$html/ui"
cp -R "$dist/." "$html/"
echo "install-staging: copied $(cd "$dist" && find . -type f | wc -l | tr -d ' ') files to $html"
