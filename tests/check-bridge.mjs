// Exercise the actual bridge HTTP handler with injected agent-service failures.
import assert from 'node:assert/strict'
import { createServer, request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../src/dsh-bridge/index.js'

let passed = 0
const cwd = join(tmpdir(), 'dsh-bridge-workspace')
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
async function test(name, run) {
  const original = process.env.DSH2FORSION_SECRET
  const originalParent = process.env.DSH2FORSION_PARENT_PID
  const secret = 'test-bridge-secret-'.repeat(4)
  process.env.DSH2FORSION_SECRET = secret
  delete process.env.DSH2FORSION_PARENT_PID
  const events = new Map(), effects = [], calls = [], closed = deferred()
  const state = { registry: null, calls }
  let handler
  const server = createServer((req, res) => { res.once('close', closed.resolve); return handler(req, res) })
  try {
    apply({
      logger: () => ({ warn() {} }),
      on: (event, callback) => events.set(event, callback),
      effect: fn => effects.push(fn()),
      get: name => name === 'agents' ? state.registry : undefined,
      webServer: { register: route => { handler = route.handler; return () => {} } },
      tools: { execute: async input => {
        calls.push(input)
        assert.equal(await events.get('approval/request')({ callId: input.callId }, () => 'unapproved'), 'allowed-once')
        assert.equal(await events.get('approval/request')({ callId: input.callId }, () => 'unapproved'), 'unapproved')
        return { content: [{ type: 'text', text: input.agent?.cwd || 'UNSCOPED' }] }
      } },
    })
    await new Promise(r => server.listen(0, '127.0.0.1', r))
    const url = `http://127.0.0.1:${server.address().port}/forsion-bridge/tools/execute`
    state.post = async (directory = cwd) => {
      const res = await fetch(url, { method: 'POST', headers: { 'x-dsh2forsion-secret': secret }, body: JSON.stringify({ name: 'probe', cwd: directory, approved: true }) })
      return { status: res.status, body: await res.json() }
    }
    state.abortWhileOpening = async started => {
      const req = request(url, { method: 'POST', headers: { 'x-dsh2forsion-secret': secret } })
      req.on('error', () => {})
      req.end(JSON.stringify({ name: 'probe', cwd, approved: true }))
      await started
      req.destroy()
      await closed.promise
    }
    await run(state)
    console.log(`ok ${++passed} ${name}`)
  } finally {
    for (const dispose of effects) dispose?.()
    server.closeAllConnections()
    await new Promise(r => server.close(r))
    if (original === undefined) delete process.env.DSH2FORSION_SECRET
    else process.env.DSH2FORSION_SECRET = original
    if (originalParent === undefined) delete process.env.DSH2FORSION_PARENT_PID
    else process.env.DSH2FORSION_PARENT_PID = originalParent
  }
}

await test('failed create and resume never execute without the selected workspace', async state => {
  state.registry = { create: async () => { throw new Error('create failed') }, resume: async () => { throw new Error('resume failed') } }
  const result = await state.post()
  assert.equal(result.status, 500)
  assert.match(result.body.error, /working directory/i)
  assert.equal(state.calls.length, 0)
})
await test('missing agent service and malformed agent handles block execution', async state => {
  assert.equal((await state.post()).status, 500)
  state.registry = { create: async () => ({}) }
  assert.equal((await state.post()).status, 500)
  assert.equal(state.calls.length, 0)
})
await test('a supplied relative working directory is rejected', async state => {
  assert.equal((await state.post('relative/workspace')).status, 500)
  assert.equal(state.calls.length, 0)
})
await test('a failed workspace can recover on the next call', async state => {
  state.registry = { create: async () => { throw new Error('temporarily unavailable') } }
  assert.equal((await state.post()).status, 500)
  state.registry = { create: async () => ({ agent: { cwd } }) }
  const result = await state.post()
  assert.equal(result.status, 200)
  assert.equal(result.body.result.content[0].text, cwd)
  assert.equal(state.calls.length, 1)
})
await test('concurrent calls share the same workspace agent and retain one-shot approvals', async state => {
  let creates = 0
  state.registry = { create: async () => { creates++; return { agent: { cwd } } } }
  const results = await Promise.all([state.post(), state.post()])
  assert.ok(results.every(result => result.status === 200))
  assert.equal(creates, 1)
  assert.equal(state.calls.length, 2)
  assert.equal(state.calls[0].agent, state.calls[1].agent)
})
await test('disconnect during agent creation prevents the tool from starting', async state => {
  const started = deferred(), gate = deferred(), opened = deferred()
  state.registry = { create: async () => { started.resolve(); await gate.promise; opened.resolve(); return { agent: { cwd } } } }
  await state.abortWhileOpening(started.promise)
  gate.resolve()
  await opened.promise
  // Let the real handler finish its agent lookup and response path.
  await new Promise(r => setImmediate(r))
  assert.equal(state.calls.length, 0)
})

console.log(`check-bridge: ${passed} passed`)
