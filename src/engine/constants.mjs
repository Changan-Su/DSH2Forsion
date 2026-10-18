// 每个 DSH2Forsion 版本钉死的上游版本。升级流程见 Forsion-Root 方案 §7：跑兼容矩阵 → 改映射 → 发版。
export const DSH_VERSION = '0.2.1-rc.2'
export const NODE_VERSION = 'v24.22.0'
export const PNPM_VERSION = '11.28.6'

// DSH 自己的原生依赖：装运行时时只给这三个跑构建脚本，其余一律 --ignore-scripts。
export const TRUSTED_NATIVE_PACKAGES = ['koffi', 'node-pty', '@deepseek-ai/dsh-subprocess-local']

export const PROFILE = 'forsion'
export const BRIDGE_PACKAGE = 'dsh2forsion-bridge'
export const PLUGIN_ID = 'dsh2forsion'

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
