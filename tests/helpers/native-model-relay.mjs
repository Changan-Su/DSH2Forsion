// Original local fixture: official DSH OpenAI-compatible provider -> native
// Tangu Codex single-inference transport. No agent loop runs in this relay.
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'
// Also reusable INSIDE a DSH fixture provider. Its upstream request uses global
// fetch in that process, so a context extension can observe the real official
// endpoint rather than a loopback relay. The caller owns scope and call limits.
export function createNativeCodexInference({ agentDir, authFile }) {
  let transport
  const load = async () => {
    if (transport) return transport
    // The official refresh helper reads/writes the user's existing credential
    // location under its usual lock. No copy/link enters the evidence directory.
    process.env.TANGU_HOME = dirname(authFile)
    const [{ streamOpenAiResponses }, { freshOAuthCred }, { ACCOUNT_MARK }] = await Promise.all([
      'llm/openaiResponses.js', 'llm/providerOAuth.js', 'llm/openaiCompat.js',
    ].map(file => import(pathToFileURL(join(agentDir, 'dist', file)).href)))
    transport = { streamOpenAiResponses, freshOAuthCred, ACCOUNT_MARK }
    return transport
  }
  return async ({ payload, signal, onToken, onReasoning, onToolCallDelta }) => {
    if (payload?.model !== 'gpt-6-luna') throw new Error('Only gpt-6-luna is authorized in this fixture')
    JSON.parse(await readFile(authFile, 'utf8'))
    const api = await load(), creds = await api.freshOAuthCred('codex')
    if (!creds?.access_token || !creds.account_id) throw new Error('An existing Codex subscription sign-in is required')
    return api.streamOpenAiResponses({ apiKey: creds.access_token, baseUrl: 'https://chatgpt.com/backend-api/codex',
      payload: { ...payload, [api.ACCOUNT_MARK]: creds.account_id, reasoning_effort: 'low' }, signal,
      onToken, onReasoning, onToolCallDelta,
    })
  }
}
export async function startNativeModelRelay({ agentDir, authFile, maxLiveCalls = 2 }) {
  const records = []
  let liveCalls = 0
  const infer = createNativeCodexInference({ agentDir, authFile })
  const server = createServer(async (req, res) => {
    if (req.url === '/v1/models') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ data: [{ id: 'gpt-6-luna', object: 'model' }] })); return }
    if (req.method !== 'POST' || req.url !== '/v1/chat/completions') { res.writeHead(404); res.end(); return }
    const controller = new AbortController()
    res.once('close', () => { if (!res.writableEnded) controller.abort(new Error('Relay client disconnected')) })
    try {
      let raw = ''; for await (const part of req) raw += part
      if (raw.length > 8 * 1024 * 1024) throw new Error('Fixture request exceeds 8 MiB')
      const payload = JSON.parse(raw)
      if (payload.model !== 'gpt-6-luna') throw new Error('Only gpt-6-luna is authorized in this fixture')
      const bodyText = JSON.stringify(payload.messages)
      const deterministic = bodyText.includes('MODEL_PROTOCOL_')
      const row = { id: randomUUID(), mode: deterministic ? 'protocol-fixture' : 'real-luna', startedAt: new Date().toISOString(), toolNames: (payload.tools ?? []).map(tool => tool.function?.name), settled: false }
      records.push(row)
      if (bodyText.includes('MODEL_PROTOCOL_CANCEL')) {
        row.waiting = true
        await new Promise(resolve => { controller.signal.addEventListener('abort', resolve, { once: true }); if (controller.signal.aborted) resolve() })
        row.cancelled = true; row.settled = true; return
      }
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' })
      const send = (delta, finish = null, usage) => res.write(`data: ${JSON.stringify({ id: row.id, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: 'gpt-6-luna', choices: [{ index: 0, delta, finish_reason: finish }], ...(usage ? { usage } : {}) })}\n\n`)
      let result
      if (deterministic) result = { content: 'MODEL_PROTOCOL_OK', toolCalls: [], usage: { prompt_tokens: 13, completion_tokens: 3 } }
      else {
        if (++liveCalls > maxLiveCalls) throw new Error('The two-call real-model quota has been exhausted')
        result = await infer({ payload, signal: controller.signal,
          onToken: text => send({ content: text }), onReasoning: text => send({ reasoning_content: text }),
        })
      }
      if (deterministic && result.content) send({ content: result.content })
      if (result.toolCalls?.length) send({ tool_calls: result.toolCalls.map((call, index) => ({ index, ...call })) })
      const usage = { ...result.usage, total_tokens: result.usage.prompt_tokens + result.usage.completion_tokens,
        ...(result.usage.cached_tokens === undefined ? {} : { prompt_tokens_details: { cached_tokens: result.usage.cached_tokens } }),
        ...(result.usage.reasoning_tokens === undefined ? {} : { completion_tokens_details: { reasoning_tokens: result.usage.reasoning_tokens } }),
      }
      send({}, result.toolCalls?.length ? 'tool_calls' : 'stop', usage)
      res.end('data: [DONE]\n\n')
      row.usage = result.usage; row.toolCalls = result.toolCalls?.map(call => ({ name: call.function.name })) ?? []; row.settled = true
    } catch (error) {
      // Avoid relaying provider error text, which can contain account diagnostics.
      if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: { message: 'Original local model fixture failed; inspect non-secret test assertions' } }))
      const last = records.at(-1); if (last) { last.failed = true; last.cancelled = controller.signal.aborted; last.settled = true }
    }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  return { url: `http://127.0.0.1:${server.address().port}/v1`, records, get liveCalls() { return liveCalls },
    close: async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) } }
}
