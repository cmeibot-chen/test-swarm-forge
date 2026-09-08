#!/usr/bin/env zsh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
exec "$SCRIPT_DIR/bb.sh" "$SCRIPT_DIR/commit_msg_hook.bb" "$@"
