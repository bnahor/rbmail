#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "$0")/.." && pwd)"
app_dir="$project_dir/dist/RBMail.app"
contents_dir="$app_dir/Contents"
macos_dir="$contents_dir/MacOS"
resources_dir="$contents_dir/Resources"
module_cache="$project_dir/dist/swift-module-cache"
plist_source="$project_dir/apps/desktop/Info.plist"
swift_source="$project_dir/apps/desktop/Sources/RBMail/main.swift"
entitlements="$project_dir/apps/desktop/entitlements.plist"
app_url="${RBMAIL_APP_URL:-http://localhost:3000}"
identity="${APPLE_SIGNING_IDENTITY:--}"

mkdir -p "$macos_dir" "$resources_dir"
mkdir -p "$module_cache"
cp "$plist_source" "$contents_dir/Info.plist"
/usr/libexec/PlistBuddy -c "Set :RBMailAppURL $app_url" "$contents_dir/Info.plist"

swiftc -O \
  -module-cache-path "$module_cache" \
  -framework Cocoa \
  -framework WebKit \
  "$swift_source" \
  -o "$macos_dir/RBMail"

if [[ "$identity" == "-" ]]; then
  codesign --force --deep --sign - --entitlements "$entitlements" "$app_dir"
  echo "Built and ad-hoc signed $app_dir"
else
  codesign \
    --force \
    --deep \
    --options runtime \
    --timestamp \
    --sign "$identity" \
    --entitlements "$entitlements" \
    "$app_dir"
  codesign --verify --deep --strict --verbose=2 "$app_dir"
  echo "Built and Developer ID signed $app_dir"
fi

if [[ "${RBMAIL_NOTARIZE:-0}" == "1" ]]; then
  : "${APPLE_ID:?Set APPLE_ID for notarization}"
  : "${APPLE_TEAM_ID:?Set APPLE_TEAM_ID for notarization}"
  : "${APPLE_APP_PASSWORD:?Set APPLE_APP_PASSWORD for notarization}"
  if [[ "$identity" == "-" ]]; then
    echo "Notarization requires APPLE_SIGNING_IDENTITY." >&2
    exit 1
  fi
  archive="$project_dir/dist/RBMail-notarize.zip"
  ditto -c -k --keepParent "$app_dir" "$archive"
  xcrun notarytool submit "$archive" \
    --apple-id "$APPLE_ID" \
    --team-id "$APPLE_TEAM_ID" \
    --password "$APPLE_APP_PASSWORD" \
    --wait
  xcrun stapler staple "$app_dir"
  spctl --assess --type execute --verbose=2 "$app_dir"
  echo "Notarized and stapled $app_dir"
fi
