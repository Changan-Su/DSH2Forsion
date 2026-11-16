import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { Readable } from 'node:stream'
import { listModels, resolveModel, modelChunks, readModelBody, streamModelResponse, toDshMessages } from '../src/dsh-bridge/models.js'
import { createModelProvider, modelUsage } from '../src/engine/models.mjs'

let passed = 0
async function test(name, fn) { await fn(); passed++; console.log(`  ok ${name}`) }
const modelId = JSON.stringify(['test-provider', 'test/model'])
const meta = { provider: 'test-provider', id: 'test/model', name: 'Test', context: { contextWindow: 32768 }, reasoning: { efforts: [{ id: 'high' }, { id: 'vendor-opaque' }] } }
const input = { modelId, messages: [{ role: 'system', content: 'Be precise.' }, { role: 'user', content: '你好' }], tools: [{ type: 'function', function: { name: 'read_file', description: 'Read it', parameters: { type: 'object' } } }], thinkingLevel: 'high', maxTokens: 100 }
function ctxFor(llm) { return { get(name) { assert.equal(name, 'llm', 'no Agent, tools or loop service may be touched'); return { resolveModelInfo: async () => meta, ...llm } } } }
await test('registered provider/model catalog is live and exports metadata without credentials', async () => {
  let enabled = true
  const ctx = ctxFor({ listProviders: () => enabled ? [{ id: 'test-provider', name: 'Provider' }] : [], listModels: async () => [meta], resolveModelInfo: async () => meta, credentials: 'NEVER_EXPORT' })
  const value = await listModels(ctx)
  assert.deepEqual(value.models, [{ id: modelId, name: 'Test', supportsVision: false, contextWindow: 32768, thinkingLevels: ['high'] }])
  assert.equal(JSON.stringify(value).includes('NEVER_EXPORT'), false)
  assert.equal((await resolveModel(ctx, modelId)).model.id, modelId)
  enabled = false; assert.deepEqual(await resolveModel(ctx, modelId), { model: null })
})
await test('OpenAI messages preserve ordering, raw call arguments, reasoning and correlated tool results', async () => {
  const messages = toDshMessages([...input.messages,
    { role: 'assistant', content: null, reasoning_content: 'Think.', tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'read_file', arguments: '{"path":"a"}' } }] },
    { role: 'tool', tool_call_id: 'call-1', content: 'Result' }], { provider: 'test-provider', model: 'test/model' })
  assert.deepEqual(messages.map(m => m.role), ['system', 'user', 'assistant', 'tool'])
  assert.deepEqual(messages[2].content, [{ type: 'reasoning', text: 'Think.' }, { type: 'tool-call', id: 'call-1', name: 'read_file', arguments: '{"path":"a"}' }])
  assert.equal(messages[3].toolCallId, 'call-1'); assert.equal(messages[3].source.callId, 'call-1')
  assert.throws(() => toDshMessages([{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'private' } }] }], {}), /unsupported image/)
})
const chunks = [
  { type: 'block-start', index: 0, blockType: 'reasoning' }, { type: 'reasoning-delta', index: 0, text: 'Reason' }, { type: 'block-end', index: 0, block: { type: 'reasoning', text: 'Reason' } },
  { type: 'block-start', index: 1, blockType: 'text' }, { type: 'text-delta', index: 1, text: '你好' }, { type: 'block-end', index: 1, block: { type: 'text', text: '你好' } },
  { type: 'block-start', index: 2, blockType: 'tool-call' }, { type: 'tool-call-delta', index: 2, id: 'call-1', name: 'read_file', argumentsDelta: '{"path":' }, { type: 'tool-call-delta', index: 2, id: 'call-1', argumentsDelta: '"a"}' },
  { type: 'block-end', index: 2, block: { type: 'tool-call', id: 'call-1', name: 'read_file', arguments: '{"path":"a"}' } },
  { type: 'usage', usage: { inputTokens: 20, outputTokens: 8, cacheReadTokens: 5, cacheWriteTokens: 3, reasoningTokens: 4 } }, { type: 'finish', reason: { kind: 'tool-calls' } },
]
await test('one prepared DSH call receives concrete config and returns tool requests without executing them', async () => {
  let calls = 0
  const controller = new AbortController()
  const ctx = ctxFor({ prepareCall: async (proposal, signal) => {
    calls++; assert.equal(signal, controller.signal); assert.equal(proposal.reasoningEffort, 'high')
    return { config: { ...proposal, maxTokens: 100 }, async *stream(request) { assert.equal(request.messages[1].content[0].text, '你好'); assert.equal(request.tools[0].name, 'read_file'); assert.equal(request.sessionId, 'real-dsh-session'); yield* chunks } }
  } })
  const output = []
  for await (const chunk of modelChunks(ctx, input, { signal: controller.signal, agent: { session: { id: 'real-dsh-session' } } })) output.push(chunk)
  assert.equal(calls, 1); assert.deepEqual(output, chunks)
  await assert.rejects(async () => { for await (const _ of modelChunks(ctx, { ...input, toolChoice: { type: 'function', function: { name: 'read_file' } } })) {} }, /forced tool selection/)
  assert.equal(calls, 1)
})
function providerFor(frames, inspectRequest = () => {}) {
  const sidecar = { state: 'running', base: 'http://sidecar.invalid', secret: 'DSH-PRIVATE', bridge: async path => path === '/models' ? { models: [meta] } : { model: meta } }
  const fetchImpl = async (url, init) => {
    assert.ok(url.endsWith('/models/stream')); assert.equal(init.headers['x-dsh2forsion-secret'], 'DSH-PRIVATE')
    inspectRequest(JSON.parse(init.body), init)
    const encoded = new TextEncoder().encode(frames.map(frame => JSON.stringify(frame)).join('\n') + '\n')
    return new Response(new ReadableStream({ start(controller) { for (let i = 0; i < encoded.length; i++) controller.enqueue(encoded.slice(i, i + 1)); controller.close() } }))
  }
  return createModelProvider({ sidecar, fetchImpl })
}
await test('NDJSON split across UTF-8 bytes preserves text, reasoning, raw tools, incremental callbacks and usage', async () => {
  let text = '', reasoning = '', delta = ''
  const provider = providerFor(chunks.map(chunk => ({ type: 'chunk', chunk })), wire => { assert.equal(wire.signal, undefined); assert.equal(wire.onToken, undefined) })
  const result = await provider.stream({ ...input, signal: new AbortController().signal, onToken: value => { text += value }, onReasoning: value => { reasoning += value }, onToolCallDelta: value => { delta += value.argsDelta } })
  assert.equal(result.content, text); assert.equal(text, '你好'); assert.equal(result.reasoning, reasoning); assert.equal(reasoning, 'Reason')
  assert.equal(delta, '{"path":"a"}'); assert.equal(result.toolCalls[0].function.arguments, delta)
  assert.deepEqual(result.usage, { prompt_tokens: 28, completion_tokens: 8, cached_tokens: 5, cache_write_tokens: 3, reasoning_tokens: 4 })
  assert.equal(result.finishReason, 'tool_calls')
})
await test('missing/invalid token usage and missing finish are errors, never fabricated zero counts', async () => {
  assert.throws(() => modelUsage(undefined), /authoritative/)
  assert.throws(() => modelUsage({ inputTokens: NaN, outputTokens: 1 }), /invalid input/)
  const signal = new AbortController().signal
  await assert.rejects(providerFor([{ type: 'chunk', chunk: chunks.at(-1) }]).stream({ ...input, signal }), /usage/)
  await assert.rejects(providerFor([{ type: 'chunk', chunk: chunks.at(-2) }]).stream({ ...input, signal }), /complete result/)
  await assert.rejects(providerFor([{ type: 'error', error: 'DSH model inference failed' }]).stream({ ...input, signal }), /failed/)
})
await test('abort reaches preparation and the HTTP transport, and cancelled streams cannot return success', async () => {
  const controller = new AbortController(); controller.abort()
  let prepared = false
  const ctx = ctxFor({ prepareCall: async () => { prepared = true } })
  await assert.rejects(async () => { for await (const _ of modelChunks(ctx, input, { signal: controller.signal })) {} })
  assert.equal(prepared, false)
  let called = false
  const provider = providerFor([], () => { called = true })
  await assert.rejects(provider.stream({ ...input, signal: controller.signal }))
  assert.equal(called, false)
  const active = new AbortController()
  const cancelled = createModelProvider({ sidecar: { state: 'running', base: 'http://test', secret: 's' }, fetchImpl: async (_url, init) => new Response(new ReadableStream({ start(stream) { init.signal.addEventListener('abort', () => stream.error(init.signal.reason), { once: true }); queueMicrotask(() => active.abort(new Error('cancelled while streaming'))) } })) })
  await assert.rejects(cancelled.stream({ ...input, signal: active.signal }), /cancelled/)
})
await test('HTTP request UTF-8 boundaries and source error frames are explicit without returning provider secrets', async () => {
  const encoded = Buffer.from(JSON.stringify(input)), req = Readable.from([...encoded].map(byte => Buffer.from([byte])))
  assert.deepEqual(await readModelBody(req), input)
  const ctx = ctxFor({ prepareCall: async () => { throw new Error('PRIVATE_PROVIDER_TOKEN') } })
  let body = ''
  const res = { destroyed: false, writeHead() {}, write(part) { body += part; return true }, end() {} }
  await streamModelResponse(ctx, input, res)
  assert.equal(body.includes('PRIVATE_PROVIDER_TOKEN'), false); assert.equal(JSON.parse(body.trim()).type, 'error')
})
await test('trusted host context is replaced by an opaque per-user/session key and no raw identity leaves the engine', async () => {
  let wire
  const provider = providerFor(chunks.map(chunk => ({ type: 'chunk', chunk })), value => { wire = value })
  await provider.stream({ ...input, cacheKey: 'private-session', signal: new AbortController().signal, context: { userId: 'private-user', sessionId: 'private-session', cwd: '/project' } })
  assert.equal(wire.context, undefined); assert.equal(wire.userId, undefined)
  assert.equal(wire.cacheKey, undefined)
  assert.equal(wire.sessionKey, createHash('sha256').update(JSON.stringify(['private-user', 'private-session'])).digest('hex'))
  assert.equal(wire.cwd, '/project'); assert.equal(JSON.stringify(wire).includes('private-user'), false); assert.equal(JSON.stringify(wire).includes('private-session'), false)
  await provider.stream({ ...input, signal: new AbortController().signal })
  assert.equal(wire.sessionKey, undefined); assert.equal(wire.cwd, undefined)
})
await test('models without reasoning controls retain source defaults and reject explicit unsupported effort', async () => {
  let prepared = 0
  const ctx = ctxFor({ resolveModelInfo: async () => ({ ...meta, reasoning: undefined }), prepareCall: async proposal => {
    prepared++; assert.equal(proposal.reasoningEffort, undefined)
    return { config: proposal, async *stream(request) { assert.equal(request.sessionId, undefined); yield* chunks } }
  } })
  for await (const _ of modelChunks(ctx, { ...input, thinkingLevel: 'off' })) {}
  await assert.rejects(async () => { for await (const _ of modelChunks(ctx, input)) {} }, /does not declare/)
  assert.equal(prepared, 1)
  const value = await listModels(ctxFor({ listProviders: () => [{ id: 'test-provider' }], listModels: async () => [meta], resolveModelInfo: async () => ({ ...meta, reasoning: { efforts: [{ id: 'vendor-opaque' }] } }) }))
  assert.equal(value.models[0].thinkingLevels, undefined)
})
console.log(`check-models: ${passed} checks passed`)
