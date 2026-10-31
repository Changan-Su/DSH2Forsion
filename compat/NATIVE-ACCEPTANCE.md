# Native acceptance / 原生兼容验收

Bridge 0.1.6 targets DSH 0.2.1-rc.2, TaskBoard / Git Graph 0.4.7 and Skills Manager 1.2.24. Use a built Tangu host containing Genesis #392 and #395. These APIs are merged but have not shipped in a desktop release. Run from the DSH2Forsion repository after `npm run build`.

内部桥 0.1.6 的验收对象是固定版本的原版插件内容。真实模型统一使用 `codex/gpt-6-luna`；下面各项独立报告，确定性协议检查不计入真实模型次数。

| Command | Scope / 范围 |
|---|---|
| `npm run check` | Source/build, renderer, skills, native execution, model mapping, session scope and guarded adapter regressions; no model calls / 无模型回归 |
| `npm run test:mcp` | Official DSH MCP client with a fixture stdio server: schema/resources, structured output/images, scope and revocation / 真实客户端协议 |
| `npm run test:session-scope` | Real DSH agent factory, maintenance turn, archive, asynchronous initiator, same-directory isolation and process restart; no model / 真实进程归属 |
| `npm run test:models-live` | Tangu native model source → official DSH provider → fixture transport → real Luna; native tool approval and final answer. Two upstream calls. Scope/cancel/disable cases are deterministic fixtures / 真实单次推理接口与原生循环 |
| `npm run test:native-gui` | Original third-party panel in managed Electron; native project/model, approval/reject/cancel, history, restart and panel screenshots / 真机原生操作 |
| `npm run test:billion-live` | Isolated pinned Billion plugin and real upstream inference; distinguish actual compressed input from simple interception / 独立压缩证据 |

Runtime checks use `DSH2FORSION_ROOT=<existing plugin-data with node/ and runtime/>`; MCP uses `DSH2FORSION_MCP_RUNTIME=<that root>/runtime/0.2.1-rc.2`. Live model checks use `FORSION_AGENT=<built tangu-agent>`. Credentials are read through the authorized original provider, never copied into evidence. Each test saves raw evidence under `.tmp/`, which is ignored by Git.

GUI: set `FORSION_DESKTOP=<built desktop>`, `FORSION_AGENT`, `DSH2FORSION_ENGINE_MODE=managed` and an isolated `DSH2FORSION_GUI_HOME`. The harness stages the existing desktop build separately and points its managed child at the tested engine; external mode cannot grant local plugin capability. Run through the workspace's GUI lock. `DSH2FORSION_NATIVE_CASES=approve,reject,cancel` selects tasks; `DSH2FORSION_NATIVE_PANELS_ONLY=1` verifies panel rendering without model calls. Before a task starts, assert the real sidebar selection, authenticated view request and native cwd agree. A pinned chat pane alone does not change the global active project; a missing selection fails closed.

真机台架使用独立 managed 桌面及数据目录，不修改用户主检出与实际项目。调用模型前先核对侧栏活动会话、原生请求与目录；没有会话不能回退旧 ledger。TaskBoard 的任务、审批与历史在 Tangu 中，DSH 只保留外部执行引用。桌面重启后核对实际原生结果，不能只看卡片颜色。

HTML: `npm run report:html` reads archived raw results in the sibling `harness-runs/2026-10-31/`. Screenshots remain separate local artifacts and are never embedded in committed HTML. Historical whole-DSH-page screenshots must stay labeled as a diagnostic baseline. The generated report distinguishes native desktop, browser, real model and deterministic protocol evidence.

Scope limits: DSH goal/team modes, session-only Git branch/worktree chips, arbitrary plugin versions and whole-history/archive consumers are not covered by these adapters. Model inference does not map DSH private attachment handles. MCP audio/blob content has explicit unsupported diagnostics. Billion attribution or one synthetic-history compression test does not establish transparent Tangu Historian/reset/fork coordination.
