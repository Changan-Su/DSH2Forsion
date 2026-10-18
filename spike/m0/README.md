# M0 spike 仪器

M0 要回答六个可行性问题，结论报告在维护者的内部文档仓里，公开摘要见仓根 [COMPATIBILITY.md](../../COMPATIBILITY.md)。这里放的是能重跑的东西。

| 文件 | 用途 |
|---|---|
| `fetch-runtime.sh` | 装 sidecar 运行时：官方 Node 24（SHASUMS256 校验）＋ 钉死的 `@deepseek-ai/dsh`。安装时不跑脚本，只对 DSH 自己的三个原生依赖跑构建 |
| `run-sidecar.sh` | 起 sidecar：只听 127.0.0.1 随机端口，环境变量走白名单，`DSH_HOME` 隔离 |
| `dsh-bridge/` | 装进 sidecar profile 的最小桥：`/forsion-bridge/{health,tools,tools/execute}`，带密钥校验（DSH 的插件路由默认无鉴权） |
| `fixture-tool/` | 夹具 DSH 插件：一个工具 `fixture_echo`，加一段提示词分节 |
| `tangu-probe/plugin/` | Tangu 引擎插件样例：把 sidecar 里的第三方工具挂成 ToolProvider（`dsh__<name>`，每次都问） |
| `tangu-probe/dsh2forsion.m0.test.ts` | 用 tangu-agent 真加载器验证工具桥，含停用后消失的负对照 |
| `embed/` | Chromium：顶层 vs 跨站 iframe；Electron 40.8：`<webview>` 嵌入（套 Forsion 主窗 CSP） |
| `matrix/` | 前 30 名插件装载矩阵：`run-matrix.sh install` 带网络、不跑安装脚本；`run-matrix.sh probe` 进无网络命名空间、以非 root 用户启动并探测 |

## 重跑

```sh
# 1. 运行时（M0 在 Linux x64 容器里用 /srv/dsh2forsion 作根）
DSH2FORSION_ROOT=/srv/dsh2forsion ./fetch-runtime.sh
# pnpm 11 要装进 Node 目录（DSH 装插件要它）：
PATH=/srv/dsh2forsion/node/<版本>/bin:$PATH npm i -g --prefix /srv/dsh2forsion/node/<版本> pnpm@11

# 2. 起一个带桥和夹具的 sidecar
DSH_HOME=… dsh forsion --from-default-profile web --dump-config      # 建 profile
dsh plugin --profile forsion add --ignore-scripts file:$PWD/dsh-bridge file:$PWD/fixture-tool
DSH2FORSION_SECRET=<≥32 字符> ./run-sidecar.sh <node 目录> <runtime 目录> <DSH_HOME>

# 3. 工具桥（拷进 Genesis 的 tangu-agent/src/plugins/ 后）
DSH2FORSION_BRIDGE=http://127.0.0.1:<port> DSH2FORSION_SECRET=<密钥> \
DSH2FORSION_PLUGIN=$PWD/tangu-probe/plugin npx vitest run src/plugins/dsh2forsion.m0.test.ts

# 4. 嵌入
node embed/embed-test.mjs '<dsh web 打印的 token URL>' <截图目录> <chromium 路径>
xvfb-run -a <electron 40.8> --no-sandbox embed/electron-webview/main.cjs '<token URL>' <截图目录>

# 5. 矩阵（root 跑外壳；第三方代码只在 probe 段、无网络、非 root 下执行）
useradd -m dshm0
./matrix/run-matrix.sh install
CHROMIUM=<chromium 路径> ./matrix/run-matrix.sh probe
```

## 已知限制

- 矩阵的 probe 段在无网络命名空间里跑。Chromium 会因此判自己离线，`navigator.onLine` 已在页面里钉成 true。启动时就要联网的插件，在这里会显示得比真实情况差。
- 「界面零报错」只说明打开首页时没有报错，不说明插件的每个功能都能用。功能级验收在 M1 用矩阵加截图逐个做。
