// Exercise the actual bridge HTTP handler with injected agent-service failures.
import assert from 'node:assert/strict'
import { createServer, request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../src/dsh-bridge/index.js'

let passed = 0
const cwd = join(tmpdir(), 'dsh-bridge-workspace')
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
const makeAgent = () => {
  const events = []
  let active = false
  return {
    cwd, session: { events, append: (type, data) => events.push({ type, data }) },
    async runMaintenance(fn) {
      assert.equal(active, false, 'external calls cannot overlap on one agent')
      active = true
      try { return await fn(new AbortController().signal) } finally { active = false }
    },
  }
}
async function test(name, run) {
  const original = process.env.DSH2FORSION_SECRET
  const originalParent = process.env.DSH2FORSION_PARENT_PID
  const secret = 'test-bridge-secret-'.repeat(4)
  process.env.DSH2FORSION_SECRET = secret
  delete process.env.DSH2FORSION_PARENT_PID
  // Model DSH's earlier remote approver, which consumes a request without next().
  const events = new Map([['approval/request', [async () => 'unapproved']]]), effects = [], calls = [], closed = deferred()
  const approve = req => {
    const listeners = events.get('approval/request')
    const next = i => listeners[i] ? listeners[i](req, () => next(i + 1)) : 'unapproved'
    return next(0)
  }
  const state = { registry: null, calls }
  let handler
  const server = createServer((req, res) => { state.nextRequest?.resolve(); res.once('close', closed.resolve); return handler(req, res) })
  try {
    apply({
      provide() {},
      logger: () => ({ warn() {} }),
      on: (event, callback, options) => {
        const listeners = events.get(event) ?? []
        if (options?.prepend) listeners.unshift(callback); else listeners.push(callback)
        events.set(event, listeners)
      },
      effect: fn => effects.push(fn()),
      get: name => name === 'agents' ? state.registry : name === 'sessionProjections' ? {
        stateOf(session) {
          const starts = session.events.filter(e => e.type === 'turn/start')
          const ends = session.events.filter(e => e.type === 'turn/end')
          return { lastTurn: starts.at(-1)?.data.turn ?? 0, openTurnStartSeq: starts.length === ends.length ? null : 1 }
        },
      } : undefined,
      webServer: { register: route => { handler = route.handler; return () => {} } },
      tools: { execute: async input => {
        calls.push(input)
        assert.equal(input.agent.session.events.at(-1)?.type, 'turn/start', 'approval must be enclosed by an actual turn')
        assert.equal(await approve({ callId: input.callId }), 'allowed-once')
        assert.equal(await approve({ callId: input.callId }), 'unapproved')
        if (state.onExecute) return state.onExecute(input)
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
      const arrived = deferred()
      state.nextRequest = arrived
      const req = request(url, { method: 'POST', headers: { 'x-dsh2forsion-secret': secret } })
      req.on('error', () => {})
      req.end(JSON.stringify({ name: 'probe', cwd, approved: true }))
      await started
      await arrived.promise
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
  state.registry = { create: async () => ({ agent: makeAgent() }) }
  const result = await state.post()
  assert.equal(result.status, 200)
  assert.equal(result.body.result.content[0].text, cwd)
  assert.equal(state.calls.length, 1)
})
await test('concurrent calls share the same workspace agent and retain one-shot approvals', async state => {
  let creates = 0
  state.registry = { create: async () => { creates++; return { agent: makeAgent() } } }
  const results = await Promise.all([state.post(), state.post()])
  assert.ok(results.every(result => result.status === 200))
  assert.equal(creates, 1)
  assert.equal(state.calls.length, 2)
  assert.equal(state.calls[0].agent, state.calls[1].agent)
  assert.deepEqual(state.calls[0].agent.session.events.map(e => [e.type, e.data.turn]), [['turn/start', 1], ['turn/end', 1], ['turn/start', 2], ['turn/end', 2]])
})
await test('disconnect during agent creation prevents the tool from starting', async state => {
  const started = deferred(), gate = deferred(), opened = deferred()
  state.registry = { create: async () => { started.resolve(); await gate.promise; opened.resolve(); return { agent: makeAgent() } } }
  await state.abortWhileOpening(started.promise)
  gate.resolve()
  await opened.promise
  // Let the real handler finish its agent lookup and response path.
  await new Promise(r => setImmediate(r))
  assert.equal(state.calls.length, 0)
})

await test('an exception closes its turn and does not poison the next call', async state => {
  const agent = makeAgent()
  state.registry = { create: async () => ({ agent }) }
  state.onExecute = async () => { throw new Error('tool failed') }
  assert.equal((await state.post()).status, 500)
  assert.equal(agent.session.events.at(-1).data.reason.kind, 'error')
  state.onExecute = null
  assert.equal((await state.post()).status, 200)
  assert.equal(agent.session.events.at(-1).data.turn, 2)
  assert.equal(agent.session.events.at(-1).data.reason.kind, 'completed')
})
await test('cancelling a queued call does not cancel or overlap the earlier call', async state => {
  const started = deferred(), gate = deferred()
  state.registry = { create: async () => ({ agent: makeAgent() }) }
  state.onExecute = async () => { started.resolve(); await gate.promise; return { content: [] } }
  const first = state.post()
  await started.promise
  await state.abortWhileOpening(Promise.resolve())
  gate.resolve()
  assert.equal((await first).status, 200)
  await new Promise(r => setImmediate(r))
  assert.equal(state.calls.length, 1)
  assert.deepEqual(state.calls[0].agent.session.events.map(e => e.type), ['turn/start', 'turn/end'])
})

console.log(`check-bridge: ${passed} passed`)
