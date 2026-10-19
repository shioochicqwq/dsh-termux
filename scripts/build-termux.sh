#!/data/data/com.termux/files/usr/bin/bash
# build-termux.sh — assemble the dsh-termux offline package on a Termux device.
#
#   UPSTREAM_VERSION=0.2.1-rc.2 TERMUX_REVISION=5 bash scripts/build-termux.sh
#
# Produces dist/dsh-termux-$UPSTREAM_VERSION-termux.$TERMUX_REVISION.tgz
# containing the full patched @deepseek-ai/dsh dependency tree, the android-arm64
# native modules and precompiled fallbacks. No compilation toolchain is needed
# at install time.
#
# Requirements on the builder: node, npm, cmake, clang, make, python3, git.
# node-pty's android binary (ABI-stable N-API) is reused from an existing
# dsh-termux install, or taken from PTY_NODE=/path/to/pty.node; the script
# stops if neither exists.
set -euo pipefail

UPSTREAM_VERSION="${UPSTREAM_VERSION:-$(npm view @deepseek-ai/dsh version)}"
TERMUX_REVISION="${TERMUX_REVISION:-1}"
TERMUX_VERSION="${UPSTREAM_VERSION}-termux.${TERMUX_REVISION}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUILD_ROOT="${BUILD_ROOT:-$ROOT/build}"
DIST="$ROOT/dist"
NODE_BIN="${DSH_NODE_BIN:-$(command -v node)}"

echo "==> building dsh-termux $TERMUX_VERSION (upstream $UPSTREAM_VERSION)"
rm -rf "$BUILD_ROOT"
mkdir -p "$BUILD_ROOT/lib" "$DIST"

echo "==> [1/7] install upstream dependency tree (no scripts, android/arm64 targets)"
npm install --prefix "$BUILD_ROOT/lib" "@deepseek-ai/dsh@$UPSTREAM_VERSION" \
  --ignore-scripts --include=optional --os=android --cpu=arm64 \
  --registry="${NPM_REGISTRY:-https://registry.npmjs.org}" \
  --fetch-timeout=900000 --fetch-retries=6 --maxsockets=24 \
  --no-audit --no-fund --loglevel=error

echo "==> [2/7] assemble package directory"
PKG="$BUILD_ROOT/pkg"
rm -rf "$PKG"
mkdir -p "$PKG/node_modules"
cp -a "$BUILD_ROOT/lib/node_modules/@deepseek-ai/dsh/." "$PKG/"
cp -a "$BUILD_ROOT/lib/node_modules/." "$PKG/node_modules/"
rm -rf "$PKG/node_modules/@deepseek-ai/dsh"

echo "==> [3/7] apply Android patches"
DSH_NODE_BIN="$NODE_BIN" node "$ROOT/scripts/patch-dsh.mjs" "$PKG"

echo "==> [4/7] native modules: koffi (arm64, native clang) + node-pty (reused binary)"
(cd "$PKG/node_modules/koffi" && env -u CFLAGS -u CXXFLAGS -u CPPFLAGS -u LDFLAGS \
  "$NODE_BIN" ./cnoke.cjs -P . -D src/koffi --prebuild --release)
PTY_SRC="${PTY_NODE:-$(npm root -g)/dsh-termux/node_modules/node-pty/build/Release/pty.node}"
if [ ! -f "$PTY_SRC" ]; then
  echo "[ERROR] no node-pty android binary found at $PTY_SRC"
  echo "        install a working dsh-termux once, or set PTY_NODE=/path/to/pty.node"
  exit 1
fi
mkdir -p "$PKG/node_modules/node-pty/build/Release" "$PKG/node_modules/node-pty/prebuilds/android-arm64"
cp "$PTY_SRC" "$PKG/node_modules/node-pty/build/Release/pty.node"
cp "$PTY_SRC" "$PKG/node_modules/node-pty/prebuilds/android-arm64/pty.node"
chmod 755 "$PKG/node_modules/node-pty/prebuilds/android-arm64/pty.node"

echo "==> [5/7] sharp WASM fallback (no android native build exists)"
mkdir -p "$BUILD_ROOT/sharpx"
(cd "$BUILD_ROOT/sharpx" && npm install --no-save --ignore-scripts --no-audit --no-fund \
  --loglevel=error "@img/sharp-wasm32@$(node -p "require('$PKG/node_modules/sharp/package.json').version")")
cp -a "$BUILD_ROOT/sharpx/node_modules/@img/sharp-wasm32" "$PKG/node_modules/@img/"
cp -a "$BUILD_ROOT/sharpx/node_modules/@emnapi" "$PKG/node_modules/" 2>/dev/null || true

echo "==> [6/7] natives load check"
(cd "$PKG" && "$NODE_BIN" -e "require('node-pty'); require('koffi'); require('sharp'); console.log('    natives OK')")

echo "==> [7/7] prepare + verify + pack"
node "$ROOT/scripts/prepare-package.mjs" "$PKG" "$TERMUX_VERSION"
node "$ROOT/scripts/verify-package.mjs" "$PKG" "$TERMUX_VERSION"
(cd "$PKG" && npm pack --pack-destination "$DIST" --loglevel=error)
(cd "$DIST" && sha256sum "dsh-termux-${TERMUX_VERSION}.tgz" > "dsh-termux-${TERMUX_VERSION}.tgz.sha256")
echo "==> done: $DIST/dsh-termux-${TERMUX_VERSION}.tgz"
