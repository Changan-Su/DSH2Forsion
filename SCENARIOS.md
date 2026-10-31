# 社区插件真实场景 / Community plugin workflows

**验收层次**：工具经真实 Tangu 调用属于 Agent 兼容证据；嵌入 DSH 页面的看板、技能页、Git Graph 操作只证明运行时底座可用。它们尚未证明插件 WebUI 已融入 Forsion，也未证明 DSH 技能被 Tangu 发现或执行。最终验收必须沿用 Forsion / Tangu 的入口、工作区、会话和审批，见 [MAPPING.md](MAPPING.md)。

**Acceptance scope:** real Tangu tool calls prove agent-tool interoperability. Embedded DSH pages prove runtime behavior only, not native Forsion WebUI integration or Tangu skill discovery/execution. Final acceptance must use Forsion/Tangu navigation, workspace, conversation and approval context.

## 选择与版本 / Selection and versions

2026-10-31 查询 npm 官方周下载量（2026-10-23 至 2026-10-29）。下载量用于筛选社区常用插件，不等同于独立用户数或完整热门榜。

Official npm weekly downloads were checked on 2026-10-31 for October 23–29. Downloads help select commonly used packages; they are neither unique users nor an exhaustive popularity ranking.

| Plugin | Tested version | Weekly downloads / 周下载 |
|---|---|---:|
| [dsh-free-search](https://www.npmjs.com/package/dsh-free-search) | 0.9.26 | 29,068 |
| [@michengai/dsh-skills-manager](https://www.npmjs.com/package/@michengai/dsh-skills-manager) | 1.2.24 | 40,545 |
| [@linxin666/dsh-client-ui-task-board](https://www.npmjs.com/package/@linxin666/dsh-client-ui-task-board) | 0.4.7 | 41,375 |
| [@linxin666/dsh-client-ui-git-graph](https://www.npmjs.com/package/@linxin666/dsh-client-ui-git-graph) | 0.4.7 | 39,405 |

来源：`https://api.npmjs.org/downloads/point/2026-10-23:2026-10-29/<package>`。看板和 Git Graph 的最新 0.4.13 要求 DSH ≥0.2.1-rc.3，因此当前固定 rc.2 的运行时测试其兼容版本 0.4.7。

Source: the official npm downloads API above. Task Board and Git Graph 0.4.13 require DSH ≥0.2.1-rc.3; these scenarios pin compatible version 0.4.7 for the current rc.2 host.

## 发布检查流程 / Release review workflow

1. **查资料 → 建任务**：真实 Tangu 模型通过 `dsh__platform_search` 查询 npm，将实际返回的来源 URL 写进待办，再读取确认。桌面打开任务详情检查同一条数据。
2. **建立可复用技能**：模型通过 `dsh__create_skill` 写发布检查清单。独立检查 `DSH_HOME/skills/<name>/SKILL.md`，再在 DSH 设置的技能页查看正文。
3. **检查 Git 历史**：在隔离的真实 Git 项目里打开 Git Graph，核对提交，再从界面切换检查分支；用磁盘上的 Git HEAD 独立验证。
4. **重启续接**：重启 DSH 后，新模型会话读取并修改之前的任务；整个 Forsion 重启后再次检查任务、技能文件和 Git 分支。

The real Tangu model researches an npm package, saves its source in a task, and creates a reusable release-review skill. The Electron test opens the same task and skill, inspects real Git commits, switches branches, and verifies persistence after restarting Forsion. Tests use isolated data and never run or schedule the review task.

## 运行 / Run

先构建 Tangu 引擎并按 README 配置登录与运行时，然后运行：

Build the Tangu engine and configure authentication and runtime as described in README, then run:

```sh
DSH2FORSION_SCENARIOS=popular npm run test:live
DSH2FORSION_GUI_SEED=<live-output>/gui-seed.json DSH2FORSION_POPULAR=1 npm run test:gui
```

已跑过基础安装/主题链路时，可用 `DSH2FORSION_POPULAR_ONLY=1` 定向复跑同一 seed 的插件场景；它不重复安装夹具。This targeted option reuses the seed and skips the separately tested management/theme path.

两条命令还分别需要 README 中的 `FORSION_AGENT` / `DSH2FORSION_ROOT` 与 `FORSION_DESKTOP`。GUI 必须遵守宿主项目的独占测试锁。模型默认 `codex/gpt-6-luna`，会消耗订阅额度。产物包含事件、实际工具结果、技能正文、Git 数据和 GUI 截图；不包含登录文件。

The commands also require the agent/runtime and desktop paths documented in README. Follow the host project's exclusive GUI lock. Live tests use `codex/gpt-6-luna` by default and consume subscription quota. Evidence includes tool events/results, skill content, Git state and GUI screenshots, without authentication files.

## 能力边界 / Scope

- Free Search 是新增的 `dsh__` 工具，不会替换 Tangu 自带搜索。
- Skills Manager 创建的是 DSH 技能，不会自动进入 Tangu 技能列表。
- Billion Context 依赖其代理见过所属 DSH 会话的模型流量，不能据“插件启动成功”宣称它压缩了 Tangu 对话。
- ModLens 视觉场景需要另配视觉 provider 或明确启用本地 CLI 凭据复用；本轮不修改用户全局配置，未宣称通过。

Free Search exposes additional bridged tools. DSH skills do not automatically become Tangu skills. Billion Context needs model traffic from its owning DSH session; merely loading it proves no Tangu compression. ModLens requires a visual provider or explicitly configured CLI credential reuse and is outside this run's verified scope.
