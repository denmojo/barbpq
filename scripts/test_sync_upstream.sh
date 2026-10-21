#!/usr/bin/env bash
# Tests scripts/sync-upstream.sh against throwaway git repos: a fake upstream
# and a fake BarBPQ clone with hook lines. Touches no live repo or remote.
# Needs: git.   Usage: scripts/test_sync_upstream.sh
set -u
cd "$(dirname "${BASH_SOURCE[0]}")/.."
SRC="$PWD/scripts/sync-upstream.sh"

T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1

fails=0
ok() { echo "ok   - $*"; }
no() { echo "FAIL - $*"; fails=$((fails + 1)); }
check() { if eval "$2"; then ok "$1"; else no "$1"; fi; }

ver() { printf '#define KVerstring "%s\\0"\n' "$1" >Versions.h; }

# Upstream at 6.0.1 with two C files; BarBPQ clone with a hook in a.c.
setup() {
  rm -rf "$T/up" "$T/bar"
  git init -q -b master "$T/up"
  (cd "$T/up" && ver 6.0.1 && printf 'int a;\nint a2;\n' >a.c && printf 'int b;\n' >b.c &&
    git add -A && git commit -qm 6.0.1)
  git clone -q -o upstream "$T/up" "$T/bar"
  (cd "$T/bar" && git checkout -qb ui && mkdir -p scripts && cp "$SRC" scripts/ &&
    printf 'int a;\nhook(); // uiapi hook\nint a2;\n' >a.c && git add -A && git commit -qm barbpq)
}
upstream_release() { (cd "$T/up" && ver "$1" && eval "$2" && git add -A && git commit -qm "$1"); }
run() { (cd "$T/bar" && SYNC_TEST_CMD="${TESTCMD:-true}" scripts/sync-upstream.sh "$@" >"$T/out" 2>&1); }

# 1. Nothing new upstream.
setup
run; rc=$?
check "nothing new exits 0" '[ $rc = 0 ]'
check "nothing new says so" 'grep -q "already has everything" "$T/out"'

# 2. Dry run lists the release and the overlapping file, merges nothing.
setup
upstream_release 6.0.2 "printf 'int a0;\nint a;\nint a2;\n' >a.c"
head0="$(git -C "$T/bar" rev-parse HEAD)"
run --dry-run; rc=$?
check "dry run exits 0" '[ $rc = 0 ]'
check "dry run names the versions" 'grep -q "6.0.1 -> 6.0.2" "$T/out"'
check "dry run names a.c as overlapping" 'grep -qx "a.c" "$T/out"'
check "dry run leaves HEAD alone" '[ "$(git -C "$T/bar" rev-parse HEAD)" = "$head0" ]'

# 3. Clean merge: merges, keeps the hook, runs the tests, does not push.
run; rc=$?
check "clean merge exits 0" '[ $rc = 0 ]'
check "HEAD is a merge of 6.0.2" 'git -C "$T/bar" log -1 --format=%s | grep -q "Merge upstream LinBPQ 6.0.2"'
check "hook line survives" 'grep -q "// uiapi hook" "$T/bar/a.c"'
check "upstream line arrives" 'grep -q "int a0;" "$T/bar/a.c"'
check "reports hooks present" 'grep -q "all 1 hook lines present" "$T/out"'
check "upstream untouched by a push" '[ "$(git -C "$T/up" branch --format="%(refname:short)")" = master ]'

# 4. A failing test suite fails the run, after the merge.
setup
upstream_release 6.0.2 "printf 'int b2;\n' >b.c"
TESTCMD=false run; rc=$?
check "failing tests exit non-zero" '[ $rc != 0 ]'

# 5. Conflict: stops, names the file, leaves the merge in progress.
setup
upstream_release 6.0.2 "printf 'int a;\nint changed;\nint a2;\n' >a.c"
run; rc=$?
check "conflict exits non-zero" '[ $rc != 0 ]'
check "conflict names a.c" 'grep -A3 "conflicts in:" "$T/out" | grep -qx "a.c"'
check "merge left in progress" '[ -e "$T/bar/.git/MERGE_HEAD" ]'
run --continue; rc=$?
check "--continue refuses an uncommitted merge" '[ $rc != 0 ] && grep -q "not committed yet" "$T/out"'

# 6. Resolving the conflict by dropping the hook is caught by --continue.
(cd "$T/bar" && printf 'int a;\nint changed;\nint a2;\n' >a.c && git add a.c && git commit -qm merged)
run --continue; rc=$?
check "--continue catches a lost hook" '[ $rc != 0 ] && grep -q "hook();" "$T/out"'

# 7. Resolving it with the hook kept passes --continue.
(cd "$T/bar" && git reset -q --hard HEAD^1 && git merge -q upstream/master >/dev/null 2>&1
  printf 'int a;\nhook(); // uiapi hook\nint changed;\nint a2;\n' >a.c && git add a.c && git commit -qm merged)
run --continue; rc=$?
check "--continue passes with the hook kept" '[ $rc = 0 ]'

# 8. Dirty tree and wrong branch are refused.
setup
upstream_release 6.0.2 "printf 'int b2;\n' >b.c"
echo x >>"$T/bar/b.c"
run; rc=$?
check "dirty tree refused" '[ $rc != 0 ] && grep -q "uncommitted changes" "$T/out"'
git -C "$T/bar" checkout -q -- b.c
git -C "$T/bar" checkout -q -b other
run; rc=$?
check "wrong branch refused" '[ $rc != 0 ] && grep -q "check out ui first" "$T/out"'

echo
[ "$fails" = 0 ] && echo "all passed" || { echo "$fails failed"; exit 1; }
