# Termux / Android compatibility patches

Built from the published `@deepseek-ai/dsh` npm package (`0.2.1-rc.2`) plus the
Android source patches below. Every replacement is guarded by an exact
match-count assertion (`scripts/patch-dsh.mjs`), so an upstream refactor fails
the build instead of shipping a half-patched artifact.

| # | Package | Fix | Why it is needed on Android |
|---|---|---|---|
| 1 | `koffi` (`lib/native/base/base.cc`) | `statx()` branch excluded under `__ANDROID__` | Bionic declares `__linux__` but resolves `statx` only from API 30; the addon targets API 24 and would fail to compile/link |
| 2 | `koffi` (`base.cc`) | `ExecuteCommandLine()` returns `ENOSYS` below API 28 | `posix_spawn` file actions are API 28+; the harness never calls the helper |
| 3 | `koffi` (`CMakeLists.txt`) | `-Wl,--unresolved-symbols=ignore-all` under `ANDROID` | Node-API symbols are bound from the Node process at load time |
| 4 | `@deepseek-ai/dsh-session-persistence-jsonl` | publish / migrate with `rename(2)` on `process.platform === "android"` | Android app sandboxes answer `EACCES` for every `link(2)` |
| 5 | `@deepseek-ai/dsh-terminal-bash` | default bash resolved by probing `DSH_BASH_SHELL` → Termux `bash` → `/bin/bash` | there is no `/bin/bash` on Android; upstream hardcodes it |
| 6 | `@deepseek-ai/dsh-tool-fs-search` | fall back to `$DSH_RG_PATH` / Termux `rg` before `@vscode/ripgrep` | `@vscode/ripgrep` publishes no `android-arm64` binary |
| 7 | `node-addon-require-builtin` | pure-JS bridge to Node internals (`createRequire` + `--expose-internals`) | the native binding has no Android build and no published source |
| 8 | `lib/bin.js` | shebang runs `node --expose-internals` | required by patch 7 and by the 0.2.x internal-module interception at boot |
| 9 | `node-addon-require-builtin` (HMR guard, conditional) | HMR watcher skipped when `--expose-internals` is absent | only applied when the launcher still ships the patch-file watcher |

## Native modules

- `node-pty@1.2.0-beta.15` — no `prebuilds/android-arm64/pty.node` upstream; a
  N-API binary reused from a working install is mirrored into both the
  `build/Release` and the npm-whitelisted `prebuilds/android-arm64` path.
- `koffi@3.1.1` — compiled on device with clang/cmake (`cnoke.cjs`) after
  patches 1–3.
- `sharp@0.35.5` — no android native build; `@img/sharp-wasm32` (plus
  `@emnapi/runtime`) provides the WebAssembly fallback.

## Already fixed upstream — no patch needed on 0.2.1-rc.2

- `dsh-fs-local` publishes new files with `rename()` (0.1.x needed a `link()`
  fallback for the `write`/`edit` tools).
- `dsh-attachment-local` likewise uses `rename()`.
- 0.2.1's launcher no longer needs the `--expose-internals` HMR workaround for
  the patch-file watcher (only the internal-module bridge above does).

## Known limitations

- **No sandbox backend**: `bubblewrap`/Landlock cannot run under Android
  sepolicy, so command execution needs the manual-approval policy or
  full-access mode.
- **Shell**: the PTY shell defaults to Termux's `bash`; set
  `DSH_BASH_SHELL` or the profile's `shellPath` to override.
- **Search**: requires `pkg install ripgrep` (or `DSH_RG_PATH` pointing at one).
