#!/bin/bash
#
# ios-run.sh — build the app with your own signing and install it on a
# connected iPhone, without opening Xcode.
#
# Usage:
#   ./scripts/ios-run.sh                 first connected iPhone
#   ./scripts/ios-run.sh "My iPhone"     a device by name or identifier
#
# Needs ios/Local.xcconfig (copy Local.xcconfig.example) and the iPhone in
# Developer Mode, unlocked and trusted by this Mac.
#
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PROJECT="$REPO_DIR/ios/FocusBuffer/FocusBuffer.xcodeproj"
LOCAL_CONFIG="$REPO_DIR/ios/Local.xcconfig"
DERIVED="$REPO_DIR/build/ios-device"

if [ ! -f "$LOCAL_CONFIG" ]; then
  echo "✗ 找不到 ios/Local.xcconfig。先複製 ios/Local.xcconfig.example，填入你的 Team ID。"
  exit 1
fi

DEVICE="${1:-}"
if [ -z "$DEVICE" ]; then
  DEVICE="$(xcrun devicectl list devices 2>/dev/null | awk '/iPhone/ && /connected|available/ {print $3; exit}')"
fi
if [ -z "$DEVICE" ]; then
  echo "✗ 找不到已連線的 iPhone。接上手機、解鎖，或把裝置名稱當參數傳進來。"
  xcrun devicectl list devices 2>/dev/null || true
  exit 1
fi

echo "▶︎ Building…"
xcodebuild -project "$PROJECT" -scheme FocusBuffer -configuration Debug \
  -destination 'generic/platform=iOS' -derivedDataPath "$DERIVED" \
  -xcconfig "$LOCAL_CONFIG" -allowProvisioningUpdates build \
  | grep -E "error:|warning: .*signing|BUILD" || true

APP="$DERIVED/Build/Products/Debug-iphoneos/FocusBuffer.app"
[ -d "$APP" ] || { echo "✗ Build failed."; exit 1; }

echo "▶︎ Installing on $DEVICE…"
xcrun devicectl device install app --device "$DEVICE" "$APP"
echo "完成 ✓ 到 iPhone 的 設定 › App › Safari › 延伸功能 打開「先緩緩」。"
