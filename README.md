# DSH2Forsion

Run DeepSeek Harness (DSH) plugins inside [Forsion](https://github.com/Changan-Su/Forsion). Compatible with DeepSeek Harness plugins; not made or endorsed by DeepSeek.

让 DeepSeek Harness 插件在 Forsion 上运行的兼容插件，思路类似 Minecraft 的 Fabric / Forge。做法是 Connector 式：Forsion 里跑一份真的 DSH 运行时（sidecar 子进程），DSH 插件原样装进去，只在边界上做适配。

| DSH 插件的哪一半 | 到了 Forsion 哪里 |
|---|---|
| 宿主半身（服务、存储、后台任务） | 留在 sidecar 里，照 DSH 原样运行 |
| 工具 | 进 Tangu 的工具表，名字前缀 `dsh__`，**每次调用都先问你**（完全放行档也问） |
| 系统提示词分节 | 进 Tangu 的系统提示词（限 4000 字） |
| 界面（页面、面板、设置、插件市场） | DSH Space：整幅嵌入 DSH 自己的 Web 界面，主题与语言跟随 Forsion |

逐项对照见 [MAPPING.md](MAPPING.md)，兼容数据见 [COMPATIBILITY.md](COMPATIBILITY.md)。

## 状态 / Status

**v0.1.0**（2026-10-18）：可安装的 Forsion 插件，钉死 DSH `0.2.1-rc.2`、Node `v24.22.0`。还没发布到任何市场。

- 方案正典：Forsion-Root `docs/ToBeImproved/DSH2Forsion兼容层方案_2026-10-18.md`
- M0 可行性报告：Forsion-Root `docs/ToBeImproved/DSH2Forsion-M0报告_2026-10-18.md`

v0.1 does: download the runtime after you confirm, start and stop DSH, embed the DSH interface in a Space, install and remove DSH plugins with a trial start first, roll back, and offer DSH plugin tools and prompt sections to Tangu. It does not yet render DSH plugin UI inside native Forsion views (M3), and has not been run against a real model.

## 安装 / Install

把本仓 `plugin/` 文件夹的内容放进 Forsion 的插件目录 `plugins/dsh2forsion/`（安装版是 `~/.forsion/plugins/`），重启 Forsion。需要 Forsion 桌面端 2.13.4 或更新，只支持桌面（macOS、Windows、Linux，x64 / arm64）。

Copy the contents of `plugin/` into Forsion's `plugins/dsh2forsion/` folder and restart Forsion. Desktop only, Forsion 2.13.4 or newer.

装好后：

1. 左侧 Ribbon 出现 **DSH**（Space 多时在 Ribbon 的「更多」里）。第一次打开会说明要下载什么（官方 Node 与 DSH 运行时共约 300 MB，装好后占约 1.1 GB 磁盘）、从哪下载（nodejs.org / npmjs，失败退国内镜像 npmmirror），点了才开始。下载加安装：Linux / macOS 的测试机约 1.5 分钟，Windows 的 CI 机器 12–16 分钟（npm 在 Windows 上装 600 多个包慢）。
2. 在 **设置 → DSH2Forsion** 里输入 npm 包名装插件，或在 DSH Space 的插件页里浏览。
3. 插件的工具出现在 Tangu 里，名字以 `dsh__` 开头。

## 安全模型 / Safety

DSH 插件是**不在沙箱里**的本机代码，权限和你的账户一样。DSH2Forsion 能做的是不让它们**意外**拖垮 Forsion：

- **装前试启动**：先在临时副本里装一遍、起一次。起不来，或者夹带了 DSH 核心包（会顶掉运行时的那份），就拦下，不动你的 profile；能起但有条目没激活，就先问你。
- **快照与回滚**：每次装、卸之前拍快照；还记着「上次能启动的状态」，DSH 起不来时一键恢复。
- **安装不跑脚本**：插件一律 `--ignore-scripts`；运行时只给 DSH 自己的三个原生依赖跑构建。
- **下载校验**：Node 的哈希按官方值钉在代码里。DSH 运行时的 npm 包靠所用源给的完整性元数据，退到国内镜像时等于信任镜像；随包发一份锁文件把整棵依赖钉死是后续项。
- **环境变量白名单**：sidecar 拿不到 Forsion 的令牌、provider key、`FORSION_*` / `TANGU_*`。
- **只听本机**：DSH 只监听 `127.0.0.1` 随机端口；DSH 的插件路由本身没有鉴权，所以桥的每个请求都核对每次启动新生成的密钥。
- **工具每次都问**：Tangu 侧声明 `approval: 'always'`；你批了，桥才替这一次调用回答 DSH 侧的审批。

## 开发 / Development

```sh
npm ci
npm run build        # 产出 plugin/（提交进仓库，CI 会重建并要求 git diff 为空）
npm run check        # 单测 + 渲染半身（happy-dom）+ 包结构，几秒
DSH2FORSION_ROOT=<已装好运行时的根目录> npm run test:sidecar   # 真 DSH 端到端，约 1.5 分钟
DSH2FORSION_FRESH=1 npm run test:sidecar                         # 连运行时下载一起，约 3 分钟
tests/tangu/run.sh <Forsion>/tangu-agent <运行时根目录>          # tangu-agent 真加载器
FORSION_DESKTOP=<Forsion>/desktop node tests/gui/dsh2forsion.e2e.cjs   # 真 Forsion 桌面（先在 desktop 里 npm run build；Linux 无显示套 xvfb-run -a）
```

CI（`.github/workflows/ci.yml`）每次推送跑前三条和 Linux 上的完整下载端到端；手动触发时 macOS、Windows 一起跑。

| 目录 | 内容 |
|---|---|
| `src/engine/` | 引擎半身（Tangu 引擎插件，只用 Node 内置模块，esbuild 打成单文件）：运行时下载、sidecar、插件管理、工具桥、作用域路由 |
| `src/dsh-bridge/` | 装进 sidecar profile 的 DSH 插件：给引擎半身提供工具表、执行、提示词分节、外观同步 |
| `src/renderer/main.js` | 界面半身（Forsion 插件的 setup 体）：DSH Space、管理页、命令，中英双语 |
| `src/static/` | `manifest.json`、图标、Space 定义、引擎插件清单 |
| `compat/` | 随版本发的兼容数据：内置工具 / 提示词基线（`npm run gen:baseline`）与矩阵评级（`npm run gen:known`） |
| `tests/` | 上面那几条检查与夹具插件 |
| `spike/m0/` | M0 可行性仪器与原始结果 |

升级 DSH 版本：改 `src/engine/constants.mjs` → 重跑兼容矩阵（`spike/m0/matrix/`）与 `gen:baseline` / `gen:known` → `npm run build` → 过上面全部检查。

## 许可 / License

MIT（待首次发布前确认）。不打包 DSH 运行时与任何第三方插件：运行时在用户确认后下载，插件由用户自己安装。
