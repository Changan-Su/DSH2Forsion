// Set DSH2FORSION_MCP_RUNTIME to installed runtime/0.2.1-rc.2 (contains node_modules).
// Uses the shipped official MCP client against our own original stdio fixture.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { mcpSnapshot } from '../src/dsh-bridge/mcp.js'
import { ToolBridge, renderResult, thirdPartySections } from '../src/engine/tools.mjs'
const runtime = process.env.DSH2FORSION_MCP_RUNTIME
assert.ok(runtime, 'Set DSH2FORSION_MCP_RUNTIME to the installed official DSH runtime directory')
const require = createRequire(join(resolve(runtime), 'package.json'))
const load = name => import(pathToFileURL(require.resolve(`@deepseek-ai/${name}`)).href)
const [{ Context }, { default: SystemPrompt }, { default: Tools }, { default: Resources }, mcp, { createScope }] = await Promise.all(['cordis', 'dsh-system-prompt', 'dsh-tools', 'dsh-mcp-resources', 'dsh-mcp-client', 'dsh-scope'].map(load))
const ctx = new Context()
const fibers = []
const scopes = []
try {
  for (const service of [SystemPrompt, Tools, Resources]) fibers.push(await ctx.plugin(service))
  const a = {}, b = {}
  const sa = createScope(ctx, a), sb = createScope(ctx, b)
  scopes.push(sa, sb)
  const fixture = fileURLToPath(new URL('./fixtures/mcp-stdio.mjs', import.meta.url))
  const config = label => ({ serverName: 'local', transport: 'stdio', command: process.execPath, args: [fixture, label], failOnStartupError: true, reconnect: { enabled: false } })
  const ca = await sa.ctx.plugin(mcp, config('A'))
  const cb = await sb.ctx.plugin(mcp, config('B'))
  assert.equal((await mcpSnapshot(ctx)).tools.length, 0, 'global catalog does not leak scoped MCP tools')
  const snapA = await mcpSnapshot(ctx, { agent: a })
  const snapB = await mcpSnapshot(ctx, { agent: b })
  assert.ok(snapA.tools.some(tool => tool.name === 'mcp__local__echo'))
  assert.ok(snapA.tools.some(tool => tool.name === 'read_mcp_resource'))
  assert.ok(snapA.tools.every(tool => tool.source.ownership === 'unknown'), 'name never claims verified package ownership')
  assert.match(snapA.sections.map(s => s.text).join('\n'), /local/)
  assert.ok(thirdPartySections(snapA.sections, { sections: ['mcp-resource-servers'] }).some(s => s.name === 'mcp-resource-servers'), 'resource server discovery survives baseline filtering')
  assert.match(snapA.sections.map(s => s.text).join('\n'), /Fixture A:/)
  assert.match(snapB.sections.map(s => s.text).join('\n'), /Fixture B:/)
  let call = 0
  const execute = (agent, name, args = {}) => ctx.tools.execute({ callId: `fixture-${++call}`, name, arguments: args, agent, signal: new AbortController().signal })
  const ra = await execute(a, 'mcp__local__echo')
  const rb = await execute(b, 'mcp__local__echo')
  assert.equal(ra.isError, false, JSON.stringify(ra))
  assert.equal(rb.isError, false, JSON.stringify(rb))
  assert.equal(ra.value.structuredContent.workspace, 'A')
  assert.equal(rb.value.structuredContent.workspace, 'B')
  const rendered = renderResult(ra)
  assert.match(rendered, /fixture:\/\/A\/document/)
  assert.match(rendered, /"marker":42/)
  const resources = await execute(a, 'list_mcp_resources', { server: 'local' })
  assert.match(renderResult(resources), /fixture:\/\/A\/document/)
  const read = await execute(b, 'read_mcp_resource', { server: 'local', uri: 'fixture://B/document' })
  assert.match(renderResult(read), /Resource B/)
  let assembled, releaseAssembly
  const assemblyReady = new Promise(resolve => { assembled = resolve })
  const assemblyGate = new Promise(resolve => { releaseAssembly = resolve })
  const pausedCtx = {
    tools: ctx.tools, on: (...args) => ctx.on(...args),
    systemPrompt: { assemble: async options => {
      const value = await ctx.systemPrompt.assemble(options)
      assembled(); await assemblyGate; return value
    } },
  }
  const pausedCatalog = mcpSnapshot(pausedCtx, { agent: a })
  await assemblyReady
  await ca.dispose()
  releaseAssembly()
  await assert.rejects(pausedCatalog, /inventory changed/, 'disable during asynchronous assembly cannot return stale tools or instructions')
  assert.equal((await mcpSnapshot(ctx, { agent: a })).tools.length, 0, 'disable removes live tools without polling')
  assert.equal((await mcpSnapshot(ctx, { agent: a })).sections.length, 0, 'disable removes resource discovery')
  assert.equal((await execute(a, 'mcp__local__echo')).isError, true, 'stale name cannot execute after disposal')
  assert.ok((await mcpSnapshot(ctx, { agent: b })).tools.length, 'other workspace remains active')
  await cb.dispose()

  let enabled = true
  const requests = []
  const sidecar = { state: 'running', bridge: async path => {
    requests.push(path)
    if (path.startsWith('/mcp/catalog')) return { tools: [{ name: 'mcp__local__echo' }], sections: [] }
    if (path === '/tools/execute') return { result: ra }
    throw new Error('Unexpected bridge request')
  } }
  const bridge = new ToolBridge({ sidecar, enabled: () => enabled, baseline: () => ({}), log() {} })
  assert.ok(bridge.toolDefs().every(tool => tool.capabilities.approval === 'always'))
  assert.match(await bridge.callMcp({ name: 'mcp__local__echo' }, { cwd: resolve('A') }), /"workspace":"A"/)
  assert.equal(requests[0], `/mcp/catalog?cwd=${encodeURIComponent(resolve('A'))}`)
  assert.match(await bridge.callMcp({ name: 'not-listed' }, {}), /^Error:/)
  enabled = false
  assert.deepEqual(bridge.toolDefs(), [])
  assert.match(await bridge.callMcp({ name: 'mcp__local__echo' }, {}), /^Error:/)
  assert.match(await bridge.execute('mcp__local__echo', {}), /^Error:/)
  // No polling snapshot can reinstate an unloaded activation or stale MCP
  // wrappers. Only the per-call live catalog owns MCP discovery.
  enabled = true
  sidecar.bridge = async path => path === '/tools'
    ? { tools: [{ name: 'mcp__local__echo' }, { name: 'plugin_echo' }] }
    : { sections: [{ name: 'mcp-resource-servers', text: 'old-server' }, { name: 'mcp:local', text: 'old-instructions' }] }
  await bridge.refresh()
  assert.deepEqual(bridge.schemas.map(tool => tool.name), ['plugin_echo'])
  assert.doesNotMatch(bridge.promptSection(), /old-server|old-instructions/)
  bridge.startPolling(60_000)
  assert.deepEqual(bridge.schemas.map(tool => tool.name), ['plugin_echo'], 'starting polling preserves the initial refreshed catalog')
  bridge.stopPolling()
  let release
  const gate = new Promise(resolve => { release = resolve })
  sidecar.bridge = async path => { await gate; return path === '/tools' ? { tools: [{ name: 'late' }] } : { sections: [] } }
  const refreshing = bridge.refresh()
  enabled = false
  release()
  await refreshing
  assert.deepEqual(bridge.schemas, [], 'late source response cannot restore tools after disable')
  const images = []
  assert.match(renderResult({ isError: false, value: { content: [{ type: 'image', mimeType: 'image/png', data: 'aGVsbG8=' }], structuredContent: { yes: true } } }, { collectImage: image => images.push(image) }), /delivered/)
  assert.equal(images.length, 1)
  assert.match(images[0].untrusted, /untrusted/)
  assert.match(renderResult({ isError: false, content: [{ type: 'audio', mimeType: 'audio/wav', data: 'AAAA' }] }), /not rendered/)
  assert.match(renderResult({ isError: false, content: [{ type: 'image', mimeType: 'image/png', data: 'AAAA' }] }), /no collectImage/)
  assert.match(renderResult({ isError: false, content: [{ type: 'resource', resource: { uri: 'fixture://binary', blob: 'AAAA' } }] }), /binary payload not rendered/)
  console.log('check-mcp: official MCP stdio client, isolated scopes, live disable, structured/resource values, native media callback and explicit unsupported media passed')
} finally {
  for (const scope of scopes.reverse()) await scope.dispose()
  for (const fiber of fibers.reverse()) await fiber.dispose()
}
