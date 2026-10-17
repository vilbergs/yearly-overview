#!/usr/bin/env bash
# Builds a self-contained release for a Raspberry Pi (or any ARM Linux box):
# a static server binary, the built web app and the install files, as a .tar.gz in dist/.
#
#   scripts/package.sh            # 64-bit Raspberry Pi OS (Pi 3/4/5, Zero 2)
#   scripts/package.sh armv7      # 32-bit Raspberry Pi OS
#
# Needs Node, Rust, zig and cargo-zigbuild (pip install ziglang; cargo install cargo-zigbuild).
set -euo pipefail

ARCH="${1:-aarch64}"
case "$ARCH" in
aarch64) TARGET=aarch64-unknown-linux-musl ;;
armv7) TARGET=armv7-unknown-linux-musleabihf ;;
*)
	echo "Unknown architecture: $ARCH (use aarch64 or armv7)" >&2
	exit 1
	;;
esac

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
VERSION="$(node -p "require('./package.json').version")"
NAME="yearly-overview-$VERSION-$ARCH"
OUT="dist/$NAME"

echo "Building the web app"
npm run build >/dev/null

echo "Building the server for $TARGET"
rustup target add "$TARGET" >/dev/null
(cd server && cargo zigbuild --release --locked --target "$TARGET")

rm -rf "$OUT" "dist/$NAME.tar.gz"
mkdir -p "$OUT"
cp "server/target/$TARGET/release/yearly-overview-server" "$OUT/"
cp -r build "$OUT/build"
cp deploy/install.sh deploy/backup.sh deploy/pg-dump.py deploy/yearly-overview.env \
	deploy/yearly-overview.service deploy/yearly-overview-backup.service \
	deploy/yearly-overview-backup.timer "$OUT/"
cp deploy/Caddyfile.yearly-overview deploy/caddy.md deploy/network.md "$OUT/"
echo "$ARCH" >"$OUT/ARCH"
echo "$VERSION" >"$OUT/VERSION"

tar -C dist -czf "dist/$NAME.tar.gz" "$NAME"
echo "Created dist/$NAME.tar.gz ($(du -h "dist/$NAME.tar.gz" | cut -f1))"
