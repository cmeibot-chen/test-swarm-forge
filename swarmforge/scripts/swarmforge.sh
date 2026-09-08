#!/usr/bin/env zsh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if [[ "${1:-}" == "--preflight" ]]; then
  shift
  exec "$SCRIPT_DIR/runtime_preflight.sh" "$@"
fi
exec "$SCRIPT_DIR/bb.sh" "$SCRIPT_DIR/swarmforge.bb" "$@"
