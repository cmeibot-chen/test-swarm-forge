#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
REPO_ROOT="$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd)"
SOURCE="$REPO_ROOT/starters/typescript-next-postgres"
created_destination=0

cleanup() {
  if [[ "$created_destination" == "1" && -d "$DEST" ]]; then
    rm -rf -- "$DEST"
  fi
}

if [[ $# -gt 1 ]]; then
  echo "Usage: create_typescript_fixture.sh [empty-destination]" >&2
  exit 2
fi

if [[ $# == 1 ]]; then
  DEST="$(CDPATH= cd -- "$(dirname -- "$1")" && pwd)/$(basename -- "$1")"
  [[ ! -e "$DEST" ]] || { echo "Destination already exists: $DEST" >&2; exit 1; }
  mkdir -p "$DEST"
else
  DEST="$(mktemp -d "${TMPDIR:-/tmp}/swarmforge-typescript-XXXXXX")"
fi
created_destination=1
trap cleanup EXIT

rsync -a \
  --exclude '.next/' \
  --exclude 'build/' \
  --exclude 'coverage/' \
  --exclude 'test-results/' \
  --exclude '.swarmforge/' \
  --exclude '.worktrees/' \
  --exclude '.DS_Store' \
  --exclude '._*' \
  --exclude 'tsconfig.tsbuildinfo' \
  "$SOURCE/" "$DEST/"

link="$(find "$DEST" -type l -print -quit)"
if [[ -n "$link" ]]; then
  echo "Fixture copy contains a symlink; refusing an unsafe fixture: $link" >&2
  exit 1
fi

project_name="$(basename -- "$DEST")"
compose_project="$(printf '%s' "swarmforge-$project_name-$$-$(date +%s)" | tr '[:upper:]_' '[:lower:]-' | tr -cd 'a-z0-9-' | cut -c1-50)"
compose_project="${compose_project%-}"
[[ -n "$compose_project" ]] || compose_project="swarmforge-typescript"
app_port="$(node -e 'const s=require("node:net").createServer(); s.listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})')"
base_url="http://127.0.0.1:${app_port}"

mkdir -p "$DEST/.swarmforge"
{
  echo "COMPOSE_PROJECT_NAME=$compose_project"
  echo "APP_PORT=$app_port"
  echo "BASE_URL=$base_url"
} > "$DEST/.swarmforge/fixture.env"

git -C "$DEST" init -q
git -C "$DEST" config user.name SwarmForge
git -C "$DEST" config user.email swarmforge@local
git -C "$DEST" add .
git -C "$DEST" commit -q -m "Initial TypeScript fixture"
created_destination=0

echo "Fixture: $DEST"
echo "Git: $(git -C "$DEST" rev-parse HEAD)"
echo "Compose project: $compose_project"
echo "App port: $app_port"
echo "Volume scope: ${compose_project}_todos-db"
echo "Environment: $DEST/.swarmforge/fixture.env"
echo "Next: cd \"$DEST\" && set -a && . .swarmforge/fixture.env && set +a && npm ci --ignore-scripts"
