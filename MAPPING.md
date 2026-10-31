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
| 工具的工作目录 | `workingDirectory` 服务按 agent 会话取 | 每个 Tangu 会话的 `cwd` 对应一个桥自己的 DSH agent（会话 id = `dsh2forsion-<cwd 哈希>`，已归档，不出现在 DSH 的会话列表） | ✅ |
| Agent 会话与上下文扩展 | 会话记录、模型流量、session/preset 作用域 | 当前按 cwd 复用工具执行上下文，未映射每个 Tangu 会话的完整历史或模型流量；同目录不同会话并不拥有独立 DSH agent，不能据工具桥通过宣称此类扩展兼容 | ⏳ 目标缺口 |
| 工作目录上下文故障 | agent 创建 / 恢复失败 | 指定了 `cwd` 就必须建立其上下文；失败时报错且不调用工具，下次调用可重试。等待上下文期间取消也不启动工具 | ✅ |
| 工具审批 | `approval/request` 事件 | Tangu 先问；批了以后桥只为这一次调用（60 秒内、同一个 callId）回答 `allowed-once`，别的照常交给 DSH 自己的审批卡 | ✅ |
| 工具取消 | `signal` | Tangu 中止 → HTTP 断开 → 桥中止那次 `execute` | ✅ |
| 系统提示词分节 | `ctx.systemPrompt.section({ name, order, text })` | 拼成一段进 Tangu 的系统提示词（`promptSection`），DSH 自带分节按基线剔除，总长 4000 字封顶 | ✅ |
| 整页诊断入口 | `dsh.client`、插槽 | DSH Space：整幅嵌入 DSH 自己的 Web 界面（`<webview>`，独立分区 `persist:dsh2forsion`） | 仅兼容底座验证 |
| 界面：插件 UI 进 Forsion 原生视图 | 插槽只能由声明它的父级渲染 | 单面板模式（M3）：把一个插件的界面单独放进 Forsion 视图 | ⏳ M3 |
| 主题 | `settings` 的 `ui-theme.preference` | 跟随 Forsion 的明暗（`html[data-mode]`），写进 DSH 设置 | ✅ |
| 语言 | `settings` 的 `locale.preference` | 跟随 Forsion 的界面语言（zh / en） | ✅ |
| 登录 | DSH Web 的一次性 token → SameSite=Strict cookie | 引擎半身拿 token 换 cookie 调 RPC；webview 打开带 token 的地址自己换 | ✅ |
| 技能、MCP、模型提供方 | DSH 自己的配置 | 当前只在 DSH 内生效；需要映射到 Tangu 的能力注册与配置，不以 DSH 内可用判定完成 | ⏳ 目标缺口 |
| 子进程、原生依赖 | `node-pty`、`koffi` 等 | 运行时只给 DSH 自己的三个原生包跑构建；插件一律 `--ignore-scripts` | ✅ |

## 下一阶段的验收 / Next-stage acceptance

优先做一个端到端纵向切片：**Forsion 中的第三方看板 → Tangu 执行 → 原面板状态更新**。不是先增加更多整页嵌入样本。

1. **WebUI 宿主契约**：复用插件的客户端注册与公开插槽，提供独立 Forsion View；不靠 CSS 藏起 DSH 侧栏，也不复制第三方看板实现。
2. **执行宿主契约**：面板动作映射到 Tangu 的公开 runs/workspaces API；绑定 Forsion 当前项目和插件拥有的 Tangu 任务会话，审批、取消、结果与恢复都由 Tangu 负责。
3. **能力发现**：技能必须能被 Tangu 列出并实际使用，停用、删除及名称冲突有明确归属；只存在 DSH 文件不能通过。MCP、模型与会话扩展分别验证，工具桥成功不代表它们自动兼容。
4. **验收证据**：从 Forsion 原生入口打开面板，创建任务、真实模型执行、拒绝/取消、重启续接、卸载清理；确认没有意外创建 DSH 模型会话，也没有第二套登录要求。

The next vertical slice is **third-party panel in Forsion → Tangu execution → state update in that same panel**. Reuse public client slots rather than hiding the DSH shell or rewriting the plugin. Map execution to Tangu's public run/workspace APIs with owned task sessions and Tangu approvals/cancellation. Verify skill discovery and use separately from tools. Acceptance includes real execution, rejection, cancellation, restart and unload, without a second DSH model session or login.

当前调查发现：Task Board 0.4.7 公开了 `main[key="task-board"]` 客户端插槽，适合作为界面切片；但其服务内部构造 DSH 专用 runner，公开 extension 注册不提供执行器替换。因此单独挂载面板还不能验收为 Tangu 执行兼容。需要先建立可维护的执行适配契约，不能用隐藏按钮或伪造完成状态填补这个缺口。

Task Board 0.4.7 exposes a `main[key="task-board"]` client slot, but internally constructs a DSH-specific runner; its public extension registration does not replace that runner. Mounting the panel alone is insufficient. A maintainable execution-adapter contract must precede any claim of Tangu execution compatibility.

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
