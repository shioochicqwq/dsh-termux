# dsh-termux

Offline, ready-to-run **DeepSeek Harness (dsh)** package for **Termux / Android
arm64**. The tarball contains the whole patched `@deepseek-ai/dsh` dependency
tree plus precompiled native modules, so installation needs no build toolchain
and no network.

```bash
npm i -g https://github.com/<you>/dsh-termux/releases/download/v<ver>/dsh-termux-<ver>.tgz
dsh --version    # → <upstream>-termux.<revision>
dsh web          # serve the browser UI
```

## Requirements

```bash
pkg install nodejs-lts python ripgrep
```

- Natives are built against **Node 24/26 (N-API)**; `nodejs-lts` is recommended.
- `ripgrep` is used by the `grep`/`glob` tools (the npm package ships no
  android-arm64 binary).
- Shell: the PTY backend resolves Termux's `bash` automatically.

## Known limitations

- **No container sandbox** (bubblewrap/Landlock are blocked by Android
  sepolicy): command execution needs the manual-approval policy or
  full-access mode.
- Model APIs and credentials stay in `~/.dsh`, exactly like upstream.

## Build from source (Termux, on device)

```bash
git clone https://github.com/<you>/dsh-termux.git
cd dsh-termux
UPSTREAM_VERSION=0.2.1-rc.2 TERMUX_REVISION=1 bash scripts/build-termux.sh
```

Requires `node npm cmake clang make python3 git` and an existing `dsh-termux`
install to borrow `pty.node` from (`PTY_NODE=/path/to/pty.node` overrides).
See [PATCHES.md](PATCHES.md) for the patch set and the reasons behind it.
