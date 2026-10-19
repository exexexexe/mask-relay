#!/usr/bin/env bash
# Builds dist/mask-relay-<v>.xpi (Firefox) and dist/MaskRelay-<v>.dmg (macOS).
set -euo pipefail
cd "$(dirname "$0")/.."
VERSION=$(cat VERSION)
B=build
rm -rf "$B" dist && mkdir -p "$B/icons" dist

echo "→ icons"
swift macos/render-icon.swift shared/icon.svg "$B/icons/icon-1024.png" 1024
for s in 16 32 48 96 128; do sips -z $s $s "$B/icons/icon-1024.png" --out "$B/icons/icon-$s.png" >/dev/null; done

echo "→ firefox add-on"
FX="$B/firefox"
mkdir -p "$FX/icons"
cp shared/{app.html,app.css,app.js,core.js,icon.svg} "$FX/"
cp extension/{background.js,platform.js,popup.html,popup.css,popup.js} "$FX/"
sed "s/__VERSION__/$VERSION/" extension/manifest.json > "$FX/manifest.json"
cp "$B"/icons/icon-{16,32,48,96,128}.png "$FX/icons/"
(cd "$FX" && zip -qr -X "../../dist/mask-relay-$VERSION.xpi" .)

echo "→ macOS app"
APP="$B/Mask Relay.app"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources/web"
for arch in arm64 x86_64; do
  swiftc -O -swift-version 5 -target "$arch-apple-macos12.0" -o "$B/MaskRelay-$arch" macos/main.swift
done
lipo -create -output "$APP/Contents/MacOS/MaskRelay" "$B/MaskRelay-arm64" "$B/MaskRelay-x86_64"
sed "s/__VERSION__/$VERSION/g" macos/Info.plist > "$APP/Contents/Info.plist"
cp shared/{app.html,app.css,app.js,core.js,icon.svg} macos/platform.js "$APP/Contents/Resources/web/"
ICONSET="$B/AppIcon.iconset"; mkdir -p "$ICONSET"
for s in 16 32 128 256 512; do
  sips -z $s $s "$B/icons/icon-1024.png" --out "$ICONSET/icon_${s}x${s}.png" >/dev/null
  sips -z $((s*2)) $((s*2)) "$B/icons/icon-1024.png" --out "$ICONSET/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/AppIcon.icns"
codesign --force --deep --sign - "$APP"

echo "→ dmg"
STAGE="$B/dmg"; mkdir -p "$STAGE"
cp -R "$APP" "$STAGE/"
ln -s /Applications "$STAGE/Applications"
hdiutil create -quiet -volname "Mask Relay" -srcfolder "$STAGE" -ov -format UDZO "dist/MaskRelay-$VERSION.dmg"

echo "✓ dist/"; ls -lh dist
