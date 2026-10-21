#!/usr/bin/env bash
# Bring a new G8BPQ LinBPQ release into BarBPQ. Fetches upstream, lists the
# releases not yet merged and which of the upstream files BarBPQ edits they
# touch, merges them into ui, checks every "// uiapi hook" line came through,
# and runs the test suites. Never pushes and never contacts a node.
#
# Usage: scripts/sync-upstream.sh             fetch, report, merge, check, test
#        scripts/sync-upstream.sh --dry-run   fetch and report only
#        scripts/sync-upstream.sh --continue  after fixing conflicts and
#                                             committing the merge: check, test
#   SYNC_UPSTREAM (default upstream/master) and SYNC_BRANCH (default ui)
#   name the refs. SYNC_TEST_CMD replaces the test suites (used by the tests).
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

UP="${SYNC_UPSTREAM:-upstream/master}"
BR="${SYNC_BRANCH:-ui}"
HOOK='// uiapi hook'

step() { printf '\n== %s\n' "$*"; }
die() { echo "sync-upstream: $*" >&2; exit 1; }

mode=merge
case "${1:-}" in
  "") ;;
  --dry-run) mode=dry ;;
  --continue) mode=continue ;;
  *) die "unknown argument: $1 (see the header for usage)" ;;
esac

upver() { git show "$1:Versions.h" 2>/dev/null | LC_ALL=C sed -n 's/^#define KVerstring "\([0-9.]*\)\\0".*/\1/p'; }
hooks() { { git grep -h -F "$HOOK" "$1" -- . ':!scripts' ':!*.md' || true; } | sed 's/^[[:space:]]*//' | LC_ALL=C sort; }

# Hook lines in the merge's first parent (BarBPQ before) against the merge.
check_hooks() {
  step "uiapi hook lines"
  git rev-parse -q --verify HEAD^2 >/dev/null || die "HEAD is not a merge commit"
  local lost
  lost="$(LC_ALL=C comm -23 <(hooks HEAD^1) <(hooks HEAD))"
  if [ -n "$lost" ]; then
    echo "these hook lines were in $BR before the merge and are gone or changed:" >&2
    echo "$lost" >&2
    die "restore them (git grep -n -F '$HOOK' shows what is there now), commit, then rerun with --continue"
  fi
  echo "all $(hooks HEAD^1 | wc -l | tr -d ' ') hook lines present"
}

run_tests() {
  step "tests"
  if [ -n "${SYNC_TEST_CMD:-}" ]; then
    bash -c "$SYNC_TEST_CMD"
  else
    python3 -I -m pytest -q scripts/test_sanitize.py
    scripts/test_rollback.sh
    KEEP_DOCKER=1 docker/build.sh test
    (cd overlay && npm test)
  fi
}

next_steps() {
  step "merged $(upver HEAD^1) -> $(upver HEAD); nothing pushed"
  echo "next: scripts/release.sh, try the bundle on staging, then push $BR"
  echo "to throw the merge away instead: git reset --hard HEAD^1"
}

[ "$(git rev-parse --abbrev-ref HEAD)" = "$BR" ] || die "check out $BR first (on $(git rev-parse --abbrev-ref HEAD))"

if [ "$mode" = continue ]; then
  [ -e "$(git rev-parse --git-dir)/MERGE_HEAD" ] && die "the merge is not committed yet; git add the fixed files and git commit, then rerun"
  check_hooks
  run_tests
  next_steps
  exit 0
fi

[ -z "$(git status --porcelain)" ] || die "uncommitted changes in the tree; commit or stash them first"

step "fetch ${UP%%/*}"
git fetch "${UP%%/*}"

new="$(git rev-list --count "$BR..$UP")"
if [ "$new" = 0 ]; then
  echo "$BR already has everything in $UP ($(upver "$UP"))"
  exit 0
fi

base="$(git merge-base "$BR" "$UP")"
step "$new new upstream commit(s), $(upver "$base") -> $(upver "$UP")"
git log --format='%h %ad %s' --date=short "$BR..$UP"

# Upstream files BarBPQ has edited, against the files upstream changed since.
ours="$(git diff --name-only --diff-filter=M "$base" "$BR" | LC_ALL=C sort)"
theirs="$(git diff --name-only "$base" "$UP" | LC_ALL=C sort)"
both="$(LC_ALL=C comm -12 <(echo "$ours") <(echo "$theirs"))"
step "upstream files BarBPQ edits that this release also changes"
if [ -n "$both" ]; then echo "$both"; else echo "none"; fi

[ "$mode" = dry ] && { echo; echo "dry run: nothing merged"; exit 0; }

step "merge $UP into $BR"
if ! git merge --no-ff --no-edit -m "Merge upstream LinBPQ $(upver "$UP")" "$UP"; then
  echo >&2
  echo "conflicts in:" >&2
  git diff --name-only --diff-filter=U >&2
  die "fix them, git add, git commit, then rerun with --continue (or back out with git merge --abort)"
fi

check_hooks
run_tests
next_steps
