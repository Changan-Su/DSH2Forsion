// Single-inference LLM service bridge. Never resolve an Agent or execute tools.
import { once } from 'node:events'
const levels = new Set(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'])
const identifier = (provider, model) => JSON.stringify([provider, model])
function route(modelId) {
  let value
  try { value = JSON.parse(modelId) } catch { throw new Error('Invalid DSH model id') }
  if (!Array.isArray(value) || value.length !== 2 || value.some(part => typeof part !== 'string' || !part)) throw new Error('Invalid DSH model route')
  return { provider: value[0], model: value[1] }
}
function service(ctx) {
  const llm = ctx.get('llm')
  if (!llm) throw new Error('DSH LLM service is unavailable')
  return llm
}
async function abortable(value, signal) {
  signal?.throwIfAborted()
  if (!signal) return value
  let abort
  const cancelled = new Promise((_, reject) => { abort = () => reject(signal.reason || new Error('Model request aborted')); signal.addEventListener('abort', abort, { once: true }) })
  try { return await Promise.race([value, cancelled]) } finally { signal.removeEventListener('abort', abort) }
}
function publicModel(model) {
  const id = identifier(model.provider, model.id)
  if (id.length > 240) throw new Error('DSH model route exceeds the host id limit')
  const thinkingLevels = model.reasoning?.efforts?.map(e => e.id).filter(id => levels.has(id))
  return { id, name: model.name || model.id, supportsVision: false,
    ...(Number.isFinite(model.context?.contextWindow) && model.context.contextWindow > 0 ? { contextWindow: model.context.contextWindow } : {}),
    ...(thinkingLevels?.length ? { thinkingLevels } : {}),
  }
}
export async function listModels(ctx, { signal } = {}) {
  const llm = service(ctx), models = []
  for (const provider of llm.listProviders()) {
    signal?.throwIfAborted()
    let available
    try { available = await abortable(llm.listModels(provider.id), signal) } catch { signal?.throwIfAborted(); continue }
    for (const summary of available) {
      signal?.throwIfAborted()
      try { models.push(publicModel(await llm.resolveModelInfo(provider.id, summary.id, signal))) } catch { signal?.throwIfAborted() }
    }
  }
  return { models }
}
export async function resolveModel(ctx, modelId, { signal } = {}) {
  const llm = service(ctx), selected = route(modelId)
  signal?.throwIfAborted()
  if (!llm.listProviders().some(p => p.id === selected.provider)) return { model: null }
  // Resolve afresh; credentials and provider implementation stay inside DSH.
  const model = await llm.resolveModelInfo(selected.provider, selected.model, signal)
  signal?.throwIfAborted()
  return { model: publicModel(model) }
}
function content(value) {
  if (value === null || value === undefined) return []
  if (typeof value === 'string') return value ? [{ type: 'text', text: value }] : []
  if (!Array.isArray(value)) throw new Error('Invalid model message content')
  return value.map(part => {
    if (part?.type !== 'text' || typeof part.text !== 'string') throw new Error('DSH model bridge does not accept unsupported image/file content')
    return { type: 'text', text: part.text }
  })
}
export function toDshMessages(messages, selected) {
  if (!Array.isArray(messages)) throw new Error('Model messages must be an array')
  return messages.map((message, index) => {
    if (!['system', 'user', 'assistant', 'tool'].includes(message?.role)) throw new Error('Unsupported model message role')
    const blocks = content(message.content)
    if (message.role === 'assistant') {
      if (message.reasoning_content) blocks.unshift({ type: 'reasoning', text: message.reasoning_content })
      for (const call of message.tool_calls || []) {
        if (!call?.id || call.type !== 'function' || typeof call.function?.name !== 'string' || typeof call.function.arguments !== 'string') throw new Error('Invalid historical model tool call')
        blocks.push({ type: 'tool-call', id: call.id, name: call.function.name, arguments: call.function.arguments })
      }
    }
    const source = message.role === 'system' ? { kind: 'system-prompt' }
      : message.role === 'assistant' ? { kind: 'model', ...selected }
        : message.role === 'tool' ? { kind: 'tool', callId: message.tool_call_id } : { kind: 'user' }
    if (message.role === 'tool' && !message.tool_call_id) throw new Error('Tool result is missing its call id')
    return { id: `dsh2forsion-message-${index}`, role: message.role, source, content: blocks,
      ...(message.role === 'tool' ? { toolCallId: message.tool_call_id } : {}),
    }
  })
}
export async function* modelChunks(ctx, input, { signal, agent } = {}) {
  const selected = route(input.modelId)
  signal?.throwIfAborted()
  if (input.toolChoice && input.toolChoice !== 'auto' && input.toolChoice !== 'none') throw new Error('DSH rc.2 does not expose forced tool selection on its public LLM API')
  const llm = service(ctx)
  const info = await llm.resolveModelInfo(selected.provider, selected.model, signal)
  signal?.throwIfAborted()
  let reasoningEffort = input.thinkingLevel
  if (!info.reasoning?.efforts?.length) {
    if (reasoningEffort && reasoningEffort !== 'off') throw new Error('DSH model does not declare the requested reasoning effort')
    reasoningEffort = undefined // source default; do not pretend an unsupported control worked
  }
  const proposed = { ...selected,
    ...(input.temperature === undefined ? {} : { temperature: input.temperature }),
    ...(input.maxTokens === undefined ? {} : { maxTokens: input.maxTokens }),
    ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
  }
  // Exactly one prepared call; the stream returns tool requests, never executes them.
  const prepared = await llm.prepareCall(proposed, signal)
  signal?.throwIfAborted()
  const tools = input.toolChoice === 'none' ? undefined : input.tools?.map(tool => {
    if (tool?.type !== 'function' || !tool.function?.name || !tool.function.parameters) throw new Error('Invalid tool declaration')
    return { name: tool.function.name, description: tool.function.description || '', parameters: tool.function.parameters }
  })
  const request = { ...prepared.config, messages: toDshMessages(input.messages, selected), ...(tools?.length ? { tools } : {}), signal,
    ...(typeof agent?.session?.id === 'string' && agent.session.id ? { sessionId: agent.session.id } : {}),
  }
  let finished = false, usage = false
  for await (const chunk of prepared.stream(request)) {
    signal?.throwIfAborted()
    if (finished) throw new Error('DSH emitted data after its terminal model chunk')
    if (chunk.type === 'usage') usage = true
    if (chunk.type === 'finish') {
      if (chunk.reason?.kind === 'error' || chunk.reason?.kind === 'aborted') {
        const code = chunk.reason.failure?.code
        throw new Error(`DSH model inference failed${typeof code === 'string' && /^[A-Za-z0-9_.:-]{1,100}$/.test(code) ? ': ' + code : ''}`)
      }
      if (!usage) throw new Error('DSH model inference returned no authoritative token usage')
      finished = true
    }
    yield chunk
  }
  if (!finished) throw new Error('DSH model stream ended without a terminal chunk')
}
export async function readModelBody(req) {
  let size = 0
  const parts = []
  for await (const part of req) { size += part.length; if (size > 32 * 1024 * 1024) throw new Error('Model request exceeds 32 MiB'); parts.push(Buffer.from(part)) }
  return JSON.parse(Buffer.concat(parts).toString('utf8'))
}
export async function streamModelResponse(ctx, input, res, { signal, agent } = {}) {
  res.writeHead(200, { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store' })
  try {
    for await (const chunk of modelChunks(ctx, input, { signal, agent })) {
      if (res.destroyed) return
      if (!res.write(JSON.stringify({ type: 'chunk', chunk }) + '\n')) await once(res, 'drain', { signal })
    }
  } catch (error) {
    const detail = String(error?.message || error)
    const safe = /^(DSH model|DSH rc\.2|Model request)/.test(detail) ? detail : 'DSH model request failed'
    if (!res.destroyed) res.write(JSON.stringify({ type: 'error', error: signal?.aborted ? 'Model inference aborted' : safe }) + '\n')
  } finally { if (!res.destroyed) res.end() }
}
