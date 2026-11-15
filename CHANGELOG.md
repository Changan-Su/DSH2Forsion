# Changelog

## 0.2.0 — 未发布 / Unreleased

第 1 档（DSH 工作台）。钉死 DSH `0.2.2-rc.3`。需要 Changan-Su/Forsion#697 的宿主接缝（未发布）。

- **常驻一个两头都开的 DSH**：官方包加一份组合（网页界面 + 对话入口在同一个进程），放在你自己的 DSH 目录里、名叫 `forsion`。替 Forsion 的 DSH 引擎登记成常驻进程：和 DSH 这个 Agent 的对话改连它，不再每轮起一个。只写自己那份组合；同名组合不是本插件建的就不碰；DSH 目录顶层的 `cordis.patch.yml` 只读。启动令牌不落盘、不进日志。
- **DSH 工作台**：主区页签，里面原样是 DSH 的网页界面（宿主的受控网页容器）。从 DSH Agent 的 Harness 卡和对话右键菜单「在 DSH 工作台里打开」进（右键进的直接落在那场对话上：桥带一个只做导航的网页端小模块，调 DSH 自己的 `openSession`）；关页签不停 DSH。Harness 卡上加三行：运行时、更新通道、DSH 插件。
- **装前体检**：在工作台里用 DSH 自己的插件页装插件时，先停住，在临时目录里装前、装后各试启动一次，报告加了几个工具、提示词多了多少字、有没有没启动的部分、启动时连了哪些外部主机（实测），你点「装」才装。
- **跟版通道**：CI 每天看上游、生成锁、全新装、自检、出带校验值的运行时清单（发布那一步先关着）。客户端只装验过的清单、旧版留着；融合自检不过时工作台停用、显示「等插件更新」，给「先退回上一版 DSH」（没有验过的旧版时不可点），对话退回每轮起一个 DSH 并照实提示。
- 写盘与收尾：恢复 / 卸载 / 回滚前核对组合是本插件建的，快照只还原回建它的那份 DSH 目录；插件停用后不再起试启动的 DSH；DSH 里点取消时，还在等 Forsion 回话的那次安装按拒绝处理；常驻进程输出按流解码（中文跨块不乱码）；通道版本修复时按存着的清单装。
- DSH 插件工具进 Tangu 缺省关。停用：DSH Space、TaskBoard / Skills Manager / Git Graph 三个打补丁的面板、DSH 模型进 Tangu 模型列表。桥 0.2.0：工具调用用 0.2.2 的批量接口。
- Tier 1: one resident DSH with the web interface and ACP in one process (own profile `forsion` in your DSH folder) that DSH chats connect to; the DSH workbench tab; Harness rows and a right-click item; an install review measured before and after in a scratch folder; a follow-version channel (publishing off) with going back to an earlier verified DSH. DSH plugin tools in Tangu are off by default; the DSH Space, the three patched panels and DSH model sources are stopped.

## Unreleased (0.1.x)

- DSH 管理目录技能通过新宿主 `registerSkillProvider` 接入 Tangu 原生列表与 `use_skill`；带独立命名空间与只读来源信息，停用、删除和源调用策略立即生效。需要 Genesis 配套接口，尚未发布。
- Managed DSH skills now use the host's native skill catalog and `use_skill`, with namespaced identities, read-only source ownership, and live disable/delete policy. Requires the companion Genesis host API, not yet released. Real-model scenarios are in `SCENARIOS.md`.

- 修复带 DSH 二次审批的插件工具（例如 Skills Manager 创建技能）无法执行：桥接调用现在具有完整执行轮次和审批审计；同目录调用顺序执行，异常及取消正确结束轮次。
- 已获 Tangu 批准的单次调用优先处理对应 DSH 审批，避免被 DSH 网页审批处理器无限等待；其他调用保持原审批流程。
- Added reproducible real-model and Electron workflows for Free Search, Skills Manager, Task Board and Git Graph; see [SCENARIOS.md](SCENARIOS.md).
- Fixed DSH approval-requiring tools by enclosing each external call in an audited turn and serializing calls per working directory. Exceptions and cancellation close the turn. The bridge consumes only the matching Tangu-approved request before the DSH web approval handler.

- 新安装使用随包发布的完整依赖锁，固定 DSH、pnpm 及传递依赖的版本和官方完整性哈希；切换镜像时仍校验同一份锁。
- 已安装的 v0.1 运行时不自动重装；重复安装直接复用正常运行时。缺失 pnpm、版本不符或损坏的就绪标记不再误报为可用。
- New installations pin DSH, pnpm and their transitive dependencies using a shipped lockfile with official integrity hashes, including when downloading from a mirror.
- Existing v0.1 runtimes remain intact. Repeated installation reuses a ready runtime; missing pnpm, mismatched versions and malformed readiness markers are detected.

## 0.1.0 — 2026-10-18

第一个可安装的版本。钉死 DSH `0.2.1-rc.2`、Node `v24.22.0`、pnpm `11.28.6`。

- **DSH Space**：第一次打开说明要下载什么、从哪下载、占多少空间、不是沙箱，点了才下载。官方源失败时退国内镜像，校验 SHASUMS256。之后整幅嵌入 DSH 自己的 Web 界面，明暗与语言跟随 Forsion。
- **插件管理**（设置 → DSH2Forsion）：按 npm 包名装插件。先在临时副本里试装、试启动，对照兼容矩阵；改 profile 之前拍快照；可撤销上一次改动（被换下来的那份留在 `backups/undone-*`），DSH 起不来时可恢复到上次能启动的状态。
- **Tangu 工具桥**：DSH 插件注册的工具以 `dsh__` 前缀进 Tangu，每次调用都先问；在会话的工作目录里执行。DSH 插件的系统提示词分节进 Tangu 的系统提示词。
- **安全**：sidecar 只听 127.0.0.1，环境变量走白名单，桥的每个请求核对每次启动新生成的密钥。Node 的哈希按官方值钉在代码里，镜像连校验文件一起被改也过不了。安装一律不跑脚本，只给 DSH 自己的三个原生依赖跑构建。Forsion 崩溃时 DSH 自己退出；停用插件时正在起的 DSH 也会收掉。
- 界面中英双语。
- 以 MIT 许可开源；暂不上 Forsion 商店。

未做：DSH 插件 UI 进 Forsion 原生视图（M3）；DSH 的技能 / MCP 进 Tangu；真模型下的端到端验证。
