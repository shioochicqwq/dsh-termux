# dsh-termux

DeepSeek Harness `0.2.1-rc.2` 的 Termux 版本，运行在 Android arm64 上。

当前版本：**`0.2.1-rc.2-termux.1`**

安装包里已经带好全部依赖和 Android 版原生模块，安装时不访问 npm 源、不需要编译工具链。

## 安装

1. 安装基础依赖：

   ```bash
   pkg install -y nodejs-lts python ripgrep
   ```

2. 从 [Releases](../../releases) 下载 `dsh-termux-0.2.1-rc.2-termux.1.tgz`，然后在下载目录里安装：

   ```bash
   npm i -g ./dsh-termux-0.2.1-rc.2-termux.1.tgz
   ```

   首次安装会解包约 650 MB，视存储速度需要 10–20 分钟，中途不要中断。

3. 验证：

   ```bash
   dsh --version     # 0.2.1-rc.2
   ```

升级：下载新版本的 tgz 后同样执行 `npm i -g ./<文件名>.tgz`，会覆盖旧版本。
卸载：`npm uninstall -g dsh-termux`（会话和配置在 `~/.dsh`，不会被删除）。

> 本包提供 `dsh` 命令。如果之前用其他方式全局安装过 dsh，先卸载，否则两个包会争用同一个命令名。

## 使用

```bash
# 启动网页界面（默认 127.0.0.1:3080）
dsh web

# 换端口、不自动打开浏览器
dsh web --port 3191 --no-open
```

启动后终端会打印一条带 `?token=` 的地址，用手机浏览器打开一次即可登录，之后直接访问根地址。

```bash
# 无界面执行单个任务
dsh --profile headless "把 src 里的 TODO 整理成清单"

# 管理插件（转发给 profile 目录里的 pnpm）
dsh plugin --profile web add <package>
dsh plugin --profile web list
```

- 模型与密钥：写在 `~/.dsh/.credentials.yaml`，或在 `~/.dsh/settings.yaml` 里配置 provider。
- 数据位置：`~/.dsh`（`sessions/` 会话、`profiles/` 插件、`storages/` 工作区）。测试时可以用 `DSH_HOME=/path dsh web` 隔离。
- 常用参数：`--profile <name>` 选择 profile（`web` / `tui` / `headless`），`--dump-config` 打印合成后的配置。

## Termux 适配

| 项目 | 做法 |
|---|---|
| 启动 | `dsh` 以 `node --expose-internals` 启动；0.2.x 的 profile 解析要用 Node 内部模块，原本依赖的原生模块没有 Android 版本 |
| shell | 依次查找 `DSH_BASH_SHELL`、Termux 的 `bash`、`/bin/bash`（Android 没有 `/bin/bash`） |
| 搜索 | `grep` / `glob` 使用 `DSH_RG_PATH` 或 Termux 的 `rg`（ripgrep 依赖包没有 android-arm64 版本） |
| 会话落盘 | Android 不允许应用创建硬链接，会话文件改用重命名发布 |
| 原生模块 | `koffi` 按 Android 规则编译；`node-pty` 使用 Android 预编译版本；`sharp` 使用 WebAssembly 版本 |

逐项改动见 [PATCHES.md](PATCHES.md)。

## 已知限制

- **没有容器沙箱**：Android 上无法运行 `bubblewrap` / Landlock，执行命令需要使用「手动审批」策略或完全访问模式。
- **同一会话不要同时用多个 dsh 进程打开**（例如 `dsh web` 和 `dsh --profile headless` 同时操作同一会话）：会话文件改用重命名发布后，并发写入时后写的会覆盖先写的。
- **搜索工具需要 ripgrep**：`pkg install ripgrep`，或用 `DSH_RG_PATH` 指定可执行文件。
- 原生模块按 Node 24 构建，建议使用 `nodejs-lts`。升级 Node 大版本后如果报原生模块加载错误，重新安装本包即可。

## 从源码构建（在 Termux 里）

```bash
git clone https://github.com/shioochicqwq/dsh-termux.git
cd dsh-termux
UPSTREAM_VERSION=0.2.1-rc.2 TERMUX_REVISION=1 bash scripts/build-termux.sh
```

需要 `node npm cmake clang make python3 git`。构建时还需要一份 Android 版 `pty.node`：已经装过 dsh-termux 时会自动取用，否则用 `PTY_NODE=/path/to/pty.node` 指定。产物在 `dist/`。

## 许可

MIT，见 [LICENSE](LICENSE)。构建与补丁脚本部分改编自 sunflower2333/dsh-android（MIT）。安装包内的各依赖保留各自的许可证。

---

## English

DeepSeek Harness `0.2.1-rc.2` for Termux on Android arm64 (`0.2.1-rc.2-termux.1`). The package ships every dependency and the Android native modules, so installing needs no npm registry access and no compiler.

```bash
pkg install -y nodejs-lts python ripgrep
npm i -g ./dsh-termux-0.2.1-rc.2-termux.1.tgz   # downloaded from Releases
dsh --version   # 0.2.1-rc.2
dsh web         # Web UI on 127.0.0.1:3080 (open the printed ?token= URL once)
```

See [PATCHES.md](PATCHES.md) for the Android changes. MIT licensed.
