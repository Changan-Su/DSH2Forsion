// 把 sidecar 里第三方 DSH 插件注册的工具与提示词分节挂进 Tangu。
// 内置的那部分按随版本发的基线名单剔除（compat/baseline-<DSH 版本>.json，由 tests/gen-baseline.mjs 从干净 profile 生成）。
import { PLUGIN_ID, PROMPT_SECTION_CAP } from './constants.mjs'

export const tanguToolName = (name, taken = new Set()) => {
  const base = `dsh__${name}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64)
  if (!taken.has(base)) return base
  for (let i = 2; ; i++) {
    const n = `${base.slice(0, 60)}_${i}`
    if (!taken.has(n)) return n
  }
}

/** Tangu 以「Error:」开头判失败；DSH 的错误渲染多半已经带了这个前缀，别再叠一层。 */
export function renderResult(result) {
  const text = (result?.content ?? []).filter(c => c?.type === 'text').map(c => c.text).join('\n')
  if (!result?.isError) return text || '(no text output)'
  const message = text || result?.error?.message || 'DSH tool failed'
  return message.startsWith('Error:') ? message : `Error: ${message}`
}

export function thirdPartySections(sections, baseline) {
  const skip = new Set(baseline.sections ?? [])
  return sections
    .filter(s => !skip.has(s.name) && typeof s.text === 'string' && s.text.trim())
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
}

export function promptText(sections) {
  if (!sections.length) return ''
  let body = sections.map(s => s.text.trim()).join('\n\n')
  if (body.length > PROMPT_SECTION_CAP) body = `${body.slice(0, PROMPT_SECTION_CAP)}\n[truncated by DSH2Forsion]`
  return `Instructions from DeepSeek Harness plugins (tools named dsh__*):\n\n${body}`
}

export class ToolBridge {
  /** @param {{ sidecar: import('./sidecar.mjs').Sidecar, baseline: () => any, enabled: () => boolean, log: (l: string) => void }} deps */
  constructor(deps) {
    this.deps = deps
    this.schemas = []
    this.sections = []
    this.timer = null
  }

  async refresh() {
    const { sidecar, baseline } = this.deps
    if (sidecar.state !== 'running') { this.schemas = []; this.sections = []; return }
    try {
      const b = baseline()
      const skip = new Set(b.tools ?? [])
      const { tools } = await sidecar.bridge('/tools')
      this.schemas = (tools ?? []).filter(t => !skip.has(t.name))
      const { sections } = await sidecar.bridge('/prompt')
      this.sections = thirdPartySections(sections ?? [], b)
    } catch (error) {
      this.deps.log(`tool refresh failed: ${error.message}`)
    }
  }

  startPolling(ms = 30_000) {
    this.stopPolling()
    this.timer = setInterval(() => { void this.refresh() }, ms)
    this.timer.unref?.()
  }

  stopPolling() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  /** ToolProvider.tools()：绝不能抛（一个 provider 抛错会拖垮所有 run 的工具装配）。 */
  toolDefs(isEnabledFor) {
    try {
      if (!this.deps.enabled()) return []
      const taken = new Set()
      return this.schemas.map(t => {
        const name = tanguToolName(t.name, taken)
        taken.add(name)
        return {
          name,
          isEnabledFor,
          definition: {
            type: 'function',
            function: {
              name,
              description: `${t.description ?? ''}\n(DeepSeek Harness plugin tool. It runs in the DSH sidecar, outside Tangu's file policy and checkpoints.)`.trim(),
              parameters: t.parameters ?? { type: 'object', properties: {} },
            },
          },
          capabilities: { sideEffect: 'unknown', approval: 'always', automationSafe: false },
          execute: (args, toolCtx) => this.execute(t.name, args, toolCtx),
        }
      })
    } catch {
      return []
    }
  }

  async execute(dshName, args, toolCtx) {
    const { sidecar } = this.deps
    if (sidecar.state !== 'running') return 'Error: the DeepSeek Harness runtime is not running. Open the DSH Space in Forsion to start it.'
    try {
      // 走到这里说明 Tangu 的审批已经放行；approved:true 让桥只为这一次调用代答 DSH 侧的审批
      const body = { name: dshName, arguments: args ?? {}, approved: true, cwd: toolCtx?.cwd }
      const { result } = await sidecar.bridge('/tools/execute', { method: 'POST', body: JSON.stringify(body), signal: toolCtx?.signal })
      return renderResult(result)
    } catch (error) {
      return `Error: DSH2Forsion bridge call failed: ${error.message}`
    }
  }

  promptSection() {
    try { return this.deps.enabled() ? promptText(this.sections) : '' } catch { return '' }
  }
}

export const PROVIDER_ID = `plugin:${PLUGIN_ID}`
