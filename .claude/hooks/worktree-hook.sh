#!/bin/sh
# Claude Code worktree bootstrap hook (SessionStart).
# BOOTSTRAP-ONLY: Claude Code owns worktree creation and cleanup; this hook
# delegates setup to the same .zed/worktree-bootstrap.sh script used by Zed.
#
# SessionStart fires for every session, so this only runs inside linked Git
# worktrees and uses a marker in the worktree's private git dir to avoid
# repeating dependency setup on later sessions.
set -eu

log() {
  printf '[claude-worktree-bootstrap] %s\n' "$*" >&2
}

input=$(cat)
cwd=$(printf '%s' "$input" | jq -r '.cwd // empty' 2>/dev/null || true)

[ -n "$cwd" ] && [ -d "$cwd" ] || exit 0
cd "$cwd"

worktree_root=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
cd "$worktree_root"

# Detect a linked worktree: in the main checkout git-dir == git-common-dir; in a
# linked worktree git-dir is <main>/.git/worktrees/<name> while git-common-dir
# is <main>/.git.
git_dir=$(git rev-parse --absolute-git-dir 2>/dev/null) || exit 0
git_common=$(git rev-parse --git-common-dir 2>/dev/null) || exit 0
case "$git_common" in
  /*) git_common_abs=$git_common ;;
  *) git_common_abs=$(cd "$(dirname "$git_common")" && pwd)/$(basename "$git_common") ;;
esac
[ "$git_dir" != "$git_common_abs" ] || exit 0

marker=$git_dir/.worktree-bootstrapped
[ -f "$marker" ] && exit 0

main_dir=$(dirname "$git_common_abs")
bootstrap_script=$worktree_root/.zed/worktree-bootstrap.sh
if [ ! -f "$bootstrap_script" ]; then
  bootstrap_script=$main_dir/.zed/worktree-bootstrap.sh
fi

if [ ! -f "$bootstrap_script" ]; then
  log "Bootstrap script not found: $bootstrap_script"
  exit 1
fi

{
  sh "$bootstrap_script" "$worktree_root" "$main_dir"
  touch "$marker"
} >&2

echo "Worktree bootstrapped at $worktree_root."
