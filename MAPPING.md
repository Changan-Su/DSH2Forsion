# DSH → Forsion 映射 / Mapping

目标是 DSH Agent 级能力与 Tangu、WebUI 级内容与 Forsion 无缝兼容。后台复用 DSH 运行时只是实现手段；整页嵌入、另建 DSH 会话或另外登录不构成目标达成。下表区分当前实现与目标缺口。钉死版本：DSH `0.2.2-rc.3`（0.2.0 起）。

The goal is native use of DSH agent capabilities in Tangu and WebUI contributions in Forsion. Reusing the DSH runtime is an implementation choice. Whole-page embedding and separate DSH sessions/accounts do not meet that goal.

## 0.3.0：第 2 档（右栏页、截图类工具）

| DSH 概念 | DSH 里的入口 | 在 Forsion 里 | 0.3.0 |
|---|---|---|---|
| 右侧栏的页（文件、浏览器、终端、插件登记的页） | `sidebarRight.openTab(kind)` 等公开接口；`sidebarRightTabs` 登记表 | DSH 跑的对话右栏多一页「DSH」（宿主 `registerEngineHarness` 的 `railView`）：右栏自己的网页分区里开 DSH 网页，地址 `#d2f-rail=<页>&d2f-session=<会话>&d2f-nonce=<口令>&n=<序号>`，桥的网页端小模块只画右侧栏这一页（展开、按宽度铺满），凭口令报回开没开成（`POST /forsion-bridge/rail/report`，序号小的旧回报不收）。`d2f-rail=*` = 不换页，留着 DSH 按会话存的那页（`dsh.sidebar-right.v1.<sessionId>`，DSH 自己管）。用到的接口少一个就报「对不上」 | ✅（宿主 #722） |
| 模型收不收图 | 模型目录 `llm.resolveModelInfo(...).inputModalities`；附件存储的图片类型 | `POST /forsion-bridge/models/images`：两样都认才算收图；引擎半身的 `modelSeesImages` 交给宿主，电脑控制只在回 `true` 时跑 | ✅（宿主 #722） |
| MCP 工具结果里的图 | `dsh-mcp-client` 收 `image` 内容（0.2.2 的 base64 校验约 490 万字符起爆栈，一张坏图整批作废） | 宿主的工具桥把截图按 MCP image 交回：线内原样、超线换同尺寸 JPEG、再超才缩小并写明倍数 | ✅（宿主 #722） |

## 0.2.0：第 1 档（融合）

