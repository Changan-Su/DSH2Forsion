// 本机假模型(只听 127.0.0.1,不连外部):DSH 0.2.2 走 Anthropic Messages(/v1/messages)。按用户那句话里的口令出剧本:
//   「WRITE <文件名>」  → write 往工作区外写(沙箱拒)→ 带提权再写一次(DSH 要问审批)→ 按结果回 WROTE / NOT-WRITTEN
//   「SKILL <名字>」    → create_skill(skills-manager 在 tools/pre-execute 里要问审批)→ 回 SKILL-DONE
//   其余回 OK。
import http from 'node:http'
import { join } from 'node:path'

export async function startStubModel({ outside }) {
  const calls = new Map() // tool_use id → { kind, name, step }
  const transcript = [] // 每次带工具的请求:模型看见的工具名里有没有 create_skill、回了什么
  let n = 0
  const textOf = c => typeof c === 'string' ? c : (c ?? []).map(b => b.text ?? (typeof b.content === 'string' ? b.content : Array.isArray(b.content) ? b.content.map(x => x.text ?? '').join(' ') : '')).join(' ')
  const brain = body => {
    const msgs = body?.messages ?? []
    const last = msgs[msgs.length - 1] ?? {}
    const results = Array.isArray(last.content) ? last.content.filter(b => b.type === 'tool_result') : []
    // 被取消的上一轮的工具结果会和新的一句并在同一条 user 消息里:新口令优先
    const said = typeof last.content === 'string' ? last.content : (last.content ?? []).filter(b => b.type === 'text').map(b => b.text).join(' ')
    if (results.length && !/(WRITE|SKILL) \S+/.test(said)) {
      const r = results[results.length - 1]
      const call = calls.get(r.tool_use_id)
      const out = textOf([r])
      if (call?.kind === 'write' && call.step === 1) return tool('write', { file_path: join(outside, call.name), content: call.name, sandbox_permissions: 'danger-full-access', justification: 'test: retry the exact write the sandbox denied' }, { kind: 'write', name: call.name, step: 2 })
      if (call?.kind === 'write') return { text: `${r.is_error ? 'NOT-WRITTEN' : 'WROTE'} ${call.name}: ${out.slice(0, 120)}` }
      if (call?.kind === 'skill') return { text: `SKILL-DONE ${call.name}: ${out.slice(0, 120)}` }
      return { text: 'OK' }
    }
    let m
    if ((m = said.match(/WRITE (\S+)/))) return tool('write', { file_path: join(outside, m[1]), content: m[1] }, { kind: 'write', name: m[1], step: 1 })
    if ((m = said.match(/SKILL (\S+)/))) return tool('create_skill', { name: m[1], description: `Test skill ${m[1]}`, body: `# ${m[1]}\nA test skill.` }, { kind: 'skill', name: m[1] })
    return { text: 'OK' }
  }
  const tool = (name, input, meta) => { const id = `toolu_stub_${++n}`; calls.set(id, meta); return { tool: { id, name, input } } }
  const server = http.createServer((req, res) => {
    let raw = ''
    req.on('data', d => { raw += d })
    req.on('end', () => {
      let body = null
      try { body = raw ? JSON.parse(raw) : null } catch { body = null }
      const p = (req.url ?? '').split('?')[0]
      const json = o => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)) }
      if (req.method === 'GET' && /\/models$/.test(p)) return json({ object: 'list', data: [{ id: 'deepseek-chat', object: 'model' }] })
      if (req.method === 'POST' && /\/messages\/count_tokens$/.test(p)) return json({ input_tokens: 10 })
      if (!(req.method === 'POST' && /\/messages$/.test(p))) { res.writeHead(404, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ error: { message: `stub: no such route ${p}` } })) }
      const withTools = Array.isArray(body?.tools) && body.tools.length > 0
      const step = withTools ? brain(body) : { text: 'title' }
      if (withTools) transcript.push({ tools: body.tools.map(t => t.name), reply: step.tool ? `tool ${step.tool.name}` : step.text })
      const msg = { id: `msg_${Date.now()}`, type: 'message', role: 'assistant', model: body?.model ?? 'stub', stop_reason: null, stop_sequence: null }
      const blocks = step.tool ? [{ type: 'tool_use', id: step.tool.id, name: step.tool.name, input: step.tool.input }] : [{ type: 'text', text: step.text }]
      const stop = step.tool ? 'tool_use' : 'end_turn'
      if (!body?.stream) return json({ ...msg, content: blocks, stop_reason: stop, usage: { input_tokens: 10, output_tokens: 5 } })
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
      const ev = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`)
      ev('message_start', { message: { ...msg, content: [], usage: { input_tokens: 10, output_tokens: 0 } } })
      if (step.tool) {
        ev('content_block_start', { index: 0, content_block: { type: 'tool_use', id: step.tool.id, name: step.tool.name, input: {} } })
        ev('content_block_delta', { index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(step.tool.input) } })
      } else {
        ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } })
        ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text: step.text } })
      }
      ev('content_block_stop', { index: 0 })
      ev('message_delta', { delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 5 } })
      ev('message_stop', {})
      res.end()
    })
  })
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  return { transcript, url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(r => server.close(() => r())) }
}
