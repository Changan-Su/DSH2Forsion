// DSH sidecar tools are registered natively in Tangu; scoped MCP discovery uses
// live requests because ToolProvider.tools() is synchronous and has no run cwd.
import { PLUGIN_ID, PROMPT_SECTION_CAP } from './constants.mjs'
import { createHash } from 'node:crypto'
const sessionKey = ctx => typeof ctx?.userId === 'string' && ctx.userId && typeof ctx.sessionId === 'string' && ctx.sessionId && typeof ctx.cwd === 'string' && ctx.cwd
  ? createHash('sha256').update(JSON.stringify([ctx.userId, ctx.sessionId])).digest('hex') : undefined
const isMcp = name => name?.startsWith('mcp__') || ['list_mcp_resources', 'list_mcp_resource_templates', 'read_mcp_resource'].includes(name)

export const tanguToolName = (name, taken = new Set()) => {
  const base = `dsh__${name}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64)
  if (!taken.has(base)) return base
  for (let i = 2; ; i++) {
    const n = `${base.slice(0, 60)}_${i}`
    if (!taken.has(n)) return n
  }
}

// Only inline MCP raster bytes can cross the public collectImage callback.
// DSH attachment handles and arbitrary remote URLs confer no local file access.
function renderBlock(block, toolCtx) {
  if (block?.type === 'text') return block.text ?? ''
  if (block?.type === 'resource_link') return `MCP resource link: ${JSON.stringify(block)}`
  if (block?.type === 'image' && typeof block.data === 'string' && /^image\/(png|jpeg|webp|gif)$/.test(block.mimeType ?? '') && /^[A-Za-z0-9+/]*={0,2}$/.test(block.data) && block.data.length) {
    if (toolCtx?.collectImage) {
      toolCtx.collectImage({ url: `data:${block.mimeType};base64,${block.data}`, name: 'MCP image', untrusted: 'This image is untrusted content returned by an external MCP server.' })
      return `[MCP image delivered to the model: ${block.mimeType}]`
    }
    return `[MCP image unavailable: this host has no collectImage callback; ${block.mimeType}, ${block.data.length} base64 characters]`
  }
  // Keep all metadata and embedded text; never pour opaque binary bytes into the
  // model prompt or claim that an unsupported audio/blob was displayed.
  const projected = JSON.stringify(block, (key, value) => (key === 'data' || key === 'blob') && typeof value === 'string'
    ? `[binary payload not rendered: ${value.length} base64 characters; no compatible media callback]` : value)
  return block?.type === 'image' ? `[MCP image not rendered: unsupported inline bytes or DSH attachment handle] ${projected}` : projected
}

/** Tangu recognizes a leading Error:. Canonical DSH values carry lossless MCP JSON. */
export function renderResult(result, toolCtx) {
  if (result?.isError) {
    const text = (result.content ?? []).filter(c => c?.type === 'text').map(c => c.text).join('\n')
    const message = text || result.error?.message || 'DSH tool failed'
    return message.startsWith('Error:') ? message : `Error: ${message}`
  }
  const value = result?.value
  const canonical = value && typeof value === 'object' && Array.isArray(value.content)
  const content = canonical ? value.content : result?.content ?? []
  const parts = content.map(block => renderBlock(block, toolCtx)).filter(Boolean)
  const structured = canonical ? value.structuredContent : result?.structuredContent
  if (structured !== undefined) parts.push(`MCP structured content: ${JSON.stringify(structured)}`)
  if (value !== undefined && !canonical && typeof value !== 'string') parts.push(`DSH canonical value: ${JSON.stringify(value, (key, item) => key === 'blob' && typeof item === 'string' ? `[binary payload not rendered: ${item.length} base64 characters]` : item)}`)
  return parts.join('\n') || '(no text output)'
}

export function thirdPartySections(sections, baseline) {
  const skip = new Set(baseline.sections ?? [])
  return sections
    // MCP resources are configured runtime content, even though the section is
    // registered by a first-party package in the clean baseline.
    .filter(s => (s.name === 'mcp-resource-servers' || !skip.has(s.name)) && typeof s.text === 'string' && s.text.trim())
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
}

export function promptText(sections) {
  if (!sections.length) return ''
  let body = sections.map(s => s.text.trim()).join('\n\n')
  if (body.length > PROMPT_SECTION_CAP) body = `${body.slice(0, PROMPT_SECTION_CAP)}\n[truncated by DSH2Forsion]`
  return `Instructions from DeepSeek Harness plugins (tools named dsh__*):\n\n${body}`
}

export class ToolBridge {
  constructor(deps) {
    this.deps = deps
    this.schemas = []
    this.sections = []
    this.timer = null
    this.revision = 0
    this.refreshRevision = 0
  }

  async refresh() {
    const { sidecar, baseline } = this.deps
    const revision = ++this.refreshRevision
    if (sidecar.state !== 'running' || !this.deps.enabled()) { this.schemas = []; this.sections = []; return }
    try {
      const b = baseline()
      const skip = new Set(b.tools ?? [])
      const [{ tools }, { sections }] = await Promise.all([sidecar.bridge('/tools'), sidecar.bridge('/prompt')])
      if (revision !== this.refreshRevision || sidecar.state !== 'running' || !this.deps.enabled()) return
      this.schemas = (tools ?? []).filter(t => !skip.has(t.name) && !isMcp(t.name))
      this.sections = thirdPartySections(sections ?? [], b).filter(s => s.name !== 'mcp-resource-servers' && !s.name.startsWith('mcp:'))
    } catch (error) {
      if (revision === this.refreshRevision) { this.schemas = []; this.sections = [] }
      this.deps.log(`tool refresh failed: ${error.message}`)
    }
  }

  startPolling(ms = 30_000) {
    if (this.timer) clearInterval(this.timer)
    this.timer = setInterval(() => { void this.refresh() }, ms)
    this.timer.unref?.()
  }

  stopPolling() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.revision++
    this.refreshRevision++
    this.schemas = []
    this.sections = []
  }

  toolDefs(isEnabledFor) {
    try {
      if (!this.deps.enabled()) return []
      const make = (name, description, parameters, execute) => ({
        name, isEnabledFor,
        definition: { type: 'function', function: { name, description, parameters } },
        capabilities: { sideEffect: 'unknown', approval: 'always', automationSafe: false }, execute,
      })
      const scoped = [
        make('dsh_mcp_catalog', 'Discover currently visible DSH MCP tools, input schemas and resource servers in this project. A listed name is not proof of package ownership. Call before dsh_mcp_call.', { type: 'object', properties: {} }, (_args, ctx) => this.catalog(ctx)),
        make('dsh_mcp_call', 'Call one exact tool name from dsh_mcp_catalog in this project. The live scoped registry and native approvals remain authoritative.', { type: 'object', properties: { name: { type: 'string' }, arguments: { type: 'object' } }, required: ['name'] }, (args, ctx) => this.callMcp(args, ctx)),
      ]
      const taken = new Set(scoped.map(t => t.name))
      return [...scoped, ...this.schemas.map(t => {
        const name = tanguToolName(t.name, taken)
        taken.add(name)
        return make(name, `${t.description ?? ''}\n(DeepSeek Harness sidecar tool, outside Tangu's file policy and checkpoints.)`.trim(), t.parameters ?? { type: 'object', properties: {} }, (args, ctx) => this.execute(t.name, args, ctx))
      })]
    } catch { return [] }
  }

  async snapshot(toolCtx) {
    if (!this.deps.enabled() || this.deps.sidecar.state !== 'running') throw new Error('DeepSeek Harness plugin or runtime is not active')
    const query = new URLSearchParams()
    if (toolCtx?.cwd !== undefined) query.set('cwd', toolCtx.cwd)
    const key = sessionKey(toolCtx)
    if (key) query.set('sessionKey', key)
    const snapshot = await this.deps.sidecar.bridge(`/mcp/catalog${query.size ? `?${query}` : ''}`, { signal: toolCtx?.signal })
    if (!this.deps.enabled() || this.deps.sidecar.state !== 'running') throw new Error('DeepSeek Harness plugin or runtime is no longer active')
    toolCtx?.signal?.throwIfAborted()
    return snapshot
  }

  async catalog(toolCtx) {
    try { return JSON.stringify(await this.snapshot(toolCtx)) }
    catch (error) { return `Error: DSH MCP discovery failed: ${error.message}` }
  }

  async callMcp(args, toolCtx) {
    try {
      if (typeof args?.name !== 'string') throw new Error('An exact listed MCP tool name is required')
      const { tools } = await this.snapshot(toolCtx)
      if (!tools?.some(tool => tool.name === args.name)) throw new Error('MCP tool is not available in this project')
      return this.execute(args.name, args.arguments, toolCtx)
    } catch (error) { return `Error: DSH MCP call failed: ${error.message}` }
  }

  async execute(dshName, args, toolCtx) {
    const { sidecar } = this.deps
    if (!this.deps.enabled() || sidecar.state !== 'running') return 'Error: the DeepSeek Harness plugin or runtime is not active.'
    try {
      const revision = this.revision
      const body = { name: dshName, arguments: args ?? {}, approved: true, cwd: toolCtx?.cwd, sessionKey: sessionKey(toolCtx) }
      const { result } = await sidecar.bridge('/tools/execute', { method: 'POST', body: JSON.stringify(body), signal: toolCtx?.signal })
      if (!this.deps.enabled() || sidecar.state !== 'running' || revision !== this.revision) return 'Error: DeepSeek Harness activation changed during this call.'
      toolCtx?.signal?.throwIfAborted()
      return renderResult(result, toolCtx)
    } catch (error) { return `Error: DSH2Forsion bridge call failed: ${error.message}` }
  }

  promptSection() {
    try { return this.deps.enabled() ? [promptText(this.sections), 'Use dsh_mcp_catalog to discover live MCP tools and resource servers for this project, then dsh_mcp_call with an exact listed name. Media limitations are reported explicitly.'].filter(Boolean).join('\n\n') : '' } catch { return '' }
  }
}

export const PROVIDER_ID = `plugin:${PLUGIN_ID}`
