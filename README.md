# DSH2Forsion

Run DeepSeek Harness (DSH) plugins inside [Forsion](https://github.com/Changan-Su/Forsion). Compatible with DeepSeek Harness plugins; not affiliated with or endorsed by DeepSeek.

让 DeepSeek Harness 插件在 Forsion 上运行的兼容插件。做法是 Connector 式：Forsion 里跑一份真的 DSH 运行时（sidecar 子进程），DSH 插件原样装进去，只在边界上做适配：
- 宿主半身留在 sidecar 里；
- 工具、提示词、技能等能力导进 Tangu；
- 界面半身进 DSH Space（整幅嵌入 DSH Web 客户端）。

## 状态

方案已拍板（2026-10-18），现处于 **M0 spike**，还没有可安装的 Forsion 插件。

- 方案正典：Forsion-Root `docs/ToBeImproved/DSH2Forsion兼容层方案_2026-10-18.md`
- M0 报告：Forsion-Root `docs/ToBeImproved/DSH2Forsion-M0报告_2026-10-18.md`
- M0 仪器：[`spike/m0/`](spike/m0/README.md)

## 许可

MIT（待首次发布前确认）。不打包 DSH 运行时与任何第三方插件：运行时在用户确认后下载，插件由用户自己安装。
