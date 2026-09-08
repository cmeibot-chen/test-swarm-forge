#!/usr/bin/env zsh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BB_VERSION="${SWARMFORGE_BB_VERSION:-1.13.220}"
PROJECT_ROOT="${SWARMFORGE_PROJECT_ROOT:-$PWD}"
SANDBOX="${SWARMFORGE_IN_SANDBOX:-0}"

typeset -a candidates
candidates=()
explicit=0

if [[ -n "${SWARMFORGE_BB:-}" ]]; then
  candidates+=("$SWARMFORGE_BB")
  explicit=1
elif [[ "$SANDBOX" == "1" ]]; then
  candidates+=("/usr/local/bin/bb")
  path_bb="$(command -v bb 2>/dev/null || true)"
  [[ -n "$path_bb" ]] && candidates+=("$path_bb")
else
  candidates+=("${SWARMFORGE_BB_PATH:-$HOME/.local/share/swarmforge/babashka/$BB_VERSION/bin/bb}")
  candidates+=("$HOME/.local/bin/bb")
  path_bb="$(command -v bb 2>/dev/null || true)"
  [[ -n "$path_bb" ]] && candidates+=("$path_bb")
fi

last_path=""
last_version=""
for candidate in "${candidates[@]}"; do
  [[ -n "$candidate" && -x "$candidate" ]] || continue
  [[ "$candidate" != /tmp/swarmforge-tools/* ]] || continue
  [[ "$candidate" != /tmp/swarmforge-tools ]] || continue
  last_path="$candidate"
  last_version="$("$candidate" --version 2>&1 || true)"
  if print -r -- "$last_version" | grep -Eq "(^|[[:space:]])babashka v${BB_VERSION}([[:space:]]|$)"; then
    export SWARMFORGE_BB_PATH="$candidate"
    exec "$candidate" "$@"
  fi
  [[ "$explicit" == "1" ]] && break
done

mode="host"
repair="bash $SCRIPT_DIR/install-bb.sh"
if [[ "$SANDBOX" == "1" ]]; then
  mode="sandbox"
  repair="swarmforge/sandbox/build.sh"
fi

if [[ -n "$last_path" ]]; then
  actual="${last_version//$'\n'/ }"
  print -u2 -r -- "SwarmForge: Babashka ${BB_VERSION} is required (${mode})."
  print -u2 -r -- "Project: ${PROJECT_ROOT}"
  print -u2 -r -- "Found: ${last_path} (${actual})"
else
  print -u2 -r -- "SwarmForge: Babashka ${BB_VERSION} is required (${mode}); no executable was found."
  print -u2 -r -- "Project: ${PROJECT_ROOT}"
fi
print -u2 -r -- "Repair: ${repair}"
print -u2 -r -- "Preflight log: ${SWARMFORGE_PREFLIGHT_LOG:-${PROJECT_ROOT}/.swarmforge/preflight.log}"
exit 127
