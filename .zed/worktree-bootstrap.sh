#!/bin/sh
set -eu

log() {
  printf '[worktree-bootstrap] %s\n' "$*"
}

WORKTREE_ROOT=${ZED_WORKTREE_ROOT:-${1:-}}
MAIN_GIT_WORKTREE=${ZED_MAIN_GIT_WORKTREE:-${2:-}}

if [ -z "$WORKTREE_ROOT" ]; then
  log 'ZED_WORKTREE_ROOT is not set'
  exit 1
fi

if [ -z "$MAIN_GIT_WORKTREE" ]; then
  log 'ZED_MAIN_GIT_WORKTREE is not set'
  exit 1
fi

if [ ! -d "$WORKTREE_ROOT" ]; then
  log "Worktree root does not exist: $WORKTREE_ROOT"
  exit 1
fi

if [ ! -d "$MAIN_GIT_WORKTREE" ]; then
  log "Main git worktree does not exist: $MAIN_GIT_WORKTREE"
  exit 1
fi

copy_if_present() {
  source_path=$1
  target_path=$WORKTREE_ROOT/$(basename "$source_path")

  if [ ! -e "$source_path" ]; then
    return 0
  fi

  if [ -e "$target_path" ]; then
    log "Keeping existing $(basename "$target_path")"
    return 0
  fi

  cp -R "$source_path" "$target_path"
  log "Copied $(basename "$source_path")"
}

# Carry over local-only files that Git does not put in linked worktrees.
copy_if_present "$MAIN_GIT_WORKTREE/.env"
copy_if_present "$MAIN_GIT_WORKTREE/.npmrc"
copy_if_present "$MAIN_GIT_WORKTREE/package-lock.json"
copy_if_present "$MAIN_GIT_WORKTREE/npm-shrinkwrap.json"

for env_file in "$MAIN_GIT_WORKTREE"/.env.*; do
  [ -e "$env_file" ] || continue
  copy_if_present "$env_file"
done

if [ -d "$WORKTREE_ROOT/node_modules" ]; then
  log 'node_modules already exists; skipping dependency install'
  exit 0
fi

if ! command -v npm >/dev/null 2>&1; then
  log 'npm is not available; skipping dependency install'
  exit 0
fi

cd "$WORKTREE_ROOT"

if [ -f package-lock.json ] || [ -f npm-shrinkwrap.json ]; then
  log 'Installing dependencies with npm ci'
  if npm ci; then
    log 'Dependency install complete'
    exit 0
  fi

  log 'npm ci failed; retrying with npm install'
fi

log 'Installing dependencies with npm install'
npm install
log 'Dependency install complete'
