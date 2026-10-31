# Changelog

## Unreleased

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
