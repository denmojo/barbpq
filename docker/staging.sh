#!/usr/bin/env bash
# Usage: docker/staging.sh up|down|logs   (any directory)
#   up    replace container bpq-staging; out/linbpq runs with staging/ as cwd,
#         web UI on 127.0.0.1:18088. Winlink and APRS-IS hosts resolve to
#         127.0.0.1 so the node never reaches them (so do the g8bpq map
#         servers and the OARC node API). A --internal network would cut all
#         egress but Docker Desktop then ignores -p, so --add-host is used.
#   down  remove the container
#   logs  tail the container's output
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
# shellcheck source=docker/lib.sh
source docker/lib.sh

NAME=bpq-staging
IMAGE=bpq-build

case "${1:-}" in
  up)
    [[ -x out/linbpq ]] || { echo "out/linbpq missing: run docker/build.sh binary" >&2; exit 1; }
    [[ -f staging/bpq32.cfg ]] || { echo "staging/bpq32.cfg missing: run scripts/fetch-staging-config.sh" >&2; exit 1; }
    docker_up
    docker rm -f "$NAME" >/dev/null 2>&1 || true
    hosts=()
    for h in server.winlink.org cms.winlink.org www.winlink.org api.winlink.org \
             rotate.aprs2.net noam.aprs2.net \
             update.g8bpq.net chatupdate.g8bpq.net node-api.packet.oarc.uk; do
      hosts+=(--add-host "$h:127.0.0.1")
    done
    docker run -d --name "$NAME" --platform linux/amd64 --memory 512m \
      "${hosts[@]}" -p 127.0.0.1:18088:8088 \
      -v "$PWD/out/linbpq":/opt/linbpq:ro \
      -v "$PWD/staging":/staging -w /staging \
      "$IMAGE" /opt/linbpq
    ;;
  down)
    docker_up
    docker rm -f "$NAME" >/dev/null 2>&1 || true
    docker_down
    ;;
  logs)
    docker_up
    docker logs -f "$NAME"
    ;;
  *)
    echo "usage: $0 up|down|logs" >&2
    exit 2
    ;;
esac
