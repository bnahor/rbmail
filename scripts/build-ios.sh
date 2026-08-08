#!/bin/zsh
set -euo pipefail

project_dir="$(cd "$(dirname "$0")/.." && pwd)"
ios_dir="$project_dir/apps/ios"
archive_dir="$project_dir/dist/ios"
archive_path="$archive_dir/Rubidium.xcarchive"

if [[ "$(xcode-select -p 2>/dev/null || true)" != *"Xcode.app"* ]]; then
  echo "Full Xcode is required. Install Xcode, then run: sudo xcode-select -s /Applications/Xcode.app/Contents/Developer" >&2
  exit 1
fi

: "${APPLE_TEAM_ID:?Set APPLE_TEAM_ID to your Apple Developer team identifier}"

mkdir -p "$archive_dir"

xcodebuild \
  -project "$ios_dir/Rubidium.xcodeproj" \
  -scheme Rubidium \
  -configuration Release \
  -destination "generic/platform=iOS" \
  -archivePath "$archive_path" \
  DEVELOPMENT_TEAM="$APPLE_TEAM_ID" \
  CODE_SIGN_STYLE=Automatic \
  -allowProvisioningUpdates \
  clean archive

xcodebuild \
  -exportArchive \
  -archivePath "$archive_path" \
  -exportOptionsPlist "$ios_dir/ExportOptions.plist" \
  -exportPath "$archive_dir/export" \
  -allowProvisioningUpdates