| DSH 概念 | DSH 里的入口 | 在 Forsion 里 | 0.2.0 |
|---|---|---|---|
| 运行形态 | `dsh --profile <组合>`；网页界面与对话入口（ACP）是两份官方 bundle | 一份组合同时带 `dsh-base`、`dsh-web-app`、`dsh-acp-app`（网页界面的启动项写在组合配置里：不弹浏览器、只听 127.0.0.1 随机端口），常驻一个进程 | ✅ |
| DSH 目录 | `$DSH_HOME`（缺省 `~/.dsh`） | 用用户自己的，组合名 `forsion`；会话、登录、技能与用户自己的 DSH 是同一批 | ✅ |
| 对话 | ACP `session/new` / `resume` / `prompt` | Forsion 的 DSH 引擎经宿主「常驻引擎」接缝连这个进程的 stdio；网页界面开着同一场会话也接得上 | ✅（宿主 #697） |
| 网页界面 | `dsh web` 页面，令牌换 Cookie | 「DSH 工作台」页签，宿主受控网页容器（本机回环、插件自己的分区、同源导航）；不换肤、不藏元素 | ✅（宿主 #697；旧宿主上提示更新 Forsion） |
| 选中会话 | 客户端 `uiWorkspace.openSession` | 右键「在 DSH 工作台里打开」：宿主先把这场在常驻进程里开着，工作台地址带 `#d2f-session=<id>`，桥的网页端小模块读到后调 `openSession`（只导航）。工作台开着时宿主只换 # 那段（同页）。整页载入时 DSH 会恢复存着的上次那场、可能晚于落点：载入后 8 秒内落点的，小模块在 0.6 / 1.5 / 3 秒读 DSH 存当前会话的 `localStorage['dsh.sessions.current']`，仍是页面载入时存着的那场就再开一次，落上后用户自己点走就收手——**依赖 DSH 的这个内部存储名**：DSH 改了名就读不到，退化成 3 秒内照样再开两三次（这几秒里用户自己点到别处会被拉回一次） | ✅ |
| 组合里关掉的基础工具 | 网页界面那份接线按「预设」逐会话挂 | 组合里全局重新打开（agent-instructions、tool-fs、tool-bash、tool-subagent 等 20 行） | ✅ |
| 插件安装 | 插件页 → `pluginManager.installBundle` | 桥包住它（只拦插件页发起的安装，不拦升级时的装回）；引擎半身装前 / 装后各试启动一次，报告工具、提示词字数、没启动的部分、实测外连主机；用户放行才装；能热加载的装上就生效（genui 实测），DSH 回 `restart-required` 的（skills-manager 1.4.6 实测）要在 Harness 卡上「重启 DSH」 | ✅ |
| DSH 自己的审批 | `approval/request` 链（网页界面、对话入口各挂一环，网页那环接走就不往下传） | 按这一轮是谁发的分：**Forsion 发的轮**（插件在 ACP 管道上看到 `session/prompt`，送进 DSH 之前先告诉桥），桥在链最前面直接交给对话入口那环 → Forsion 的审批卡，批准 / 拒绝回 DSH；**工作台发的轮**（这一轮第一条消息带网页的 `rpcId`）照旧留在工作台。启动时自检桥依赖的内部结构（见下），对不上就整体退回：审批全留在工作台，Forsion 那一轮的审批托盘里出「DSH 在工作台里等你批准」+「打开工作台」（靠会话落盘的 `approval/asked` / `approval/decided` 发现，不靠那条链），原因写进日志和 `GET /forsion-bridge/approvals`。这场在工作台里已有待批的、Forsion 再发一句（DSH 把它排在后面）时，同一句提示再给 Forsion 一次。子代理的审批在工作台，提示挂到根会话上 | ✅（宿主 #697） |
| 版本 | `@deepseek-ai/dsh` 的发布标签 | 跟版通道：CI 自检、带校验值的清单（发布先关）；客户端只装验过的，旧版留着、可退回 | ✅（发布未开） |
| 主题、语言 | `ui-theme` / `locale` 设置 | 跟着 Forsion（桥写进 DSH 设置） | ✅ |
| 已停 | — | DSH Space、三个打补丁的面板、DSH 模型来源；DSH 插件工具进 Tangu 缺省关 | 停 |

**审批接管依赖的 DSH 内部结构**（`src/dsh-bridge/approvals.js` 头注同一份）。1–3 由桥的 `check()` 在每次启动和每次接管前查，跟版 CI 把结果（`forsion` / `workbench` + 原因）记进运行时清单的 `selfCheck.approvals`，只记不拦（对不上是退回提示，不是不能用）；4、5 要真跑一轮才看得出，只有 `npm run test:approvals`（真 DSH × 假模型）覆盖，换钉死的 DSH 版本时要手动跑。4、5 变了的后果：4 变了，工作台发的轮被当成 Forsion 的轮（审批弹在 Forsion，看得见）；5 变了，退回时的提示不出（Forsion 那一轮等到看门狗）。

1. cordis 事件表 `ctx.events._hooks[事件名]` 是 `{ ctx, callback }` 的数组，waterfall 按数组顺序调，`prepend` 放到最前；`hook.ctx.fiber.name` 是挂它的插件名。
2. 审批事件名 `approval/request`，参数 `(request, next)`，`request.agent.session.id` = ACP 的 sessionId，带 `callId`。
3. 对话入口插件名 `acp`，它那一环对不是它开着的会话同步调 `next()`（自检拿一个假会话实调一次）。
4. `agent/inbox/claimed` 的参数 `{ agent, message, turn }`，网页发的消息 `message.source` 带 `rpcId`。
5. `session/event` 的参数 `(session, event)`：`session.header.id` / `origin` / `parentSession`；事件 `approval/asked`（`data.id` / `callId` / `toolName`）、`approval/decided`（`data.id`）、`turn/end`（`data.turn`）。

已知边界：Forsion 的一轮排在工作台用 `/plan` 之类（消息来源只有 `{ kind: 'user' }`）起的一轮后面时，那一轮的审批会弹在 Forsion（看得见、不会被吞）。

## v0.1（下表）

0.2.0 起标「停」的几行不再接通，代码留作第 3 档原生重做的参考。

