// Minimal original stdio MCP fixture: no SDK/server package or network access.
import { createInterface } from 'node:readline'
const label = process.argv[2] || 'fixture'
const lines = createInterface({ input: process.stdin })
for await (const line of lines) {
  const req = JSON.parse(line)
  if (req.id === undefined) continue
  let result
  switch (req.method) {
    case 'initialize': result = { protocolVersion: req.params.protocolVersion, capabilities: { tools: {}, resources: {} }, serverInfo: { name: 'original-local-fixture', version: '1.0.0' }, instructions: `Fixture ${label}: resources belong only to this scope.` }; break
    case 'ping': result = {}; break
    case 'tools/list': result = { tools: [{ name: 'echo', description: `Echo for ${label}`, inputSchema: { type: 'object', properties: {} } }] }; break
    case 'tools/call': result = { content: [{ type: 'text', text: label }, { type: 'resource_link', name: `${label}.txt`, uri: `fixture://${label}/document`, mimeType: 'text/plain' }], structuredContent: { workspace: label, marker: 42 } }; break
    case 'resources/list': result = { resources: [{ uri: `fixture://${label}/document`, name: `${label}.txt`, mimeType: 'text/plain' }] }; break
    case 'resources/templates/list': result = { resourceTemplates: [{ uriTemplate: `fixture://${label}/{name}`, name: label }] }; break
    case 'resources/read': result = { contents: [{ uri: req.params.uri, mimeType: 'text/plain', text: `Resource ${label}` }] }; break
    default: process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: req.id, error: { code: -32601, message: 'Unknown fixture method' } }) + '\n'); continue
  }
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: req.id, result }) + '\n')
}
