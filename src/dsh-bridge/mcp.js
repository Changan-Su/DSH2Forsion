// Public DSH registry projection. This module owns no MCP transport and never
// infers package ownership from a tool name; the official registry exposes no
// registration-owner metadata. Namespace attribution is declared identity only.
const RESOURCE_TOOLS = new Set(['list_mcp_resources', 'list_mcp_resource_templates', 'read_mcp_resource'])
export const isMcpToolName = name => typeof name === 'string' && (name.startsWith('mcp__') || RESOURCE_TOOLS.has(name))

export async function mcpSnapshot(ctx, { agent, signal } = {}) {
  signal?.throwIfAborted()
  let changed = false
  const offTools = ctx.on('tools/change', () => { changed = true })
  const offPrompt = ctx.on('system-prompt/change', () => { changed = true })
  try {
    const schemas = ctx.tools.schemas(agent)
    const assembly = await ctx.systemPrompt.assemble({ ...(agent ? { scope: agent } : {}), signal })
    signal?.throwIfAborted()
    if (changed) throw new Error('DSH MCP inventory changed during discovery; retry the catalog request')
    // Re-read after asynchronous assembly: an unloaded connection must not leave
    // stale tools in the returned inventory. Dispatch also resolves live scope.
    const live = new Map(ctx.tools.schemas(agent).map(tool => [tool.name, tool]))
    const tools = schemas.filter(tool => isMcpToolName(tool.name) && live.has(tool.name)).map(tool => ({
      ...live.get(tool.name),
      source: { kind: 'dsh-tool-registry', declaredToolName: tool.name, ownership: 'unknown' },
    }))
    const sections = (assembly.sections ?? []).filter(section => (section.name === 'mcp-resource-servers' || section.name.startsWith('mcp:')) && typeof section.text === 'string' && section.text.trim())
    return { tools, sections, scope: agent ? 'agent' : 'global' }
  } finally { offTools(); offPrompt() }
}
