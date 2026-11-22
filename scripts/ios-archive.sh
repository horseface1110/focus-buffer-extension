#!/bin/bash
#
# ios-archive.sh — build the App Store version of the iOS app (先緩緩).
#
# Usage:
#   ./scripts/ios-archive.sh            archive + export a signed .ipa into build/ios/
#   ./scripts/ios-archive.sh --upload   archive + upload straight to App Store Connect
#
# Needs:
#   - ios/Local.xcconfig with your DEVELOPMENT_TEAM (copy Local.xcconfig.example).
#   - Xcode signed in to that team (Xcode ▸ Settings ▸ Accounts). Certificates
#     and provisioning profiles are created for you (-allowProvisioningUpdates);
#     the first run registers the two bundle IDs on the developer account.
#   - For --upload: an app record with the same bundle ID in App Store Connect.
#
# The build number defaults to a timestamp so every upload is unique;
# override with BUILD_NUMBER=… if needed.
#
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PROJECT="$REPO_DIR/ios/FocusBuffer/FocusBuffer.xcodeproj"
LOCAL_CONFIG="$REPO_DIR/ios/Local.xcconfig"
OUT_DIR="$REPO_DIR/build/ios"
ARCHIVE="$OUT_DIR/FocusBuffer.xcarchive"
BUILD_NUMBER="${BUILD_NUMBER:-$(date +%Y%m%d%H%M)}"
DESTINATION="export"
[ "${1:-}" = "--upload" ] && DESTINATION="upload"

if [ ! -f "$LOCAL_CONFIG" ]; then
  echo "✗ 找不到 ios/Local.xcconfig。先複製 ios/Local.xcconfig.example，填入你的 Team ID。"
  exit 1
fi

TEAM_ID="$(awk -F'=' '/^[[:space:]]*DEVELOPMENT_TEAM[[:space:]]*=/{gsub(/[[:space:]]/, "", $2); print $2; exit}' "$LOCAL_CONFIG")"
if [ -z "$TEAM_ID" ] || [ "$TEAM_ID" = "YOUR_TEAM_ID" ]; then
  echo "✗ ios/Local.xcconfig 裡的 DEVELOPMENT_TEAM 還沒填。"
  exit 1
fi

# The app version comes from the Xcode project; the extension's manifest
# must say the same, or Safari and the App Store show different numbers.
APP_VERSION="$(grep -m1 '"MARKETING_VERSION"' "$PROJECT/project.xcproj" | sed -E 's/.*: "([^"]+)".*/\1/')"
MANIFEST_VERSION="$(sed -nE 's/.*"version": "([^"]+)".*/\1/p' "$REPO_DIR/extension/manifest.json" | head -1)"
if [ "$APP_VERSION" != "$MANIFEST_VERSION" ]; then
  echo "✗ 版本號不一致：Xcode 專案是 $APP_VERSION，extension/manifest.json 是 $MANIFEST_VERSION。"
  exit 1
fi

mkdir -p "$OUT_DIR"
LOG="$OUT_DIR/archive.log"

echo "▶︎ (1/2) Archiving $APP_VERSION ($BUILD_NUMBER) for team $TEAM_ID…"
xcodebuild -project "$PROJECT" -scheme FocusBuffer -configuration Release \
  -destination 'generic/platform=iOS' -archivePath "$ARCHIVE" \
  -xcconfig "$LOCAL_CONFIG" -allowProvisioningUpdates \
  CURRENT_PROJECT_VERSION="$BUILD_NUMBER" \
  archive >"$LOG" 2>&1 \
  || { echo "✗ Archive failed — see $LOG"; grep -E "error:|Error" "$LOG" | tail -20; exit 1; }
echo "  ✓ $ARCHIVE"

cat >"$OUT_DIR/ExportOptions.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key><string>app-store-connect</string>
  <key>destination</key><string>$DESTINATION</string>
  <key>teamID</key><string>$TEAM_ID</string>
  <key>signingStyle</key><string>automatic</string>
  <key>uploadSymbols</key><true/>
</dict>
</plist>
PLIST

echo "▶︎ (2/2) Exporting ($DESTINATION)…"
xcodebuild -exportArchive -archivePath "$ARCHIVE" -exportPath "$OUT_DIR" \
  -exportOptionsPlist "$OUT_DIR/ExportOptions.plist" -allowProvisioningUpdates \
  >>"$LOG" 2>&1 \
  || { echo "✗ Export failed — see $LOG"; grep -E "error:|Error" "$LOG" | tail -20; exit 1; }

if [ "$DESTINATION" = "upload" ]; then
  echo "完成 ✓ 已上傳 $APP_VERSION ($BUILD_NUMBER) 到 App Store Connect。處理完會出現在 TestFlight 和版本頁面。"
else
  echo "完成 ✓ $(ls "$OUT_DIR"/*.ipa 2>/dev/null | head -1)"
fi
