# 兼容性 / Compatibility

钉死 DSH `0.2.1-rc.2`。数据来自 M0 兼容矩阵（2026-10-18，Linux x64），原始结果在 [`spike/m0/results/2026-10-18/`](spike/m0/results/2026-10-18/)，随包发的评级在 [`compat/known.json`](compat/known.json)。

## 评级口径

| 评级 | 含义 |
|---|---|
| 装载通过 | 装得上、DSH 起得来、它自己的宿主条目和浏览器条目都激活了、首页没有报错 |
| 🟡 部分 | DSH 起得来，但它有条目没激活，功能多半缺一块 |
| 🔴 不行 | 装不上，或者装上以后 DSH 起不来 / DSH 网页打不开 |

**「装载通过」不等于「功能可用」**，只说明插件激活了。功能级验收（逐个点操作）是 M1 的事。

## 功能级验收（Windows，2026-10-31）

在真实 Forsion / Tangu 引擎、DSH `0.2.1-rc.2` 上，用 `codex/gpt-6-luna` 验证下列限定场景。它们不改变上面的装载评级，也不代表这些插件的所有功能都通过。

| 样本 | 已验证范围 |
|---|---|
| `@linxin666/dsh-client-ui-task-board@0.4.7` | 真实模型经 Tangu 创建、读取、修改、查询本地任务；任务标题和修改后的描述在 DSH 看板详情中可见。未运行或调度任务。 |
| `dsh-trae-skin@0.2.0` | 真实界面保存浅色与自定义字标，刷新及整个 Forsion 重启后保留；管理页卸载后效果消失，撤销后恢复插件与原设置。 |
| 本地 `dsh2forsion-live-probe` 夹具 | 批准后按选定工作目录执行；DSH 重启后仍保持目录；拒绝后零执行；取消后停止正在执行的任务。真实桌面聊天中点击批准后仅执行一次，工具结果回显且模型正常结束。通过工作区记录、模型事件和界面双重核对。 |

本轮完整 Windows GUI 为 18/18，真模型为 6/6。内部桥 `0.1.2` 使用 DSH 的 `resumeSessionId` 参数恢复已持久化会话；旧桥的负对照复现了重启后工作目录回落到用户主目录的问题。以上不扩大到其他平台的图形界面或第三方插件全部功能。

可重复执行入口是 `npm run test:live` 和 `npm run test:gui`，前置和完整桌面选项见 [README](README.md#开发--development)。真模型测试会使用已有 Codex 登录并消耗额度。

## 结果

| 样本 | 装载通过 | 🟡 | 🔴 | 要版本豁免 |
|---|---|---|---|---|
| npm 下载量前 30 | 30 | 0 | 0 | 0 |
| 随机 30（种子 20261018） | 23 | 4 | 3 | 6 |

前 30 名偏向活跃、刚更新的包，随机 30 更能代表长尾。

### 🔴 与 🟡

| 插件 | 评级 | 原因 | DSH2Forsion 怎么处理 |
|---|---|---|---|
| `@jhp830901/dsh-memoria-extra@0.1.0` | 🔴 | 把旧版 `@deepseek-ai/dsh-tools` 当普通依赖带进来，盖掉运行时那份，DSH 起不来 | 试启动前的核心包扫描拦下 |
| `relay-dsh-plugin-files@0.2.2` | 🔴 | DSH 起得来，但网页停在「Failed to load plugins」 | 矩阵评级拦下（试启动只看宿主侧，看不出这种） |
| `@liuhange/dsh-data-asset-attestation@3.1.4` | 🔴 | 包里的 YAML 写坏了，装不上 | 安装失败，不动 profile |
| `@guojin-ai/dsh-plugin-guard@0.2.0` | 🟡 | typert 编码不兼容，前端重复注册 | 装前先问 |
| `dsh-discussions-radar@0.1.0` | 🟡 | 自己写死只支持 0.1.0-rc.6，拒绝激活 | 装前先问 |
| `dsh-ui-dafeng-customizer@0.1.3` | 🟡 | `settings.register is not a function`（DSH 改了接口） | 装前先问 |
| `@taontech/dsh-git@0.1.2` | 🟡 | 等一个已经不存在的服务 `conversationViews` | 装前先问 |

### 已验证的版本豁免

这些版本在包里声明不支持 `0.2.1-rc.2`，但豁免后装载通过。装它们时不用再点「承担风险」：

- `@dsh-xhl/dsh-git-gui@0.2.0`
- `@muou000/dsh-memory@0.1.1`
- `dsh-context-mode@0.5.3`

## 装的时候发生什么

1. 在临时 `DSH_HOME` 里 `dsh plugin add --ignore-scripts`。版本声明不符的，矩阵里验证过就自动豁免，否则停下来问你。
2. 扫一遍有没有夹带 `@deepseek-ai/*` 核心包（运行时也有、版本不同才算）。
3. 在临时副本里真起一次 DSH，看日志里有没有条目没激活。
4. 对照矩阵里这个**确切版本**的评级。
5. 判定：夹带核心包、起不来、矩阵记 🔴 → 拦下（可以强制装，不建议）；有条目没激活、矩阵记 🟡 → 先问你；都没有 → 装。
6. 动你的 profile 之前拍快照；装失败自动恢复。

### 已知的盲区

- 矩阵外的插件如果只坏浏览器侧（像 `relay-dsh-plugin-files`），试启动看不出来，装上后 DSH Space 会停在「Failed to load plugins」。这时在 **设置 → DSH2Forsion** 里点「撤销上一次改动」。这种情况下别用「恢复到上次能启动的状态」：DSH 照样能启动，所以「上次能启动的状态」已经包含了这个插件。
- 「撤销上一次改动」恢复的是那次改动之前的整份 profile，包括插件设置。被换下来的那份（含之后在 DSH Space 里改过的设置）存在插件数据目录的 `backups/undone-*`，留最近 5 份。
- 在 DSH Space 自己的插件页里装的插件不经过试启动。
- 矩阵只在 Linux x64 上跑过；macOS 与 Windows 靠 CI 的端到端测试，没有逐个插件跑。
