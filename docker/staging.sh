#!/usr/bin/env bash
# Usage: docker/staging.sh up [--peer]|down|logs|cms on|off|mail|session [S]|rms   (any directory)
#   up    replace container bpq-staging; out/linbpq runs with staging/ as cwd,
#         web UI on 127.0.0.1:18088. Winlink and APRS-IS hosts resolve to
#         127.0.0.1 so the node never reaches them (so do the g8bpq map
#         servers and the OARC node API). A --internal network would cut all
#         egress but Docker Desktop then ignores -p, so --add-host is used.
#         Plain `up` takes any peer patch back out of staging/ first.
#   up --peer
#         as up, plus a peer linbpq (bpq-peer, staging-peer/ as cwd) linked
#         over AXIP and a fake CMS listener (bpq-fakecms), both on the
#         internal network bpq-staging-net, which has no route out. The
#         staging node joins that network too; its Telnet port is published
#         on 127.0.0.1:18010 for the mail and session helpers.
#         scripts/staging_peer.py apply patches staging/ and writes staging-peer/.
#   down  remove all three containers and the network; quit Docker Desktop
#         unless KEEP_DOCKER=1
#   logs  tail the staging node's output (logs peer / logs cms for the others)
#   cms on|off   open or close the fake CMS listener (closed: connects refused)
#   mail         post one test message on each BBS for the other
#   session [S]  hold an L4 circuit from the staging node to the peer, S s (120)
#   rms          one CMS attempt through the RMS application (Overview's CMS card)
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
# shellcheck source=docker/lib.sh
source docker/lib.sh

NAME=bpq-staging
PEER=bpq-peer
CMS=bpq-fakecms
NET=bpq-staging-net
IMAGE=bpq-build
# Must match NET, MAIN_IP, PEER_IP and CMS_IP in scripts/staging_peer.py.
SUBNET=172.30.249.0/24
MAIN_IP=172.30.249.2
PEER_IP=172.30.249.3
CMS_IP=172.30.249.4

hosts=()
for h in server.winlink.org cms.winlink.org www.winlink.org api.winlink.org \
         rotate.aprs2.net noam.aprs2.net \
         update.g8bpq.net chatupdate.g8bpq.net node-api.packet.oarc.uk; do
  hosts+=(--add-host "$h:127.0.0.1")
done

remove_all() {
  docker rm -f "$NAME" "$PEER" "$CMS" >/dev/null 2>&1 || true
}

cms_start() {
  docker rm -f "$CMS" >/dev/null 2>&1 || true
  docker run -d --name "$CMS" --platform linux/amd64 --memory 32m \
    --network "$NET" --ip "$CMS_IP" "${hosts[@]}" \
    -v "$PWD/docker/fakecms.pl":/opt/fakecms.pl:ro \
    "$IMAGE" perl /opt/fakecms.pl >/dev/null
}

up_peer() {
  python3 -I scripts/staging_peer.py apply
  docker network inspect "$NET" >/dev/null 2>&1 \
    || docker network create --internal --subnet "$SUBNET" "$NET" >/dev/null
  # Created first, joined to the internal network, then started: linbpq
  # opens its AXIP and CMS sockets with both networks in place.
  docker create --name "$NAME" --platform linux/amd64 --memory 512m \
    "${hosts[@]}" -p 127.0.0.1:18088:8088 -p 127.0.0.1:18010:8010 \
    -v "$PWD/out/linbpq":/opt/linbpq:ro \
    -v "$PWD/staging":/staging -w /staging \
    "$IMAGE" /opt/linbpq >/dev/null
  docker network connect --ip "$MAIN_IP" "$NET" "$NAME"
  cms_start
  docker run -d --name "$PEER" --platform linux/amd64 --memory 256m \
    --network "$NET" --ip "$PEER_IP" "${hosts[@]}" \
    -v "$PWD/out/linbpq":/opt/linbpq:ro \
    -v "$PWD/staging-peer":/staging -w /staging \
    "$IMAGE" /opt/linbpq >/dev/null
  docker start "$NAME" >/dev/null
  cat <<EOF
Staging is up with the peer and the fake CMS.
  Web UI          http://127.0.0.1:18088/   (sysop / staging)
  Telnet          nc 127.0.0.1 18010        then sysop, staging, C PEER
  L4 session      docker/staging.sh session 300
  Test mail       docker/staging.sh mail
  Fake CMS        docker/staging.sh cms off   |   docker/staging.sh cms on
  CMS attempt     docker/staging.sh rms
The peer's NODES broadcast reaches the staging node about a minute after start.
Run scripts/install-staging.sh if the overlay in staging/HTML is out of date.
EOF
}

case "${1:-}" in
  up)
    [[ -x out/linbpq ]] || { echo "out/linbpq missing: run docker/build.sh binary" >&2; exit 1; }
    [[ -f staging/bpq32.cfg ]] || { echo "staging/bpq32.cfg missing: run scripts/fetch-staging-config.sh" >&2; exit 1; }
    docker_up
    remove_all
    if [[ "${2:-}" == "--peer" ]]; then
      up_peer
      exit 0
    fi
    python3 -I scripts/staging_peer.py revert >/dev/null
    docker run -d --name "$NAME" --platform linux/amd64 --memory 512m \
      "${hosts[@]}" -p 127.0.0.1:18088:8088 \
      -v "$PWD/out/linbpq":/opt/linbpq:ro \
      -v "$PWD/staging":/staging -w /staging \
      "$IMAGE" /opt/linbpq
    ;;
  down)
    docker_up
    remove_all
    docker network rm "$NET" >/dev/null 2>&1 || true
    DOCKER_STARTED_BY_US=1   # down quits Docker Desktop unless KEEP_DOCKER=1
    docker_down
    ;;
  logs)
    docker_up
    case "${2:-}" in
      peer) docker logs -f "$PEER" ;;
      cms) docker logs -f "$CMS" ;;
      *) docker logs -f "$NAME" ;;
    esac
    ;;
  cms)
    docker_up
    case "${2:-}" in
      # off closes the listener (connects refused at once); on reopens it, or
      # starts the container if it is gone.
      on)
        if [[ "$(docker inspect -f '{{.State.Running}}' "$CMS" 2>/dev/null)" == true ]]; then
          docker kill -s USR2 "$CMS" >/dev/null
        else
          cms_start
        fi
        echo "fake CMS listening on $CMS_IP:8772" ;;
      off)
        docker kill -s USR1 "$CMS" >/dev/null 2>&1 || true
        echo "fake CMS listener closed: connects to $CMS_IP:8772 are refused" ;;
      *) echo "usage: $0 cms on|off" >&2; exit 2 ;;
    esac
    ;;
  mail)
    python3 -I scripts/staging_peer.py mail
    ;;
  session)
    python3 -I scripts/staging_peer.py session "${2:-120}"
    ;;
  rms)
    python3 -I scripts/staging_peer.py rms
    ;;
  *)
    echo "usage: $0 up [--peer]|down|logs [peer|cms]|cms on|off|mail|session [S]|rms" >&2
    exit 2
    ;;
esac
