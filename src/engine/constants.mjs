// 每个 DSH2Forsion 版本钉死的上游版本。升级流程见 Forsion-Root 方案 §7：跑兼容矩阵 → 改映射 → 发版。
export const DSH_VERSION = '0.2.2-rc.3'
export const NODE_VERSION = 'v24.22.0'
export const PNPM_VERSION = '11.28.6'

// 官方 SHASUMS256.txt 里这一版的哈希，钉进代码：国内镜像连 SHASUMS 一起被篡改也校验得出来。
// 升级 NODE_VERSION 时一起换（https://nodejs.org/dist/<版本>/SHASUMS256.txt）。
export const NODE_SHA256 = {
  'node-v24.22.0-darwin-arm64.tar.gz': '6a9724d9b50a5f22b4816cded441b5a8d9ddae546191a5e5b7efa5a5e2ee26d5',
  'node-v24.22.0-darwin-x64.tar.gz': '495e3f273c645f3c4677d438304cdfc701729ea5dec5728f5c8e76a2dece4b91',
  'node-v24.22.0-linux-arm64.tar.gz': 'b7e7991d5407815adfa74a2a9cd4db683552c8ce32ff4a295c22e972849c3f5d',
  'node-v24.22.0-linux-x64.tar.gz': '28ea0a438de9a13bd7891fd758eee6c7819ee8af5442dfd8d45bd65e56d4228c',
  'node-v24.22.0-win-arm64.zip': '3a5c209a5bc59e65b3bc0fa13ed5e166a26bd3d55332847f498b76b037408d61',
  'node-v24.22.0-win-x64.zip': 'f9683a19877e12a9b167305c8db71040d812876359de21f0d2e97c3f321f80c3',
}

// DSH 自己的原生依赖：装运行时时只给这三个跑构建脚本，其余一律 --ignore-scripts。
export const TRUSTED_NATIVE_PACKAGES = ['koffi', 'node-pty', '@deepseek-ai/dsh-subprocess-local']

// 融合组合（第 1 档）：放在用户自己的 DSH 目录（$DSH_HOME，缺省 ~/.dsh）里、名叫 forsion 的一份组合。
// 同一个进程里既开网页界面（工作台），又开对话入口（ACP，Forsion 的对话连它）。
export const PROFILE = 'forsion'
export const BRIDGE_PACKAGE = 'dsh2forsion-bridge'
export const PLUGIN_ID = 'dsh2forsion'
export const ENGINE_ID = 'dsh'
// 组合目录里这个文件 = 这份组合是本插件建的；没有它而目录已在 → 是用户自己的同名组合，不碰。
export const FUSION_MARKER = '.dsh2forsion-fusion.json'
export const FUSION_BUNDLES = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@deepseek-ai/dsh-acp-app']
// 网页界面那份接线把这些关了、改由「预设」按会话挂；对话入口建的会话不挂预设，所以在全局重新打开（方案目录 resident 实测）。
export const FUSION_REENABLE = ['agent-instructions', 'tool-web', 'tool-todo', 'tool-workflow', 'workflow-ptc', 'command-goal', 'plan-mode', 'command-compact',
  'tool-goal', 'compaction-basic', 'tool-result-pruner', 'skill-filesystem', 'tool-skill', 'tool-subagent-control', 'tool-subagent', 'tool-subagent-fork',
  'tool-bash', 'tool-jobs', 'tool-fs', 'tool-fs-search']

export const NODE_MIRRORS = {
  official: 'https://nodejs.org/dist',
  mirror: 'https://npmmirror.com/mirrors/node',
}
export const NPM_REGISTRIES = {
  official: 'https://registry.npmjs.org/',
  mirror: 'https://registry.npmmirror.com/',
}

export const READY_TIMEOUT_MS = 90_000
export const PROMPT_SECTION_CAP = 4000
