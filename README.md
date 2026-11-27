# dsh-termux

DeepSeek Harness `0.2.1-rc.4` 的 Termux 版本，在 Android（arm64）上直接运行 `dsh`。

当前已发布版本：**`0.2.1-rc.4-termux.1`**。下面的安装命令仍指向该版本。

**Alpha 暂存（未发布）**：当前源码对齐 `@deepseek-ai/dsh@0.2.3-alpha.2`，候选包名为 `dsh-termux@0.2.3-alpha.2-termux.1`。目前只在 Linux 上验证了 Android arm64 目标的真实 npm 依赖树、源码补丁和包元数据；尚未在 Android/Termux 上编译、安装或运行，也没有可安装的候选包。

安装包是离线包：全部依赖和 Android 版原生模块都已打包，安装时只下载这一个文件，不访问 npm 源，也不需要编译。

## 安装

```bash
pkg install -y nodejs-lts python ripgrep
npm i -g https://github.com/shioochicqwq/dsh-termux/releases/download/v0.2.1-rc.4-termux.1/dsh-termux-0.2.1-rc.4-termux.1.tgz
dsh --version     # 0.2.1-rc.4
```

- 安装包约 80 MB，解包后约 480 MB、6 万多个文件，手机上通常要 10 分钟以上，中途不要关闭 Termux。
- 网络不稳时，可以先在 [Releases](../../releases) 下载 `.tgz`，再在下载目录里执行 `npm i -g ./dsh-termux-0.2.1-rc.4-termux.1.tgz`。
- 本包提供 `dsh` 命令。如果之前用别的方式全局装过 dsh，先 `npm uninstall -g` 掉，否则两个包会抢同一个命令。

**升级**：用新版本的地址或文件再执行一次 `npm i -g …`，会直接覆盖。
**卸载**：`npm uninstall -g dsh-termux`。会话和配置保存在 `~/.dsh`，升级、卸载都不会动它们。

## 使用

```bash
dsh web                          # 网页界面，默认 127.0.0.1:3080
dsh web --port 3191 --no-open    # 换端口、不自动打开浏览器
```

启动后终端会打印一条带 `?token=` 的地址，用手机浏览器打开一次即可登录，之后访问根地址就行。

```bash
dsh --profile headless "把 src 里的 TODO 整理成清单"   # 无界面执行单个任务
dsh plugin --profile web add <package>                 # 安装插件
dsh plugin --profile web list
```

- **模型与密钥**：写在 `~/.dsh/.credentials.yaml`，或在 `~/.dsh/settings.yaml` 里配置 provider。
- **数据位置**：`~/.dsh`（`sessions/` 会话、`profiles/` 插件、`storages/` 工作区）。想隔离测试可以用 `DSH_HOME=/path dsh web`。
- **常用参数**：`--profile web|tui|headless` 选择 profile，`--dump-config` 打印合成后的配置。

## 与桌面版的差异

Android 的应用沙箱和 Termux 的目录结构与桌面 Linux 不同，以下几处做了适配，功能与桌面版一致：

| 项目 | 做法 |
|---|---|
| 启动 | `dsh` 以 `node --expose-internals` 启动，代替没有 Android 版本的原生模块 |
| shell | 依次查找 `DSH_BASH_SHELL`、Termux 的 `bash`（Android 没有 `/bin/bash`） |
| 搜索 | `grep` / `glob` 使用 Termux 的 `rg`，或 `DSH_RG_PATH` 指定的可执行文件 |
| 写文件、附件、会话 | 优先用硬链接发布；Android 拒绝硬链接时改为独占复制，同样不会覆盖已有文件 |
| 附件持久化 | 逐级同步父目录时，跳过 Android 不允许打开的系统目录（如 `/data/data`） |
| 会话写锁 | 通过 `koffi` 直接调用 libc 的 `flock`，同一会话不会被两个进程同时写入 |
| 原生模块 | `koffi` 按 Android 编译，`node-pty` 使用 Android 预编译版本，`sharp` 使用 WebAssembly 版本 |

逐项改动见 [PATCHES.md](PATCHES.md)。

## 已知限制

- **没有容器沙箱**：Android 上无法运行 `bubblewrap` / Landlock。执行命令请使用「手动审批」策略，或明确选择完全访问模式。
- **需要 ripgrep**：搜索工具依赖 `rg`，`pkg install ripgrep` 即可。
- **路径固定为 Termux 默认前缀**：`dsh` 的启动行写死了 `/data/data/com.termux/files/usr/bin/node`，不支持改过安装前缀的 Termux。
- **用 `node` 直接运行入口文件时要带上 `--expose-internals`**，否则 profile 无法加载。正常使用 `dsh` 命令不受影响。

## 从源码构建（Android arm64 / Termux）

### 已发布版本（历史构建）

```bash
pkg install -y nodejs-lts python git cmake clang make
git clone --branch v0.2.1-rc.4-termux.1 https://github.com/shioochicqwq/dsh-termux.git
cd dsh-termux
UPSTREAM_VERSION=0.2.1-rc.4 TERMUX_REVISION=1 bash scripts/build-termux.sh
```

旧版构建需要一份 Android 版 `pty.node`：已经装过 dsh-termux 时会尝试取用，否则用 `PTY_NODE=/path/to/pty.node` 指定。

### Alpha 暂存分支（仅供真机验证）

先用 `node --version` 确认 Termux 提供满足 **`^24.22.3 || >=26.13.1`** 的 Node.js，且编译时不能禁用 `node:sqlite`。Node 24.22.2、25.x、26.13.0 及预发行版不满足要求；不要绕过检查。若本机软件源还不提供兼容版本，请暂用上面的已发布版本。

```bash
# 在当前源码目录用 Termux 执行，安装与设备适配测试前不要用生产 DSH_HOME。
pkg install -y python git cmake clang make ripgrep
node --version
PTY_NODE=/path/to/android-arm64/pty.node bash scripts/build-termux.sh
```

`PTY_NODE` 需要是 `node-pty@1.2.0-beta.15` 的 Android arm64 原生模块；不指定时，脚本会在已安装的 `dsh-termux` 的 `prebuilds/android-arm64` 下查找。构建入口在开始安装前检查 Node、平台和 PTY 文件；验证通过才会生成 `dist/` 中的候选包及校验和。Linux 上不要尝试生成可发布的 Android 包。

## 许可

MIT，见 [LICENSE](LICENSE)。构建与补丁脚本部分改编自 sunflower2333/dsh-android（MIT）。安装包内的各依赖保留各自的许可证。

---

## English

The released package is DeepSeek Harness `0.2.1-rc.4` for Termux on Android arm64 (`0.2.1-rc.4-termux.1`). It bundles all dependencies and native modules for offline installation. The `0.2.3-alpha.2` sources on this branch are staging only: they require Node `^24.22.3 || >=26.13.1` and have not been built or tested on Android. No alpha installer is available.

```bash
pkg install -y nodejs-lts python ripgrep
npm i -g https://github.com/shioochicqwq/dsh-termux/releases/download/v0.2.1-rc.4-termux.1/dsh-termux-0.2.1-rc.4-termux.1.tgz
dsh --version   # 0.2.1-rc.4
dsh web         # Web UI on 127.0.0.1:3080; open the printed ?token= URL once
```

There is no container sandbox on Android; use manual approval for commands. See [PATCHES.md](PATCHES.md) for the Android changes. MIT licensed.