| DSH 概念 | DSH 里的入口 | 在 Forsion 里 | v0.1 状态 |
|---|---|---|---|
| 插件包 | `dsh.bundle.patch`（cordis.patch.yml）+ 可选 `dsh.client` | 装进 sidecar 的 `forsion` profile（`$DSH_HOME/profiles/forsion`），与用户自己的 `~/.dsh` 完全分开 | ✅ |
| 安装 / 卸载 | `dsh plugin add/remove`（pnpm） | 设置 → DSH2Forsion：先在临时副本里装、试启动，过了才装进来；改前快照、可撤销 | ✅ |
| 版本声明不符 | `dsh plugin allow-version … --accept-risk` | 矩阵验证过的版本自动放行；其余要用户点「承担风险」 | ✅ |
| 宿主服务、存储、后台任务 | `apply(ctx)`、`ctx.effect`、服务注入 | 原样在 sidecar 里跑 | ✅ |
| 工具 | `ctx.tools.register(defineTool(…))` | Tangu 的 ToolProvider：名字 `dsh__<原名>`，参数 schema 原样，`approval: 'always'`、`automationSafe: false`；执行时经桥调 `ctx.tools.execute` | ✅ |
| DSH 自带工具（预设里的 read / bash 等） | 预设作用域 | **不**导入：Tangu 有自己的同类工具，DSH 全局表里只有 `working_directory`，按基线剔除 | 设计如此 |
| 工具与推理归属 | `workingDirectory`、`agents.withInitiator` | 用户＋Tangu 会话派生 opaque key，绑定独立兼容 agent；同目录不同会话隔离，工具和完整推理流共享归属；旧无会话调用保留 cwd 回退 | bridge 0.1.6 |
| 会话历史扩展 | DSH event log、request header、完整模型历史 | 不复制 Tangu 历史、不伪造 DSH 模型事件；依赖这些内容的插件需要专项适配 | 明确边界 |
| 工作目录上下文故障 | agent 创建 / 恢复失败 | 指定了 `cwd` 就必须建立其上下文；失败时报错且不调用工具，下次调用可重试。等待上下文期间取消也不启动工具 | ✅ |
| 工具审批 | `approval/request` 事件 | Tangu 先问；批了以后桥只为这一次调用（60 秒内、同一个 callId）回答 `allowed-once`，别的照常交给 DSH 自己的审批卡 | ✅ |
| 工具取消 | `signal` | Tangu 中止 → HTTP 断开 → 桥中止那次 `execute` | ✅ |
| 系统提示词分节 | `ctx.systemPrompt.section({ name, order, text })` | 拼成一段进 Tangu 的系统提示词（`promptSection`），DSH 自带分节按基线剔除，总长 4000 字封顶 | ✅ |
| 整页诊断入口 | `dsh.client`、插槽 | 独立 diagnostics 入口 | 兼容底座诊断 |
| 插件 WebUI | 官方客户端图与公开插槽 | 主入口选择 TaskBoard / Skills Manager / Git Graph 原版面板；独立根不渲染 DSH AppFrame | bridge 0.1.6；固定版本适配 |
| 看板执行 | 版本和哈希保护的 runner 接口 | 映射到 Tangu runs；原看板 CRUD/轮询/存储保留，真实审批、取消和状态回填；打开会话等待原生导航 ACK | bridge 0.1.6；新版本机宿主 |
| 主题 | `settings` 的 `ui-theme.preference` | 跟随 Forsion 的明暗（`html[data-mode]`），写进 DSH 设置 | ✅ |
| 语言 | `settings` 的 `locale.preference` | 跟随 Forsion 的界面语言（zh / en） | ✅ |
| 登录 | 视图票据及 HttpOnly Cookie | 服务端完成 DSH 认证交换，原生面板不接收 DSH 进程密钥或 Tangu 令牌，不需另行登录 | ✅ |
| 管理目录技能 | DSH 官方文件来源 + `skills.list/get` | 通过宿主 `registerSkillProvider` 进入原生技能列表与 `use_skill`，ID 为 `local:plugin/dsh2forsion/dsh/<name>`；只读、归属明确，尊重禁用与删除 | 已实现；需要新宿主接口，未发布 |
| 项目技能 | 官方 filesystem provider | 当前项目最近 git 根的 `.dsh/skills`、`.agents/skills`，无 git 时用 cwd；来源与根哈希隔离同名技能，校验实际路径和禁用 | bridge 0.1.6 |
| MCP | 官方 tools/schema 与提示分节 | 实时目录和调用，原生 always 审批；保留结构化资源及受支持的图片，音频/blob/私有附件返回明确边界 | bridge 0.1.6 |
| 模型来源 | DSH `llm` 目录与流 | Tangu `registerModelProvider` 命名空间；单次推理保留文本、推理、工具参数及实际用量，原生循环处理工具和审批；撤销与远程调用受限 | bridge 0.1.6；新版宿主 |
| 子进程、原生依赖 | `node-pty`、`koffi` 等 | 运行时只给 DSH 自己的三个原生包跑构建；装前体检一律 `--ignore-scripts`，并读 pnpm 记下的待批构建写进体检卡（要允许 / 已允许 / 组合里不跑）。真装时由 DSH 的 pnpm 管：没允许过的构建脚本报错装不上，允许入口是 DSH 插件页「允许这些脚本并重试」；插件不替用户允许 | ✅ |

