# Android / Termux compatibility patches

The release tarball is produced from the published `@deepseek-ai/dsh` npm
package (`0.2.1-rc.2`) by `scripts/patch-dsh.mjs`. Every replacement asserts an
**exact match count**, so an upstream refactor fails the build loudly instead
of shipping a half-patched artifact.

## Source patches

| # | Target | Change | Why Android needs it |
|---|---|---|---|
| 1 | `koffi` `lib/native/base/base.cc` | exclude the `statx()` branch under `__ANDROID__` | Bionic defines `__linux__` but only resolves `statx` from API 30; the addon targets API 24 |
| 2 | `koffi` `base.cc` | `ExecuteCommandLine()` returns `ENOSYS` when `__ANDROID_API__ < 28` | `posix_spawn` file actions are API 28+; the harness never calls this helper |
| 3 | `koffi` `base.cc` | close that guard block | keeps the file compiling on non-Android |
| 4 | `koffi` `src/koffi/CMakeLists.txt` | `-Wl,--unresolved-symbols=ignore-all` when `ANDROID` | Node-API symbols are bound from the Node process at load time |
| 5 | `dsh-session-persistence-jsonl` | import `rename` alongside `link` | — |
| 6 | `dsh-session-persistence-jsonl` | materialize the initial log with `rename(2)` on `android` | Android app sandboxes answer `EACCES` for every `link(2)` |
| 7 | `dsh-session-persistence-jsonl` | migrate the current generation with `rename(2)` on `android` | same reason |
| 8 | `dsh-terminal-bash` | import `existsSync` | — |
| 9 | `dsh-terminal-bash` | probe `DSH_BASH_SHELL` → Termux `bash` → `/bin/bash` | there is no `/bin/bash` on Android |
| 10 | `dsh-terminal-bash` | use the probed shell as the bash default | — |
| 11 | `dsh-tool-fs-search` | fall back to `$DSH_RG_PATH` / Termux `rg` before `@vscode/ripgrep` | `@vscode/ripgrep` ships no `android-arm64` binary |
| 12 | `node-addon-require-builtin` | pure-JS bridge to Node internals via `createRequire` | the native binding has no Android build and publishes no source, while 0.2.x resolves profiles through Node internals at boot |
| 13 | `lib/bin.js` | shebang runs `node --expose-internals` | required by patch 12 (and by the internal-module interception during boot) |

`patch-dsh.mjs` also carries a conditional HMR guard that only applies when the
launcher still ships the patch-file watcher; 0.2.1 does not, so it reports
`skipped`.

## Native modules

| Module | Handling |
|---|---|
| `node-pty@1.2.0-beta.15` | no `prebuilds/android-arm64/pty.node` upstream — an N-API binary is mirrored into both `build/Release` and the npm-whitelisted `prebuilds/android-arm64` path |
| `koffi@3.1.1` | compiled on device (`cnoke.cjs`, clang + cmake) after patches 1–4 |
| `sharp@0.35.5` | no Android native build; `@img/sharp-wasm32` (+ `@emnapi/runtime`) provides the WebAssembly fallback |

## Already fixed upstream — no patch needed on 0.2.1-rc.2

- `dsh-fs-local` publishes new files with `rename()` (0.1.x needed a `link()`
  fallback for the `write`/`edit` tools).
- `dsh-attachment-local` likewise uses `rename()`.
- The `--expose-internals` HMR workaround for the patch-file watcher is gone.

## Known limitations

- **No sandbox backend**: `bubblewrap`/Landlock cannot run under Android
  sepolicy, so command execution needs the manual-approval policy or
  full-access mode.
- **Search tools** require a system `ripgrep` (`pkg install ripgrep`) or
  `DSH_RG_PATH`.
