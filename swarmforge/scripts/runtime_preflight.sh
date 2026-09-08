#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
FORGE_ROOT="$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd)"
PROJECT_ROOT="${SWARMFORGE_PROJECT_ROOT:-$FORGE_ROOT}"
RUNTIME="${SWARMFORGE_RUNTIME:-sbx}"
LOG="${SWARMFORGE_PREFLIGHT_LOG:-}"
failed=0

usage() {
  echo "Usage: runtime_preflight.sh [--runtime sbx|local] [--project DIR] [--skip-docker]"
}

skip_docker=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --runtime) RUNTIME="${2:?runtime_preflight.sh: --runtime needs a value}"; shift 2 ;;
    --project) PROJECT_ROOT="${2:?runtime_preflight.sh: --project needs a value}"; shift 2 ;;
    --skip-docker) skip_docker=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; exit 2 ;;
  esac
done

case "$RUNTIME" in
  sbx|local) ;;
  *) usage >&2; exit 2 ;;
esac

if [[ -z "$LOG" ]]; then
  LOG="$PROJECT_ROOT/.swarmforge/preflight.log"
fi
mkdir -p "$(dirname -- "$LOG")"
: > "$LOG"

log() {
  printf '%s\n' "$*" | tee -a "$LOG"
}

check() {
  local label="$1"
  shift
  local output
  if output="$("$@" 2>&1)"; then
    log "PASS ${label}: ${output//$'\n'/ }"
  else
    log "FAIL ${label}: ${output//$'\n'/ }"
    failed=1
  fi
}

check "Babashka" "$SCRIPT_DIR/bb.sh" --version
check "git" git --version
check "tmux" tmux -V

if [[ "$RUNTIME" == "sbx" ]]; then
  check "sbx version" sbx version
  check "sbx inventory/auth" sbx ls --json
  check "sbx template inventory" sbx template ls
  if [[ -f "$FORGE_ROOT/swarmforge/sandbox/Dockerfile" ]]; then
    log "INFO sandbox image source: $FORGE_ROOT/swarmforge/sandbox/Dockerfile"
  fi
fi

if [[ "$skip_docker" == "0" ]]; then
  check "Docker daemon" docker version
  check "Docker Compose" docker compose version
fi

if [[ ! -d "$PROJECT_ROOT" || ! -w "$PROJECT_ROOT" ]]; then
  log "FAIL project mount/write: ${PROJECT_ROOT} is not a writable directory"
  failed=1
else
  probe="$(mktemp -d "$PROJECT_ROOT/.swarmforge-preflight.XXXXXX")"
  rmdir "$probe"
  log "PASS project mount/write: ${PROJECT_ROOT}"
fi

if [[ "$failed" != "0" ]]; then
  log "Runtime preflight failed. See ${LOG} for the exact checks and repairs."
  exit 1
fi
log "Runtime preflight passed for ${RUNTIME}. Log: ${LOG}"
