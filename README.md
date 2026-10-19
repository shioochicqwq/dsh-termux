# dsh-termux

为 **Termux / Android arm64** 打包的 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（`dsh`）离线安装包。

当前版本：**`0.2.1-rc.2-termux.1`**（上游 `@deepseek-ai/dsh@0.2.1-rc.2`）

tarball 内含完整依赖树（542 个包）与预编译原生模块（`node-pty` / `koffi` / `sharp` 的 Android 回退），**安装零构建、零联网**，不需要 clang/cmake 工具链。

## 安装

```bash
# 1. 基础依赖
pkg install -y nodejs-lts python ripgrep

# 2. 安装（固定最新版地址，随 Release 更新）
npm i -g https://github.com/shioochicqwq/dsh-termux/releases/latest/download/dsh-termux.tgz

# 3. 验证
dsh --version     # → 0.2.1-rc.2
```

也可以安装指定版本：

```bash
npm i -g https://github.com/shioochicqwq/dsh-termux/releases/download/v0.2.1-rc.2-termux.1/dsh-termux-0.2.1-rc.2-termux.1.tgz
```

校验下载（可选）：

```bash
sha256sum ~/.npm/_cacache/content-v2/*/*/* 2>/dev/null | head -1   # 或下载 .sha256 资产自行比对
```

> 首次安装会在手机上解包约 650 MB，耗时 10–20 分钟（视存储 I/O）。中途不要中断。

## 使用

```bash
# 启动网页版界面（默认 127.0.0.1:3080）
dsh web

# 换端口、只监听本机、不自动开浏览器
dsh web --port 3191 --host 127.0.0.1 --no-open
```

启动后终端会打印一条带 `?token=` 的地址，复制到手机浏览器打开即可（首次访问换取 Cookie，之后直接访问根地址）。

```bash
# 无界面单次任务
dsh --profile headless "把 src 里的 TODO 整理成清单"

# 插件管理（转发给 profile 目录的 pnpm）
dsh plugin --profile web add <package>
dsh plugin --profile web list
```

- 模型与密钥：写进 `~/.dsh/.credentials.yaml`，或在 `~/.dsh/settings.yaml` 配置 provider。
- 数据位置：`~/.dsh`（`sessions/` 会话、`profiles/` 插件树、`storages/` 工作区）。换机器或测试时可用 `DSH_HOME=/path dsh web` 隔离。
- 常用参数：`--profile <name>` 选 boot 的 profile（`web` / `tui` / `headless`），`--dump-config` 打印合成后的配置树。

## 与上游的差异

| 差异 | 说明 |
|---|---|
| 启动入口 | `lib/bin.js` 以 `node --expose-internals` 运行（0.2.x 用 Node 内部模块做 profile 解析，Android 上没有对应原生绑定） |
| shell | PTY 后端按 `DSH_BASH_SHELL` → Termux `bash` → `/bin/bash` 的顺序探测；不再硬编码不存在的 `/bin/bash` |
| 搜索 | `grep`/`glob` 优先用 `DSH_RG_PATH` 或系统 `rg`（`@vscode/ripgrep` 没有 android-arm64 二进制） |
| 会话落盘 | Android 禁止 `link(2)`，改用 `rename(2)` 发布会话文件 |
| 原生模块 | `koffi` 在本机按 Android 规则编译（去掉 `statx`、API<28 的 `posix_spawn` 守卫）；`node-pty` 复用 N-API 预编译；`sharp` 走 `@img/sharp-wasm32` |

完整清单与理由见 [PATCHES.md](PATCHES.md)。

## 已知限制

- **没有容器沙箱**：Android sepolicy 下 `bubblewrap`/Landlock 不可用，命令执行需要「手动审批」策略或 full-access 模式。
- **grep/glob 需要系统 ripgrep**：`pkg install ripgrep`，或用 `DSH_RG_PATH` 指向二进制。
- 原生模块按 Node 24/26 N-API 构建：用 `nodejs-lts` 最稳；升级 Node 大版本后若报绑定错误，重装本包即可。

## 从源码构建（Termux 本机）

```bash
git clone https://github.com/shioochicqwq/dsh-termux.git
cd dsh-termux
UPSTREAM_VERSION=0.2.1-rc.2 TERMUX_REVISION=1 bash scripts/build-termux.sh
```

需要 `node npm cmake clang make python3 git`，并有一份现成可用的 `dsh-termux` 安装用于借用 `pty.node`（或 `PTY_NODE=/path/to/pty.node` 指定）。构建脚本会：拉取上游依赖树 → 打 Android 补丁 → 编译 koffi → 装入 node-pty/sharp 回退 → 校验 → `npm pack` 出同款 tarball。

## 许可

MIT，见 [LICENSE](LICENSE)。`@deepseek-ai/dsh` 及其依赖归各自作者所有（多为 MIT）；`koffi`、`node-pty`、`sharp`、`ripgrep` 保留各自许可证。

---

## English

Offline Termux/Android-arm64 build of DeepSeek Harness (`dsh`), version `0.2.1-rc.2-termux.1`. The tarball bundles the whole patched dependency tree and prebuilt Android natives, so installing needs no compiler and no network.

```bash
pkg install -y nodejs-lts python ripgrep
npm i -g https://github.com/shioochicqwq/dsh-termux/releases/latest/download/dsh-termux.tgz
dsh --version   # 0.2.1-rc.2
dsh web         # Web UI on 127.0.0.1:3080 (open the printed ?token= URL once)
```

See [PATCHES.md](PATCHES.md) for the Android patch set; MIT licensed.
