# Android / Termux compatibility patches

The released `0.2.3-alpha.2-termux.1` tarball was built on Android arm64/Termux from the official `@deepseek-ai/dsh@0.2.3-alpha.2` npm package (Node 26.13.1). The patch script checks the upstream package identity and Node engine range and validates each source match before writing any patches.

## 0.2.3-alpha.2 release delta

- The source ancestry is [sunflower2333/dsh-android `v0.2.2-rc.5-termux.1`](https://github.com/sunflower2333/dsh-android/releases/tag/v0.2.2-rc.5-termux.1). Its native packaging notes are useful, but its JSONL `rename()` fallback may overwrite an existing destination; this fork retains its exclusive-copy fallback.
- Ripgrep selection moved to `@deepseek-ai/dsh-util-ripgrep`; Termux uses `DSH_RG_PATH` or `$PREFIX/bin/rg` and reports a missing system `rg` without trying an unavailable Android npm binary.
- The alpha packages both JSONL (still the default Web profile backend) and SQLite. Keep the existing JSONL and `flock` adaptations and handle the optional SQLite backend’s routing marker on Android: hard link first, then `COPYFILE_EXCL` and file sync for sandbox-rejected links. The existing marker validation and directory sync are unchanged. This does not switch storage backends or migrate user data.
- The legacy patch-file HMR watcher remains absent. The Node internals shim and interpreter flag are still needed for profile resolution.
- The build checks Node `^24.22.3 || >=26.13.1`, Android arm64 and `node:sqlite` before allocating build space. The target tree has no `esbuild` dependency; no extra esbuild package is injected. Native dependency versions were resolved as `koffi@3.1.1`, `node-pty@1.2.0-beta.15` and `sharp@0.35.5` with matching WASM.
- Built on device with Node `26.13.1`: 24 edits applied against the Android-targeted npm tree, 601 top-level bundled dependencies, and the resulting `dist/` package (183 MB, ~1.3 GB / 104k files installed) was installed globally and booted there. `dsh --version` reports `0.2.3-alpha.2`; the web profile starts (HTTP 401 on `/` is the expected unauthenticated response), and a profile carrying `dsh-mobile-remote` 3.17.2-alpha.1 loads with all services reported healthy.
- Profiling an earlier Linux run still applies: the patched CLI’s version/configuration commands and a sharp WASM encode passed on Linux with Node `24.22.3`. Session/filesystem/PTY round-trips were exercised only as far as startup on Android; deep long-run behavior remains unverified.

## Released `0.2.1-rc.4-termux.1` baseline

## Source patches

| # | Target | Change | Why Android needs it |
|---|---|---|---|
| 1 | `koffi` `lib/native/base/base.cc` | exclude the `statx()` branch under `__ANDROID__` | Bionic defines `__linux__` but only resolves `statx` from API 30; the addon targets API 24 |
| 2 | `koffi` `base.cc` | `ExecuteCommandLine()` returns `ENOSYS` when `__ANDROID_API__ < 28` | `posix_spawn` file actions are API 28+; the harness never calls this helper |
| 3 | `koffi` `base.cc` | close that guard block | keeps the file compiling on non-Android |
| 4 | `koffi` `src/koffi/CMakeLists.txt` | `-Wl,--unresolved-symbols=ignore-all` when `ANDROID` | Node-API symbols are bound from the Node process at load time |
| 4b | `dsh-fs-local` | no-replace publish falls back to `copyFile(COPYFILE_EXCL)` when `link(2)` is refused, then fsyncs the copy | Android sandboxes answer `EACCES` for `link(2)`; without this every `write`/`edit` creating a new file fails with `FS_IO_ERROR` |
| 4c | `dsh-attachment-local` | staged-object and alias publication fall back to an exclusive copy, then fsync it | same `link(2)` refusal; without this attachments and `read_image` cannot be stored |
| 4d | `dsh-attachment-local` | on Android only, the ancestor-directory fsync walk skips directories the sandbox refuses to open (`EACCES`/`EPERM`) | the app domain cannot open `/data/data`; other platforms keep upstream's strict behavior |
| 5 | `dsh-session-persistence-jsonl` | add `publishExclusive()`: `link(2)` first, and only when the sandbox refuses it (`EACCES`/`EPERM`/`ENOSYS`/`ENOTSUP`/`EXDEV`) fall back to `copyFile(COPYFILE_EXCL)` and fsync the copy | some Android sandboxes refuse `link(2)`; the fallback stays no-clobber and still reports `EEXIST` when another writer won (a plain `rename(2)` would silently overwrite it) |
| 6 | `dsh-session-persistence-jsonl` | materialize the initial log with `publishExclusive` | same reason |
| 7 | `dsh-session-persistence-jsonl` | migrate the current generation with `publishExclusive` | same reason |
| 7b | `node-addon-system` `lib/flock.js` | on `android`, bind libc `flock(2)` through `koffi` (`LOCK_EX\|LOCK_NB`, callback gets `0` or the positive errno) | the native binding ships linux/darwin only and throws `ERR_FLOCK_UNSUPPORTED_PLATFORM`, which would fail every session write lock |
| 8 | `dsh-terminal-bash` | import `existsSync` | — |
| 9 | `dsh-terminal-bash` | probe `DSH_BASH_SHELL` → `$PREFIX/bin/bash` (Termux) → `/bin/bash` | there is no `/bin/bash` on Android |
| 10 | `dsh-terminal-bash` | use the probed shell as the bash default | — |
| 11 | `dsh-tool-fs-search` | fall back to `$DSH_RG_PATH` / `$PREFIX/bin/rg` before `@vscode/ripgrep` | `@vscode/ripgrep` ships no `android-arm64` binary |
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

`0.2.1-rc.4-termux.1`: all 22 source edits applied to 0.2.1-rc.4 with the same
match counts as on 0.2.1-rc.2. `koffi` (3.1.1), `node-pty` (1.2.0-beta.15) and
`sharp` (0.35.5) did not change between rc.2 and rc.4, so this release reuses the
android-arm64 binaries built on device for `0.2.1-rc.2-termux.4` (the whole
`koffi`, `node-pty`, `@img/sharp-wasm32` and `@emnapi` trees) instead of
recompiling them; the JavaScript tree is the fresh rc.4 install.

The legacy patch-file HMR workaround was not needed for `0.2.1-rc.4`. The no-clobber paths in `dsh-fs-local` and `dsh-attachment-local` still needed the hard-link fallbacks shown above.

## Known limitations

- **No sandbox backend**: `bubblewrap`/Landlock cannot run under Android
  sepolicy, so command execution needs the manual-approval policy or
  full-access mode.
- **Search tools** require a system `ripgrep` (`pkg install ripgrep`) or
  `DSH_RG_PATH`.
