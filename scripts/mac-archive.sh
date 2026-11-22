#!/bin/bash
#
# mac-archive.sh — build the Mac App Store version (先緩緩 for Safari on macOS).
#
# Usage:
#   ./scripts/mac-archive.sh            archive + export a signed .pkg into build/mac/
#   ./scripts/mac-archive.sh --upload   archive + upload straight to App Store Connect
#
# Same signing setup as the iOS app: ios/Local.xcconfig holds the Team ID,
# certificates and profiles are created automatically. The Mac and iOS apps
# share one bundle ID, so they are one App Store Connect record with two
# platforms.
#
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PROJECT="$REPO_DIR/mac/FocusBuffer/FocusBuffer.xcodeproj"
LOCAL_CONFIG="$REPO_DIR/ios/Local.xcconfig"
OUT_DIR="$REPO_DIR/build/mac"
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

APP_VERSION="$(grep -m1 '"MARKETING_VERSION"' "$PROJECT/project.xcproj" | sed -E 's/.*: "([^"]+)".*/\1/')"
MANIFEST_VERSION="$(sed -nE 's/.*"version": "([^"]+)".*/\1/p' "$REPO_DIR/extension/manifest.json" | head -1)"
if [ "$APP_VERSION" != "$MANIFEST_VERSION" ]; then
  echo "✗ 版本號不一致：Mac 專案是 $APP_VERSION，extension/manifest.json 是 $MANIFEST_VERSION。"
  exit 1
fi

mkdir -p "$OUT_DIR"
LOG="$OUT_DIR/archive.log"

echo "▶︎ (1/2) Archiving $APP_VERSION ($BUILD_NUMBER) for team $TEAM_ID…"
xcodebuild -project "$PROJECT" -scheme FocusBuffer -configuration Release \
  -destination 'generic/platform=macOS' -archivePath "$ARCHIVE" \
  -xcconfig "$LOCAL_CONFIG" -allowProvisioningUpdates \
  CURRENT_PROJECT_VERSION="$BUILD_NUMBER" \
  archive >"$LOG" 2>&1 \
  || { echo "✗ Archive failed — see $LOG"; grep -E "error:|Error" "$LOG" | tail -20; exit 1; }
echo "  ✓ $ARCHIVE"

# Archiving leaves signed copies of the app around, and LaunchServices
# registers them; Safari may then load the extension from one of those
# copies and the sandbox refuses it. Unregister the archive's copy (the same
# fix as in Multisub's archive script).
LSREGISTER="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"
for app in "$ARCHIVE"/Products/Applications/*.app; do
  [ -d "$app" ] || continue
  "$LSREGISTER" -u "$app" >/dev/null 2>&1 || true
  for appex in "$app"/Contents/PlugIns/*.appex; do
    pluginkit -r "$appex" >/dev/null 2>&1 || true
  done
done

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
  echo "完成 ✓ 已上傳 macOS $APP_VERSION ($BUILD_NUMBER) 到 App Store Connect。"
else
  echo "完成 ✓ $(ls "$OUT_DIR"/*.pkg 2>/dev/null | head -1)"
fi
