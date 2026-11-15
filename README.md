# DSH2Forsion

Make DeepSeek Harness (DSH) agent capabilities usable by Tangu and its WebUI contributions usable by [Forsion](https://github.com/Changan-Su/Forsion). Compatible with DeepSeek Harness plugins; not made or endorsed by DeepSeek.

愿景是让 DSH 的 Agent 级能力直接服务 Tangu，让 DSH 的 WebUI 级内容直接融入 Forsion。用户沿用 Forsion / Tangu 的工作区、会话、模型、审批与界面入口，不必操作第二套 DSH 应用。兼容运行时可以在后台存在，但不是产品入口或验收终点。

The compatibility runtime may remain an implementation detail. Users should keep Forsion/Tangu workspaces, conversations, models, approvals and navigation instead of operating a second application. The tier 1 DSH workbench (DSH's own interface in a Forsion tab) is the base that covers every plugin's interface without per-plugin work; it is not the end goal.

**0.2.0（第 1 档 · DSH 工作台）**：Forsion 里常驻一个两头都开的 DSH（官方包 + 一份组合：网页界面和对话入口在同一个进程里），用你自己的 DSH 目录（`$DSH_HOME`，缺省 `~/.dsh`），另用一份名叫 `forsion` 的组合。

| 东西 | 在 Forsion 里 |
|---|---|
| DSH 这个 Agent 的对话 | 连这个常驻的 DSH（Genesis 的「常驻引擎」接缝）；插件不在或对不上时，退回每轮起一个 DSH |
| DSH 自己的界面 | 「DSH 工作台」页签（主区），里面原样是 DSH 的网页界面；从 DSH Agent 的 Harness 卡和对话右键菜单打开；关页签不停 DSH，Forsion 退出时一起停 |
| 装 DSH 插件 | 在工作台里用 DSH 自己的「插件」页；装之前 Forsion 在临时目录里装前、装后各试启动一次，报告加了几个工具、提示词多了多少字、有没有没启动的部分、启动时连了哪些外部主机，你点「装」才继续 |
| DSH 版本 | 固定在这个插件版本验过的那一版；可选「跟版」：只装 DSH2Forsion 的 CI 每天自检过、带校验值的清单里的版本，旧版留着，对不上时可以先退回上一版 |
| 深浅色、语言 | 跟着 Forsion |
| DSH 插件的工具进 Tangu | 缺省关（升版最容易断的一块）；要用 DSH 插件做的事交给 DSH 这个 Agent |
| 已停 | DSH Space、三个打补丁的面板（TaskBoard / Skills Manager / Git Graph）、DSH 模型进 Tangu 模型列表 |

逐项对照见 [MAPPING.md](MAPPING.md)，兼容数据见 [COMPATIBILITY.md](COMPATIBILITY.md)。

## 状态 / Status

**0.2.0**（开发中）：钉死 DSH `0.2.2-rc.3`、Node `v24.22.0`、pnpm `11.28.6`。需要包含 Genesis 常驻引擎、受控网页容器与 Harness 行接缝的宿主（Changan-Su/Forsion#697，未发布）；旧宿主上工作台退回裸 `<webview>`，Harness 行和右键菜单没有，DSH 的对话仍每轮起一个 DSH，运行时设置页会照实写明。

**0.2.0** (in development): pins DSH `0.2.2-rc.3`. Needs a host with the resident-engine, controlled web surface and Harness-row seams (Changan-Su/Forsion#697, unreleased). On older hosts the workbench falls back to a plain `<webview>`, there are no Harness rows or right-click item, and DSH chats still start DSH per turn; the runtime page says so.

**v0.1.0**（2026-10-18）：钉死 DSH `0.2.1-rc.2`；隔离的 DSH 目录、DSH Space、Tangu 工具桥、三个打补丁的原生面板。见 [CHANGELOG.md](CHANGELOG.md)。

## 安装 / Install

把本仓 `plugin/` 文件夹的内容放进 Forsion 的插件目录 `plugins/dsh2forsion/`（安装版是 `~/.forsion/plugins/`），重启 Forsion。只支持桌面（macOS、Windows、Linux，x64 / arm64）。

Copy the contents of `plugin/` into Forsion's `plugins/dsh2forsion/` folder and restart Forsion. Desktop only.

装好后：

1. 把一个 Agent 的「运行在」改成 DSH，在它的 Harness 卡上点「打开工作台」。第一次会说明要下载什么（官方 Node 与 DSH 运行时，装好后约 1.1 GB 磁盘）、从哪下载（nodejs.org / npmjs，失败退国内镜像 npmmirror）、用哪个 DSH 目录，点了才开始。
2. 在工作台里用 DSH 自己的「插件」页装插件，先看体检报告再决定。
3. 和这个 Agent 的对话连的就是工作台里那个 DSH：右键对话「在 DSH 工作台里打开」，工作台直接落在这场对话上，可以在那边接着看、接着说。

你原来在 DSH 里装的插件在你自己的组合里，不会自动出现在 `forsion` 这份组合里。

## 安全模型 / Safety

DSH 插件是**不在沙箱里**的本机代码，权限和你的账户一样。DSH2Forsion 能做的是不让它们**意外**拖垮 Forsion：

- **装前体检**：工作台里装插件时桥先把那次安装停住；在临时目录里拿当前组合装前、装后各起一次，比出加了哪些工具、提示词多了多少字、有没有没启动的部分、启动时连了哪些外部主机（`node --import` 钩子实际量到的，只记主机名）。起不来或夹带了 DSH 核心包会标红；你点「装」才放行，15 分钟没人回答按不装处理。
- **只写自己的组合**：用的是你自己的 DSH 目录，只写 `profiles/forsion`；同名组合不是本插件建的就不碰；DSH 目录顶层的 `cordis.patch.yml`（所有组合共用）只读；组合的 `cordis.patch.yml` 只在没有时写一次，之后 DSH 插件页的开关原样保留。
- **启动令牌不落盘、不打印**：网页界面的登录地址只在内存里交给工作台；日志里的令牌一律抹掉。
- **快照与回滚**：每次卸载、回滚之前拍快照；还记着「上次能启动的状态」，DSH 起不来时一键恢复。
- **跟版**：只装带校验值、自检过、声明支持当前插件版本的清单里的 DSH；旧版运行时留在盘上，「先退回上一版 DSH」只退到装好了、验过的版本。
- **安装不跑脚本**：插件一律 `--ignore-scripts`；运行时只给 DSH 自己的三个原生依赖跑构建。
- **下载校验**：Node 的哈希按官方值钉在代码里。新安装的 DSH 与 pnpm 使用随插件发布的完整依赖锁，版本与完整性哈希来自 npm 官方源；官方源和国内镜像都通过 `npm ci` 安装同一份锁，镜像返回不同内容会被拒绝。旧版已安装的运行时保留原状，不自动重装。
- **环境变量白名单**：sidecar 拿不到 Forsion 的令牌、provider key、`FORSION_*` / `TANGU_*`。
- **只听本机**：DSH 只监听 `127.0.0.1` 随机端口；DSH 的插件路由本身没有鉴权，所以桥的每个请求都核对每次启动新生成的密钥。
- **工具每次都问**：Tangu 侧声明 `approval: 'always'`；你批了，桥才替这一次调用回答 DSH 侧的审批。

## 开发 / Development

社区常用插件的真实发布检查流程、固定版本和复跑命令见 [SCENARIOS.md](SCENARIOS.md)。内部桥 `0.1.4` 为外部工具调用建立 DSH 执行轮次，并正确接管已获 Tangu 批准的单次审批，修复 Skills Manager 创建技能失败及等待网页审批的问题。

See [SCENARIOS.md](SCENARIOS.md) for real community-plugin workflows and reproducible commands. Internal bridge `0.1.4` supplies audited DSH turns and handles the matching Tangu-approved request before the web approval listener, fixing skill creation errors and approval stalls.

```sh
npm ci
npm run build        # 产出 plugin/（提交进仓库，CI 会重建并要求 git diff 为空）
npm run check        # 单测 + 渲染半身（happy-dom）+ 包结构，几秒
DSH2FORSION_ROOT=<已装好运行时的根目录> npm run test:fusion    # 真 DSH 融合端到端（常驻进程、ACP、工作台、装前体检，装 dsh-genui@0.3.3），约 40 秒
DSH2FORSION_FRESH=1 npm run test:fusion                          # 连运行时下载一起
node tests/follow-dsh.mjs check <DSH 版本> <输出目录>            # 跟版通道的自检与清单（CI 每天跑）
tests/tangu/run.sh <Forsion>/tangu-agent <运行时根目录>          # tangu-agent 真加载器
FORSION_DESKTOP=<Forsion>/desktop node tests/gui/dsh2forsion.e2e.cjs   # 真 Forsion 桌面（先在 desktop 里 npm run build；Linux 无显示套 xvfb-run -a）
FORSION_AGENT=<Forsion>/tangu-agent DSH2FORSION_ROOT=<运行时根目录> npm run test:live
```

⚠️ `tests/tangu/`、`tests/gui/*`（`test:gui` / `test:native-gui`）和 `test:live` 走的是 v0.1 的流程（DSH Space、设置页装插件、三个面板、模型来源），还没改到 0.2.0，不在 CI 里。0.2.0 在真 Forsion 里的走查在 Genesis 仓的 `desktop/scripts/dsh-fusion-ui.e2e.cjs`（真 Electron × 托管引擎 × 装好的本插件 × 官方 DSH × 本机假模型 × 隔离 home）。

The v0.1 suites (`tests/tangu/`, `tests/gui/*`, `test:live`) still exercise removed flows and are not in CI. The 0.2.0 real-app walkthrough is `desktop/scripts/dsh-fusion-ui.e2e.cjs` in the Genesis repository.

`test:live` 使用已登录的 Codex 订阅（默认 `~/.forsion-dev/provider-auth.json`，可用 `DSH2FORSION_AUTH` 指定），会消耗模型额度。它在隔离数据目录安装固定版本的任务看板和皮肤，以及用于观测审批和取消的本地探针；不会运行或调度看板任务。输出目录包含结果、事件证据和 `gui-seed.json`，不包含登录文件。先构建 `tangu-agent`，再运行。

完整桌面衔接验收：先按所在 Forsion 仓库的 GUI 独占锁规则取得测试时段，再设置 `FORSION_DESKTOP`、`DSH2FORSION_GUI_SEED=<上一步输出>/gui-seed.json`、`DSH2FORSION_FULL=1` 和 `DSH2FORSION_GUI_LIVE=1`，运行 `npm run test:gui`。它在真实 Electron 窗口验证模型创建的数据、皮肤设置、语言同步、聊天审批、重启持久化和卸载回滚。`DSH2FORSION_SHOTS` 指定截图目录；不设置 seed 或 runtime 时，基础 GUI 测试会从首次下载开始。

CI（`.github/workflows/ci.yml`）每个 PR 与 main 推送跑构建、检查和 Linux 上的完整下载端到端；手动触发时 macOS、Windows 一起跑。

跟版通道（`.github/workflows/follow-dsh.yml`）：每天看 `@deepseek-ai/dsh` 的发布标签，有新版就从官方源生成运行时锁、全新装一遍、起融合组合自检（桥、装插件闸、基础工具、ACP 建会话、网页界面认得那场会话），写出带 sha256 的 `runtime-manifest.json`。清单先只留作这次运行的构件；**发布到通道（Release `dsh-channel`）那一步写好了但关着**，要维护者同意再打开。改到流程或自检脚本的 PR 也跑一次（用随包那一版）。

Follow-version channel: daily, the newest dist-tag is locked from the official registry, installed fresh and self-checked in the fused profile; the checksummed `runtime-manifest.json` is kept as an artifact. **Publishing to the channel is written but switched off** until the maintainer agrees.

| 目录 | 内容 |
|---|---|
| `src/engine/` | 引擎半身（Tangu 引擎插件，只用 Node 内置模块，esbuild 打成单文件）：运行时下载与跟版通道、融合组合、常驻 sidecar（ACP + 网页界面）、装前体检、作用域路由 |
| `src/dsh-bridge/` | 装进融合组合的 DSH 插件：装插件闸、融合自检、工具表与执行、提示词分节、外观同步；`trial-net-hook.mjs` 是体检时量外连的钩子；`client.js` 是网页端唯一的小模块，只做工作台落点（不往 DSH 界面里加东西） |
| `src/renderer/main.js` | 界面半身（Forsion 插件的 setup 体）：DSH 工作台、Harness 卡上的行、对话右键菜单、体检报告、运行时设置页、命令，中英双语 |
| `src/static/` | `manifest.json`、图标、引擎插件清单 |
| `compat/` | 随版本发的兼容数据：内置工具 / 提示词基线（`npm run gen:baseline`）与矩阵评级（`npm run gen:known`） |
| `tests/` | 上面那几条检查与夹具插件 |
| `spike/m0/` | M0 可行性仪器与原始结果 |

升级随包钉死的 DSH 版本：改 `src/engine/constants.mjs`、`src/runtime/package.json`、`compat/known.json` 的 `dsh` → 重生成运行时锁（见下）与 `gen:baseline` → `npm run build` → 过上面全部检查和 `test:fusion`。兼容矩阵（`spike/m0/matrix/`）的评级只对它跑过的那一版算数（`known.json` 的 `matrixDsh`）。

运行时锁位于 `src/runtime/package.json` 与 `src/runtime/package-lock.json`，随构建复制到引擎插件的 `runtime/`。升级 DSH 或 pnpm 时同步修改运行时清单，**在 `src/runtime/` 目录内**使用官方源执行 `npm install --package-lock-only --ignore-scripts --registry=https://registry.npmjs.org/`，检查锁文件差异，再构建和跑真实安装测试。不要从已有 `node_modules/` 生成缺少其他平台可选依赖的锁。

New installations use the shipped lockfile for both DSH and pnpm, including exact dependency versions and integrity hashes from the official npm registry. Official and mirror downloads use the same lock. Existing v0.1 runtimes remain untouched. When upgrading DSH or pnpm, update `src/runtime/package.json`, regenerate its lock from the official registry inside that directory without `node_modules/`, then rebuild and run the fresh-install test. See [npm ci](https://docs.npmjs.com/cli/v11/commands/npm-ci/) for frozen-install behavior.

## 许可 / License

[MIT](LICENSE)。本仓不分发 DSH 运行时与任何第三方插件：运行时在用户确认后从 npm 下载，按它们各自的许可使用；DSH 插件由用户自己安装。

MIT licensed. This repository does not redistribute the DSH runtime or any third-party plugin: the runtime is downloaded from npm after you confirm, under its own license, and you install DSH plugins yourself. DeepSeek and DeepSeek Harness are trademarks of their owners; this project is not affiliated with or endorsed by DeepSeek.
