# DSH → Forsion 映射 / Mapping

DSH2Forsion 不重写 DSH 的接口。DSH 插件跑在真的 DSH 运行时里，下表说的是它们的能力在 Forsion 里**从哪儿出来**。钉死版本：DSH `0.2.1-rc.2`。

| DSH 概念 | DSH 里的入口 | 在 Forsion 里 | v0.1 状态 |
|---|---|---|---|
| 插件包 | `dsh.bundle.patch`（cordis.patch.yml）+ 可选 `dsh.client` | 装进 sidecar 的 `forsion` profile（`$DSH_HOME/profiles/forsion`），与用户自己的 `~/.dsh` 完全分开 | ✅ |
| 安装 / 卸载 | `dsh plugin add/remove`（pnpm） | 设置 → DSH2Forsion：先在临时副本里装、试启动，过了才装进来；改前快照、可撤销 | ✅ |
| 版本声明不符 | `dsh plugin allow-version … --accept-risk` | 矩阵验证过的版本自动放行；其余要用户点「承担风险」 | ✅ |
| 宿主服务、存储、后台任务 | `apply(ctx)`、`ctx.effect`、服务注入 | 原样在 sidecar 里跑 | ✅ |
| 工具 | `ctx.tools.register(defineTool(…))` | Tangu 的 ToolProvider：名字 `dsh__<原名>`，参数 schema 原样，`approval: 'always'`、`automationSafe: false`；执行时经桥调 `ctx.tools.execute` | ✅ |
| DSH 自带工具（预设里的 read / bash 等） | 预设作用域 | **不**导入：Tangu 有自己的同类工具，DSH 全局表里只有 `working_directory`，按基线剔除 | 设计如此 |
| 工具的工作目录 | `workingDirectory` 服务按 agent 会话取 | 每个 Tangu 会话的 `cwd` 对应一个桥自己的 DSH agent（会话 id = `dsh2forsion-<cwd 哈希>`，已归档，不出现在 DSH 的会话列表） | ✅ |
| 工具审批 | `approval/request` 事件 | Tangu 先问；批了以后桥只为这一次调用（60 秒内、同一个 callId）回答 `allowed-once`，别的照常交给 DSH 自己的审批卡 | ✅ |
| 工具取消 | `signal` | Tangu 中止 → HTTP 断开 → 桥中止那次 `execute` | ✅ |
| 系统提示词分节 | `ctx.systemPrompt.section({ name, order, text })` | 拼成一段进 Tangu 的系统提示词（`promptSection`），DSH 自带分节按基线剔除，总长 4000 字封顶 | ✅ |
| 界面：页面、面板、侧栏、设置、插件市场 | `dsh.client`、插槽 | DSH Space：整幅嵌入 DSH 自己的 Web 界面（`<webview>`，独立分区 `persist:dsh2forsion`） | ✅ |
| 界面：插件 UI 进 Forsion 原生视图 | 插槽只能由声明它的父级渲染 | 单面板模式（M3）：把一个插件的界面单独放进 Forsion 视图 | ⏳ M3 |
| 主题 | `settings` 的 `ui-theme.preference` | 跟随 Forsion 的明暗（`html[data-mode]`），写进 DSH 设置 | ✅ |
| 语言 | `settings` 的 `locale.preference` | 跟随 Forsion 的界面语言（zh / en） | ✅ |
| 登录 | DSH Web 的一次性 token → SameSite=Strict cookie | 引擎半身拿 token 换 cookie 调 RPC；webview 打开带 token 的地址自己换 | ✅ |
| 技能、MCP、模型提供方 | DSH 自己的配置 | 只在 DSH Space 里生效，不进 Tangu | ⏳ 未定 |
| 子进程、原生依赖 | `node-pty`、`koffi` 等 | 运行时只给 DSH 自己的三个原生包跑构建；插件一律 `--ignore-scripts` | ✅ |

## 进程与通信

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