## 当前适配的验收 / Adapter acceptance

优先做一个端到端纵向切片：**Forsion 中的第三方看板 → Tangu 执行 → 原面板状态更新**。不是先增加更多整页嵌入样本。

1. **WebUI 宿主契约**：复用插件的客户端注册与公开插槽，提供独立 Forsion View；不靠 CSS 藏起 DSH 侧栏，也不复制第三方看板实现。
2. **执行宿主契约**：面板动作映射到 Tangu 的公开 runs/workspaces API；绑定 Forsion 当前项目和插件拥有的 Tangu 任务会话，审批、取消、结果与恢复都由 Tangu 负责。
3. **能力发现**：技能必须能被 Tangu 列出并实际使用，停用、删除及名称冲突有明确归属；只存在 DSH 文件不能通过。MCP、模型与会话扩展分别验证，工具桥成功不代表它们自动兼容。
4. **验收证据**：从 Forsion 原生入口打开面板，创建任务、真实模型执行、拒绝/取消、重启续接、卸载清理；确认没有意外创建 DSH 模型会话，也没有第二套登录要求。

The next vertical slice is **third-party panel in Forsion → Tangu execution → state update in that same panel**. Reuse public client slots rather than hiding the DSH shell or rewriting the plugin. Map execution to Tangu's public run/workspace APIs with owned task sessions and Tangu approvals/cancellation. Verify skill discovery and use separately from tools. Acceptance includes real execution, rejection, cancellation, restart and unload, without a second DSH model session or login.

TaskBoard 0.4.7 原来在服务内部构造 DSH runner。当前以版本及原始工件哈希保护的部署补丁提供可选 native runner；未知改动拒绝安装，保留上游许可证、原件和 NOTICE，不修改共享 pnpm hardlink。契约见 [native-adapters-v1.md](compat/patches/native-adapters-v1.md)。这不代表任意 DSH 版本、goal/team 模式或依赖 DSH 会话的所有面板均已兼容。

TaskBoard uses a version/hash-guarded optional native runner. Upstream CRUD, rendering and polling stay intact; unknown artifacts fail closed and licenses/notices are preserved. This does not claim arbitrary-version, DSH goal/team or session-dependent UI compatibility. Project skills, MCP and model providers are separate adapters. Session attribution does not mirror native history; see [context-adapters.md](compat/context-adapters.md).

## 当前进程与通信 / Current processes and communication

```
Forsion 桌面（Electron）
 ├─ 界面半身  plugin/main.js           DSH Space、管理页、命令
 │     │ ctx.tangu.request → /extensions/<安装目录>/dsh2forsion/*
 └─ tangu-agent 引擎（子进程）
       └─ 引擎半身  tangu-plugins/dsh2forsion/dist/index.js
             │ 起停、下载、插件管理；ToolProvider + promptSection
             └─ DSH sidecar（官方 Node 24 子进程，127.0.0.1 随机端口）
                   └─ dsh2forsion-bridge   /forsion-bridge/*（每次启动的密钥）
                   └─ 用户装的 DSH 插件
```

- 引擎半身给 sidecar 的环境变量走白名单：不带 Forsion 的令牌、provider key、`FORSION_*` / `TANGU_*`。
- sidecar 的桥在 DSH 进程里每 3 秒看一眼引擎还在不在。Forsion 崩溃或被强杀时，DSH 自己退出，不会变成孤儿进程。
