#!/usr/bin/env zsh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
exec "$SCRIPT_DIR/bb.sh" "$SCRIPT_DIR/stop_handoff_daemon.bb" "$@"
