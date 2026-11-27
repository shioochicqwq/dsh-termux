#!/data/data/com.termux/files/usr/bin/bash
# build-termux.sh — assemble the dsh-termux offline package on a Termux device.
#
#   PTY_NODE=/path/to/pty.node bash scripts/build-termux.sh
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

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NODE_BIN="${DSH_NODE_BIN:-$(command -v node)}"
if [[ "$NODE_BIN" != /* || "$NODE_BIN" =~ [[:space:]] || ! -x "$NODE_BIN" ]]; then
  echo '[ERROR] DSH_NODE_BIN must be an absolute path to an executable Node without whitespace' >&2
  exit 1
fi

# Refuse incompatible versions (and non-Termux hosts) before touching any build output.
UPSTREAM_VERSION="$("$NODE_BIN" --input-type=module - "$ROOT/scripts/target.mjs" "${UPSTREAM_VERSION:-}" <<'NODE'
import { pathToFileURL } from 'node:url';
const { UPSTREAM_VERSION, NODE_RANGE, supportsNode } = await import(pathToFileURL(process.argv[2]));
function fail(message) { console.error(`[ERROR] ${message}`); process.exit(1); }
if (!supportsNode(process.version)) fail(`@deepseek-ai/dsh@${UPSTREAM_VERSION} requires Node ${NODE_RANGE}; found ${process.version}`);
if (process.argv[3] && process.argv[3] !== UPSTREAM_VERSION) fail(`this staging branch only builds @deepseek-ai/dsh@${UPSTREAM_VERSION}`);
if (process.platform !== 'android' || process.arch !== 'arm64') fail('build-termux.sh requires Android arm64 with Termux; do not package Linux-native binaries');
try {
  const { DatabaseSync } = await import('node:sqlite');
  new DatabaseSync(':memory:').close();
} catch (error) {
  fail(`Node must provide a working node:sqlite module: ${error.message}`);
}
console.log(UPSTREAM_VERSION);
NODE
)"
TERMUX_REVISION="${TERMUX_REVISION:-1}"
if [[ ! "$TERMUX_REVISION" =~ ^[1-9][0-9]*$ ]]; then
  echo '[ERROR] TERMUX_REVISION must be a positive integer' >&2
  exit 1
fi
TERMUX_VERSION="${UPSTREAM_VERSION}-termux.${TERMUX_REVISION}"
NPM_CLI="$(command -v npm)"
npm_for_node() { "$NODE_BIN" "$NPM_CLI" "$@"; }
PTY_SRC="${PTY_NODE:-$(npm_for_node root -g)/dsh-termux/node_modules/node-pty/prebuilds/android-arm64/pty.node}"
if [ ! -f "$PTY_SRC" ]; then
  echo "[ERROR] no node-pty Android binary found at $PTY_SRC; set PTY_NODE=/path/to/pty.node" >&2
  exit 1
fi
BUILD_BASE="${BUILD_ROOT:-$ROOT/build}"
mkdir -p "$BUILD_BASE"
BUILD_ROOT="$(mktemp -d "$(cd "$BUILD_BASE" && pwd)/termux.XXXXXXXX")"
DIST="$ROOT/dist"
echo "==> building dsh-termux $TERMUX_VERSION in $BUILD_ROOT"

echo "==> [1/7] install upstream dependency tree (no scripts, android/arm64 targets)"
NPM_INSTALL=(--ignore-scripts --registry="${NPM_REGISTRY:-https://registry.npmjs.org}"
  --fetch-timeout=900000 --fetch-retries=6 --maxsockets=6 --no-audit --no-fund --loglevel=error)
npm_for_node install --prefix "$BUILD_ROOT/lib" "@deepseek-ai/dsh@$UPSTREAM_VERSION" \
  --include=optional --os=android --cpu=arm64 "${NPM_INSTALL[@]}"

echo "==> [2/7] assemble package directory"
PKG="$BUILD_ROOT/pkg"
mkdir "$PKG"
cp -a "$BUILD_ROOT/lib/node_modules/@deepseek-ai/dsh/." "$PKG/"
# Keep only one dependency tree on disk. The copy above is the package itself.
mv "$BUILD_ROOT/lib/node_modules" "$PKG/node_modules"
DSH_COPY="$PKG/node_modules/@deepseek-ai/dsh"
if [[ "$(realpath -- "$DSH_COPY")" != "$DSH_COPY" ]]; then
  echo '[ERROR] unexpected path for the copied upstream package' >&2
  exit 1
fi
rm -rf -- "$DSH_COPY"
# npm generated this symlink for the upstream package, which was just moved to $PKG.
if [[ -L "$PKG/node_modules/.bin/dsh" ]]; then unlink "$PKG/node_modules/.bin/dsh"; fi

echo "==> [3/7] apply Android patches"
DSH_NODE_BIN="$NODE_BIN" "$NODE_BIN" "$ROOT/scripts/patch-dsh.mjs" "$PKG"

echo "==> [4/7] native modules: koffi (arm64, native clang) + node-pty (reused binary)"
(cd "$PKG/node_modules/koffi" && env -u CFLAGS -u CXXFLAGS -u CPPFLAGS -u LDFLAGS \
  MAKEFLAGS=-j1 CMAKE_BUILD_PARALLEL_LEVEL=1 "$NODE_BIN" ./cnoke.cjs -P . -D src/koffi --release)
mkdir -p "$PKG/node_modules/node-pty/build/Release" "$PKG/node_modules/node-pty/prebuilds/android-arm64"
cp "$PTY_SRC" "$PKG/node_modules/node-pty/build/Release/pty.node"
cp "$PTY_SRC" "$PKG/node_modules/node-pty/prebuilds/android-arm64/pty.node"
chmod 755 "$PKG/node_modules/node-pty/prebuilds/android-arm64/pty.node"

echo "==> [5/7] sharp WASM fallback (no android native build exists)"
SHARP_VERSION="$("$NODE_BIN" -p 'require(process.argv[1]).version' "$PKG/node_modules/sharp/package.json")"
npm_for_node install --prefix "$BUILD_ROOT/sharpx" --no-save --cpu=wasm32 \
  "@img/sharp-wasm32@$SHARP_VERSION" "${NPM_INSTALL[@]}"
mkdir -p "$PKG/node_modules/@img" "$PKG/node_modules/@emnapi"
cp -a "$BUILD_ROOT/sharpx/node_modules/@img/sharp-wasm32" "$PKG/node_modules/@img/"
cp -an "$BUILD_ROOT/sharpx/node_modules/@emnapi/." "$PKG/node_modules/@emnapi/"

echo "==> [6/7] natives load check"
(cd "$PKG" && "$NODE_BIN" -e "require('node-pty'); require('koffi'); require('sharp'); console.log('    natives OK')")

echo "==> [7/7] prepare + verify + pack"
"$NODE_BIN" "$ROOT/scripts/prepare-package.mjs" "$PKG" "$TERMUX_VERSION"
"$NODE_BIN" "$ROOT/scripts/verify-package.mjs" "$PKG" "$TERMUX_VERSION"
ARCHIVE="dsh-termux-${TERMUX_VERSION}.tgz"
(cd "$PKG" && npm_for_node pack --ignore-scripts --pack-destination "$BUILD_ROOT" --loglevel=error)
# Check that npm retained the native load paths before placing anything in dist.
tar -tzf "$BUILD_ROOT/$ARCHIVE" > "$BUILD_ROOT/packed-files.txt"
for packed in package/node_modules/node-pty/prebuilds/android-arm64/pty.node \
    package/node_modules/koffi/build/koffi/android_arm64/koffi.node; do
  if ! grep -Fx "$packed" "$BUILD_ROOT/packed-files.txt" > /dev/null; then
    echo "[ERROR] npm pack omitted $packed" >&2
    exit 1
  fi
done
(cd "$BUILD_ROOT" && sha256sum "$ARCHIVE" > "$ARCHIVE.sha256")
mkdir -p "$DIST"
for output in "$ARCHIVE" "$ARCHIVE.sha256"; do
  if [[ -e "$DIST/$output" || -L "$DIST/$output" ]]; then
    echo "[ERROR] $DIST/$output already exists; staged archive remains at $BUILD_ROOT/$ARCHIVE" >&2
    exit 1
  fi
done
cp "$BUILD_ROOT/$ARCHIVE" "$BUILD_ROOT/$ARCHIVE.sha256" "$DIST/"
echo "==> done: $DIST/$ARCHIVE"
