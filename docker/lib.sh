#!/usr/bin/env bash
# Shared helpers: start/stop Docker Desktop around a build.
# Source this file; do not execute it.
# KEEP_DOCKER=1 leaves Docker Desktop running after docker_down.

DOCKER_STARTED_BY_US=0

docker_up() {
  if docker info >/dev/null 2>&1; then
    DOCKER_STARTED_BY_US=0
    return 0
  fi
  open -a Docker
  DOCKER_STARTED_BY_US=1
  local i
  for ((i = 0; i < 60; i++)); do
    if docker info >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done
  echo "docker_up: Docker did not become ready within 120 s" >&2
  return 1
}

docker_down() {
  if [[ "${KEEP_DOCKER:-0}" == "1" ]]; then
    return 0
  fi
  if [[ "$DOCKER_STARTED_BY_US" == "1" ]]; then
    osascript -e 'quit app "Docker"' >/dev/null 2>&1 || true
    DOCKER_STARTED_BY_US=0
  fi
  return 0
}
