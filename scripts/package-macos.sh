#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
[[ "$(uname -s)" == Darwin ]] || { echo 'macOS required' >&2; exit 1; }
ARCH="$(uname -m)"
case "$ARCH" in arm64) NODE_ARCH=arm64;; x86_64) NODE_ARCH=x64;; *) exit 1;; esac
VERSION="$(node -p "JSON.parse(require('fs').readFileSync('Modules/EditorRuntime/editor-desktop/package.json')).version")"
NODE_VERSION=22.18.0
mkdir -p "${1:-dist}"
OUT="$(cd "${1:-dist}" && pwd)"
STAGE="$(mktemp -d "${TMPDIR:-/tmp}/quickcut-package.XXXXXX")"
APP="$STAGE/QuickCut.app"
RUNTIME="$APP/Contents/Resources/EditorRuntime"
node Modules/EditorRuntime/editor-desktop/src/ui/build.mjs
zsh scripts/bundle-media-deps.sh
xcodebuild -quiet -project QuickCut.xcodeproj -scheme QuickCut -configuration Release \
  -derivedDataPath "$STAGE/DerivedData" "ARCHS=$ARCH" ONLY_ACTIVE_ARCH=YES \
  MACOSX_DEPLOYMENT_TARGET=15.0 CODE_SIGNING_ALLOWED=NO build
ditto "$STAGE/DerivedData/Build/Products/Release/QuickCut.app" "$APP"
mkdir -p "$RUNTIME/editor-desktop" "$RUNTIME/runtime" "$RUNTIME/media"
ditto Modules/EditorRuntime/editor-desktop/src "$RUNTIME/editor-desktop/src"
ditto Modules/EditorRuntime/editor-desktop/assets "$RUNTIME/editor-desktop/assets"
cp Modules/EditorRuntime/editor-desktop/package.json "$RUNTIME/editor-desktop/"
ditto Modules/EditorRuntime/media/lib "$RUNTIME/media/lib"
cp Modules/EditorRuntime/media/ffmpeg Modules/EditorRuntime/media/ffprobe "$RUNTIME/media/"
ARCHIVE="node-v$NODE_VERSION-darwin-$NODE_ARCH.tar.gz"
curl --fail --location --retry 3 "https://nodejs.org/dist/v$NODE_VERSION/$ARCHIVE" -o "$STAGE/$ARCHIVE"
curl --fail --location --retry 3 "https://nodejs.org/dist/v$NODE_VERSION/SHASUMS256.txt" -o "$STAGE/SHASUMS256.txt"
(cd "$STAGE"; grep " $ARCHIVE\$" SHASUMS256.txt | shasum -a 256 -c -)
tar -xzf "$STAGE/$ARCHIVE" -C "$STAGE"
cp "$STAGE/node-v$NODE_VERSION-darwin-$NODE_ARCH/bin/node" "$RUNTIME/runtime/node"
chmod 755 "$APP/Contents/MacOS/QuickCut" "$RUNTIME/runtime/node" "$RUNTIME/media/ffmpeg" "$RUNTIME/media/ffprobe"
codesign --force --sign - --preserve-metadata=entitlements "$RUNTIME/runtime/node"
for lib in "$RUNTIME/media/lib/"*.dylib; do codesign --force --sign - "$lib"; done
codesign --force --sign - "$RUNTIME/media/ffmpeg"
codesign --force --sign - "$RUNTIME/media/ffprobe"
codesign --force --sign - "$APP"
codesign --verify --deep --strict --verbose=2 "$APP"
for binary in "$RUNTIME/media/ffmpeg" "$RUNTIME/media/ffprobe" "$RUNTIME/media/lib/"*.dylib; do
  if otool -L "$binary" | tail -n +2 | grep -E '/opt/homebrew/|/usr/local/|/Cellar/'; then
    echo "Non-portable dependency in $binary" >&2; exit 1
  fi
done
ZIP="$OUT/QuickCut-macOS-$VERSION-$NODE_ARCH.zip"
ditto -c -k --sequesterRsrc --keepParent "$APP" "$ZIP"
mkdir "$STAGE/extracted"
ditto -x -k "$ZIP" "$STAGE/extracted"
EXTRACTED="$STAGE/extracted/QuickCut.app"
codesign --verify --deep --strict "$EXTRACTED"
node scripts/verify-package.mjs "$EXTRACTED"
bash scripts/verify-macos-launcher.sh "$EXTRACTED"
mkdir "$STAGE/dmg"
ditto "$EXTRACTED" "$STAGE/dmg/QuickCut.app"
ln -s /Applications "$STAGE/dmg/Applications"
cp docs/PACKAGE-README.md "$STAGE/dmg/READ-ME.txt"
hdiutil create -volname QuickCut -srcfolder "$STAGE/dmg" -ov -format UDZO "$OUT/QuickCut-macOS-$VERSION-$NODE_ARCH.dmg"
hdiutil verify "$OUT/QuickCut-macOS-$VERSION-$NODE_ARCH.dmg"
echo "Verified macOS $NODE_ARCH packages: $OUT"
