#!/usr/bin/env bash
# Usage: docker/build.sh [binary|test]   (run from the repo root)
#   binary  build linbpq as 64-bit x86-64 Linux, write out/linbpq
#   test    run `make uitest` inside the container
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
# shellcheck source=docker/lib.sh
source docker/lib.sh

MODE="${1:-binary}"
IMAGE=bpq-build

run_in_container() {
  docker run --rm --platform linux/amd64 --memory 1500m --cpus 2 \
    -v "$PWD":/src "$IMAGE" "$@"
}

prepare() {
  docker_up
  trap docker_down EXIT
  if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
    docker build --platform linux/amd64 --memory 1500m -t "$IMAGE" docker
  fi
}

case "$MODE" in
  binary)
    prepare
    mkdir -p out
    run_in_container make -j2
    cp linbpq out/linbpq
    run_in_container make clean
    ;;
  test)
    prepare
    run_in_container make uitest
    ;;
  *)
    echo "usage: $0 [binary|test]" >&2
    exit 2
    ;;
esac
