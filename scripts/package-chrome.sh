#!/bin/bash
#
# package-chrome.sh — zip extension/ for the Chrome Web Store.
# Output: dist/focus-buffer-chrome-<version>.zip
#
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="$(sed -nE 's/.*"version": "([^"]+)".*/\1/p' "$REPO_DIR/extension/manifest.json" | head -1)"
OUT="$REPO_DIR/dist/focus-buffer-chrome-$VERSION.zip"

mkdir -p "$REPO_DIR/dist"
rm -f "$OUT"
(cd "$REPO_DIR/extension" && zip -qr "$OUT" . -x "*.DS_Store" -x "*.md")
echo "完成 ✓ $OUT ($(du -h "$OUT" | cut -f1 | tr -d ' '))"
