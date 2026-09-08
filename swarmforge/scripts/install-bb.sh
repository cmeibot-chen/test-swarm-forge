#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
VERSION="1.13.220"
INSTALL_ROOT="${SWARMFORGE_BB_INSTALL_ROOT:-${HOME}/.local/share/swarmforge/babashka/${VERSION}}"
BIN_DIR="${SWARMFORGE_BB_BIN_DIR:-${HOME}/.local/bin}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --version)
      [[ $# -ge 2 ]] || { echo "install-bb.sh: --version needs a value" >&2; exit 2; }
      VERSION="$2"
      shift 2
      ;;
    --root)
      [[ $# -ge 2 ]] || { echo "install-bb.sh: --root needs a value" >&2; exit 2; }
      INSTALL_ROOT="$2"
      shift 2
      ;;
    --bin-dir)
      [[ $# -ge 2 ]] || { echo "install-bb.sh: --bin-dir needs a value" >&2; exit 2; }
      BIN_DIR="$2"
      shift 2
      ;;
    -h|--help)
      echo "Usage: install-bb.sh [--version 1.13.220] [--root DIR] [--bin-dir DIR]"
      exit 0
      ;;
    *)
      echo "install-bb.sh: unknown option: $1" >&2
      exit 2
      ;;
  esac
done

[[ "$VERSION" == "1.13.220" ]] || {
  echo "install-bb.sh: only the repository-pinned Babashka 1.13.220 is supported" >&2
  exit 2
}

os="$(uname -s)"
arch="$(uname -m)"
case "$os/$arch" in
  Darwin/arm64|Darwin/aarch64)
    asset="babashka-${VERSION}-macos-aarch64.tar.gz"
    checksum="f7d18c3ab11bb4ad0e32a45c1ae40ae25911d5fa06ba4ded07cb90b8af158077"
    ;;
  Darwin/x86_64|Darwin/amd64)
    asset="babashka-${VERSION}-macos-amd64.tar.gz"
    checksum="ebbfdf159e8d5ee8b7015b15c6558b2039fe76478de893cf317c8c50805340de"
    ;;
  Linux/x86_64|Linux/amd64)
    asset="babashka-${VERSION}-linux-amd64-static.tar.gz"
    checksum="eb3edd128276f0b6fbdefcb18dc7d42652a95ea409a81b34f08e36b8ac3cbc3c"
    ;;
  Linux/aarch64|Linux/arm64)
    asset="babashka-${VERSION}-linux-aarch64-static.tar.gz"
    checksum="0efd6ef36b93ea2f0ae6ebf9d1bcd1a66167c2f41c17e990659aa067654437e8"
    ;;
  *)
    echo "install-bb.sh: unsupported host ${os}/${arch}" >&2
    exit 2
    ;;
esac

download_dir="$(mktemp -d "${TMPDIR:-/tmp}/swarmforge-bb.XXXXXX")"
trap 'rm -rf "$download_dir"' EXIT
archive="$download_dir/$asset"
url="https://github.com/babashka/babashka/releases/download/v${VERSION}/${asset}"

curl --retry 5 --retry-delay 2 --fail --location --silent --show-error "$url" -o "$archive"
if command -v shasum >/dev/null 2>&1; then
  actual="$(shasum -a 256 "$archive" | awk '{print $1}')"
else
  actual="$(sha256sum "$archive" | awk '{print $1}')"
fi
[[ "$actual" == "$checksum" ]] || {
  echo "install-bb.sh: checksum mismatch for $asset (expected $checksum, got $actual)" >&2
  exit 1
}

extract_dir="$download_dir/extract"
mkdir -p "$extract_dir" "$INSTALL_ROOT/bin" "$BIN_DIR"
tar -xzf "$archive" -C "$extract_dir"
test -f "$extract_dir/bb"
chmod 755 "$extract_dir/bb"
mv -f "$extract_dir/bb" "$INSTALL_ROOT/bin/bb"
rm -f "$BIN_DIR/bb"
ln -s "$INSTALL_ROOT/bin/bb" "$BIN_DIR/bb"

echo "Installed Babashka ${VERSION} at ${INSTALL_ROOT}/bin/bb"
echo "Stable launcher: ${BIN_DIR}/bb"
