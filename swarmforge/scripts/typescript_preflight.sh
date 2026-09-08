#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="${SWARMFORGE_PROJECT_ROOT:-$PWD}"
PROFILE="host-compatible"
CHECK_ONLY=0
LOG="${SWARMFORGE_TYPESCRIPT_PREFLIGHT_LOG:-$PROJECT_ROOT/.swarmforge/typescript-preflight.log}"

usage() {
  echo "Usage: typescript_preflight.sh [--profile canonical|host-compatible|linux-compatible] [--check-only]"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --profile) PROFILE="${2:?typescript_preflight.sh: --profile needs a value}"; shift 2 ;;
    --check-only) CHECK_ONLY=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; exit 2 ;;
  esac
done

[[ -f "$PROJECT_ROOT/package.json" && -f "$PROJECT_ROOT/package-lock.json" ]] || {
  echo "TypeScript preflight requires package.json and package-lock.json in $PROJECT_ROOT" >&2
  exit 1
}

mkdir -p "$(dirname -- "$LOG")"
{
  echo "profile=$PROFILE"
  echo "project=$PROJECT_ROOT"
  echo "host=$(uname -s)/$(uname -m)"
  echo "date=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
} | tee "$LOG"

failed=0
expect() {
  local label="$1"
  local actual="$2"
  local expected="$3"
  if [[ "$actual" == "$expected" ]]; then
    echo "PASS $label: $actual" | tee -a "$LOG"
  else
    echo "FAIL $label: expected $expected, got $actual" | tee -a "$LOG"
    failed=1
  fi
}

node_version="$(node --version 2>&1 || true)"
npm_version="$(npm --version 2>&1 || true)"
case "$PROFILE" in
  canonical)
    expect node v24.13.0 "$node_version"
    expect npm 9.2.0 "$npm_version"
    ;;
  host-compatible)
    expect node v24.13.0 "$node_version"
    expect npm 11.6.2 "$npm_version"
    ;;
  linux-compatible)
    expect node v22.22.1 "$node_version"
    expect npm 9.2.0 "$npm_version"
    ;;
  *)
    echo "Unknown TypeScript preflight profile: $PROFILE" >&2
    exit 2
    ;;
esac

expect .nvmrc "$(tr -d '[:space:]' < "$PROJECT_ROOT/.nvmrc")" 24.13.0
package_manager="$(cd "$PROJECT_ROOT" && node -e 'const p=require("./package.json"); process.stdout.write(p.packageManager || "")' 2>/dev/null || true)"
expect packageManager "$package_manager" npm@9.2.0
docker_node="$(sed -n 's/^FROM node:\([0-9.]*\).* AS deps$/\1/p' "$PROJECT_ROOT/Dockerfile" | head -1)"
expect Dockerfile-node "$docker_node" 24.13.0

if [[ "$failed" != "0" ]]; then
  echo "TypeScript runtime preflight failed; choose the matching profile or repair the toolchain." | tee -a "$LOG"
  exit 1
fi

run_step() {
  echo "+ $*" | tee -a "$LOG"
  set +e
  "$@" 2>&1 | tee -a "$LOG"
  local status="${PIPESTATUS[0]}"
  set -e
  if [[ "$status" != "0" ]]; then
    echo "FAIL command exit=$status: $*" | tee -a "$LOG"
    exit "$status"
  fi
}

if [[ "$CHECK_ONLY" == "0" ]]; then
  run_step npm ci --ignore-scripts
  run_step npm run typecheck
  run_step npm run lint
  run_step npm test
fi

echo "TypeScript preflight passed ($PROFILE). Log: $LOG" | tee -a "$LOG"
