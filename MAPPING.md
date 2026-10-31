# DSH → Forsion 映射 / Mapping

目标是 DSH Agent 级能力与 Tangu、WebUI 级内容与 Forsion 无缝兼容。后台复用 DSH 运行时只是实现手段；整页嵌入、另建 DSH 会话或另外登录不构成目标达成。下表区分当前实现与目标缺口。钉死版本：DSH `0.2.1-rc.2`。

The goal is native use of DSH agent capabilities in Tangu and WebUI contributions in Forsion. Reusing the DSH runtime is an implementation choice. Whole-page embedding and separate DSH sessions/accounts do not meet that goal.

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
| 子进程、原生依赖 | `node-pty`、`koffi` 等 | 运行时只给 DSH 自己的三个原生包跑构建；插件一律 `--ignore-scripts` | ✅ |

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
