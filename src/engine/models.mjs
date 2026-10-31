// PluginModelProvider: one DSH inference, with the Tangu loop owning all tools.
import { createHash } from 'node:crypto'
function counter(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`DSH returned invalid ${label} token usage`)
  return value
}
export function modelUsage(usage) {
  if (!usage) throw new Error('DSH model returned no authoritative token usage')
  const cached = usage.cacheReadTokens === undefined ? undefined : counter(usage.cacheReadTokens, 'cached')
  const written = usage.cacheWriteTokens === undefined ? undefined : counter(usage.cacheWriteTokens, 'cache write')
  return { prompt_tokens: counter(counter(usage.inputTokens, 'input') + (cached ?? 0) + (written ?? 0), 'aggregate prompt'), completion_tokens: counter(usage.outputTokens, 'output'),
    ...(cached === undefined ? {} : { cached_tokens: cached }), ...(written === undefined ? {} : { cache_write_tokens: written }),
    ...(usage.reasoningTokens === undefined ? {} : { reasoning_tokens: counter(usage.reasoningTokens, 'reasoning') }),
  }
}
export function createModelProvider({ sidecar, enabled = () => true, fetchImpl = fetch }) {
  const check = () => { if (!enabled() || sidecar.state !== 'running' || !sidecar.base) throw new Error('DSH model source is not running') }
  return {
    id: 'dsh',
    async listModels({ signal }) { check(); const value = await sidecar.bridge('/models', { signal }); check(); return value.models },
    async resolveModel(modelId, { signal }) { check(); const value = await sidecar.bridge('/models/resolve', { method: 'POST', body: JSON.stringify({ modelId }), signal }); check(); return value.model },
    async stream(input) {
      check(); input.signal.throwIfAborted()
      // cacheKey is normally the raw native session ID. DSH exposes no public
      // equivalent on GenerateOptions; never leak that identity as an unused hint.
      const { signal, onToken, onReasoning, onToolCallDelta, onResponseStart, context, cacheKey, ...wire } = input
      if (typeof context?.sessionId === 'string' && context.sessionId && typeof context.userId === 'string' && context.userId) {
        wire.sessionKey = createHash('sha256').update(JSON.stringify([context.userId, context.sessionId])).digest('hex')
        wire.cwd = typeof context.cwd === 'string' ? context.cwd : null
      }
      const response = await fetchImpl(`${sidecar.base}/forsion-bridge/models/stream`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-dsh2forsion-secret': sidecar.secret }, body: JSON.stringify(wire), signal })
      if (!response.ok || !response.body) throw new Error(`DSH model transport failed (${response.status})`)
      onResponseStart?.()
      const blocks = new Map()
      let usage, finish, buffer = ''
      const blockAt = (index, type) => { if (!blocks.has(index)) blocks.set(index, { type, text: '' }); return blocks.get(index) }
      const consume = event => {
        if (event.type === 'error') throw new Error(event.error || 'DSH model inference failed')
        if (event.type !== 'chunk' || !event.chunk) throw new Error('Invalid DSH model stream frame')
        const chunk = event.chunk
        if (finish) throw new Error('DSH model sent data after its terminal chunk')
        if (chunk.type === 'block-start') blockAt(chunk.index, chunk.blockType)
        else if (chunk.type === 'text-delta' || chunk.type === 'reasoning-delta') {
          const type = chunk.type === 'text-delta' ? 'text' : 'reasoning'
          if (typeof chunk.text !== 'string') throw new Error('Invalid DSH text delta')
          blockAt(chunk.index, type).text += chunk.text
          if (type === 'text') onToken?.(chunk.text); else onReasoning?.(chunk.text)
        } else if (chunk.type === 'tool-call-delta') {
          if (typeof chunk.argumentsDelta !== 'string') throw new Error('Invalid DSH tool-call delta')
          const block = blockAt(chunk.index, 'tool-call')
          block.id = chunk.id || block.id; block.name = chunk.name || block.name; block.arguments = (block.arguments || '') + chunk.argumentsDelta
          onToolCallDelta?.({ id: block.id || '', name: block.name || '', args: block.arguments, argsDelta: chunk.argumentsDelta, argsLen: block.arguments.length })
        } else if (chunk.type === 'block-end') {
          if (!chunk.block || !['text', 'reasoning', 'tool-call'].includes(chunk.block.type)) throw new Error('DSH returned an unsupported model content block')
          blocks.set(chunk.index, { ...chunk.block })
        } else if (chunk.type === 'usage') usage = modelUsage(chunk.usage)
        else if (chunk.type === 'finish') {
          if (!['stop', 'tool-calls', 'max-tokens'].includes(chunk.reason?.kind)) throw new Error('DSH inference did not finish successfully')
          if (!usage) throw new Error('DSH inference is missing authoritative token usage')
          finish = chunk.reason.kind
        } else throw new Error('Unknown DSH model chunk')
      }
      const decoder = new TextDecoder()
      for await (const part of response.body) {
        check(); signal.throwIfAborted()
        buffer += decoder.decode(part, { stream: true })
        if (buffer.length > 8 * 1024 * 1024) throw new Error('DSH model frame is too large')
        let end
        while ((end = buffer.indexOf('\n')) >= 0) { const line = buffer.slice(0, end); buffer = buffer.slice(end + 1); if (line.trim()) consume(JSON.parse(line)) }
      }
      buffer += decoder.decode()
      if (buffer.trim()) consume(JSON.parse(buffer))
      check(); signal.throwIfAborted()
      if (!finish || !usage) throw new Error('DSH model stream ended before its complete result')
      const ordered = [...blocks.values()]
      const toolCalls = ordered.filter(b => b.type === 'tool-call').map(b => {
        if (!b.id || !b.name || typeof b.arguments !== 'string') throw new Error('DSH returned an incomplete tool call')
        return { id: b.id, type: 'function', function: { name: b.name, arguments: b.arguments } }
      })
      if (wire.toolChoice === 'none' && toolCalls.length) throw new Error('DSH returned tool calls despite toolChoice none')
      return { content: ordered.filter(b => b.type === 'text').map(b => b.text).join(''), reasoning: ordered.filter(b => b.type === 'reasoning').map(b => b.text).join(''), toolCalls, usage,
        finishReason: { stop: 'stop', 'tool-calls': 'tool_calls', 'max-tokens': 'length' }[finish] }
    },
  }
}
