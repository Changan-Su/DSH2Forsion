// DSH2Forsion M0：Tangu 引擎半身的最小样例。把 sidecar 里第三方插件注册的 DSH 工具
// 挂成 Tangu 的 ToolProvider。M0 里 sidecar 由外部先起好，地址和密钥从环境变量来；
// 正式版由引擎半身自己拉起 sidecar。
const BASE = process.env.DSH2FORSION_BRIDGE ?? ''
const SECRET = process.env.DSH2FORSION_SECRET ?? ''
// DSH 自带、Tangu 有自己的对应物或不该导出的全局工具
const SKIP = new Set(['working_directory'])
let cached = []
let timer

async function bridge(path, init = {}) {
  const res = await fetch(`${BASE}/forsion-bridge${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', 'x-dsh2forsion-secret': SECRET, ...(init.headers ?? {}) },
    signal: init.signal ?? AbortSignal.timeout(30_000),
  })
  if (!res.ok) throw new Error(`bridge ${path} → ${res.status}`)
  return res.json()
}

async function refresh() {
  try {
    const { tools } = await bridge('/tools', { signal: AbortSignal.timeout(5_000) })
    cached = tools.filter(t => !SKIP.has(t.name))
  } catch {
    // sidecar 不在时保留上一份；tools() 绝不能抛（一个 provider 抛错会拖垮所有 run 的工具装配）
  }
}

const tanguName = name => `dsh__${name}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64)

function toTangu(t) {
  const name = tanguName(t.name)
  return {
    name,
    definition: {
      type: 'function',
      function: {
        name,
        description: `${t.description ?? ''}\n(DeepSeek Harness plugin tool, runs in the DSH sidecar outside Tangu's file policy.)`.trim(),
        parameters: t.parameters ?? { type: 'object', properties: {} },
      },
    },
    capabilities: { sideEffect: 'unknown', approval: 'always', automationSafe: false },
    async execute(args) {
      // 能走到这里说明 Tangu 的审批已经放行；带 approved:true，桥只为这一次调用代答 DSH 侧的审批
      const { result } = await bridge('/tools/execute', { method: 'POST', body: JSON.stringify({ name: t.name, arguments: args ?? {}, approved: true }) })
      const text = (result.content ?? []).filter(c => c.type === 'text').map(c => c.text).join('\n')
      if (!result.isError) return text
      // Tangu 以「Error:」开头判失败；DSH 的错误渲染多半已经带了这个前缀，别再叠一层
      const message = text || result.error?.message || 'DSH tool failed'
      return message.startsWith('Error:') ? message : `Error: ${message}`
    },
  }
}

export default {
  async activate(ctx) {
    await refresh()
    timer = setInterval(refresh, 10_000)
    ctx.registerPlugin({
      id: 'dsh2forsion',
      name: 'DSH2Forsion',
      description: 'Run DeepSeek Harness plugin tools inside Tangu (M0 spike)',
      defaultEnabled: true,
      toolProvider: {
        id: 'plugin:dsh2forsion',
        tools: () => cached.map(toTangu),
      },
    })
  },
  deactivate() {
    clearInterval(timer)
    cached = []
  },
}
