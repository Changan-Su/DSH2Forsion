import assert from 'node:assert/strict'
import { AsyncLocalStorage } from 'node:async_hooks'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, realpath, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { SessionScopePool } from '../src/dsh-bridge/session-scope.js'
const key = (user, session) => createHash('sha256').update(JSON.stringify([user, session])).digest('hex')
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
const root = await mkdtemp(join(tmpdir(), 'dsh-session-scope-'))
const cwd = await realpath(root)
const other = join(cwd, 'other'); await mkdir(other)
function fixture() {
  const als = new AsyncLocalStorage()
  const handles = [], archived = [], durable = new Map(), starts = [], resumes = []
  const state = { createGate: null, statError: null, statCalls: 0 }
  const make = async (id, project) => {
    if (state.createGate) await state.createGate.promise
    const events = []
    let active = false
    const agent = {
      session: { id, header: { cwd: project }, append: (type, data) => events.push({ type, data }) },
      async runMaintenance(fn) {
        assert.equal(active, false, 'maintenance cannot overlap for one session')
        active = true
        try { return await fn(new AbortController().signal) } finally { active = false }
      },
      followup() { throw new Error('Model driver must never be woken') },
    }
    const handle = { agent, events, disposed: 0, async dispose() { this.disposed++ } }
    handles.push(handle)
    durable.set(id, project)
    return handle
  }
  const services = {
    agents: {
      currentInitiator: () => als.getStore(),
      withInitiator: (agent, fn) => als.run(agent, fn),
      create: async options => { starts.push(options); return make(options.sessionId, options.meta.cwd) },
      resume: async options => { resumes.push(options); return make(options.resumeSessionId, durable.get(options.resumeSessionId)) },
    },
    workspaceRegistry: { archiveSession: async id => { archived.push(id) } },
    sessionPersistence: { stat: async id => { state.statCalls++; if (state.statError) throw state.statError; return durable.has(id) ? { header: { id, cwd: durable.get(id) } } : undefined } },
    sessionProjections: { stateOf(session) {
      const events = handles.find(handle => handle.agent.session === session).events
      const begun = events.filter(e => e.type === 'turn/start'), ended = events.filter(e => e.type === 'turn/end')
      return { lastTurn: begun.at(-1)?.data.turn ?? 0, openTurnStartSeq: begun.length === ended.length ? null : 1 }
    } },
  }
  return { ctx: { get: name => services[name] }, state, handles, archived, starts, resumes, durable, services }
}
try {
  const f = fixture(), pool = new SessionScopePool(f.ctx)
  const a = { sessionKey: key('alice', 'one'), cwd }, b = { sessionKey: key('alice', 'two'), cwd }, c = { sessionKey: key('bob', 'one'), cwd }
  const [aa, same, bb, cc] = await Promise.all([pool.get(a), pool.get(a), pool.get(b), pool.get(c)])
  assert.equal(aa, same, 'single flight creates exactly one agent per opaque session')
  assert.notEqual(aa, bb, 'different sessions in the same project cannot share state')
  assert.notEqual(aa, cc, 'different users with the same native session ID cannot share state')
  assert.equal(f.starts.length, 3)
  assert.equal(f.archived.length, 3)
  assert.ok(f.starts.every(options => !JSON.stringify(options).includes('alice') && !JSON.stringify(options).includes('bob')), 'real account identities never enter DSH')
  assert.ok(f.handles.every(handle => handle.events.length === 0), 'creation writes no fabricated conversation messages')
  const gate = deferred(), entered = deferred(), order = []
  const inference = pool.withInitiator(a, undefined, async agent => {
    order.push('inference')
    assert.equal(f.services.agents.currentInitiator(), agent)
    async function* stream() { yield 'first'; await gate.promise; yield 'last' }
    for await (const chunk of stream()) {
      assert.equal(f.services.agents.currentInitiator(), agent, 'initiator survives asynchronous stream consumption')
      order.push(chunk)
      if (chunk === 'first') entered.resolve()
    }
    return 'settled'
  })
  await entered.promise
  const tool = pool.execute(a, undefined, async agent => {
    order.push('tool')
    assert.equal(agent, aa)
    assert.equal(f.services.agents.currentInitiator(), aa)
    assert.equal(f.handles.find(handle => handle.agent === agent).events.at(-1).type, 'turn/start')
    return { isError: false, content: [] }
  })
  const queuedCancel = new AbortController()
  let cancelledQueuedExecuted = false
  const queued = pool.withInitiator(a, queuedCancel.signal, async () => { cancelledQueuedExecuted = true })
  queuedCancel.abort(new Error('queued cancellation'))
  await assert.rejects(queued, /queued cancellation/, 'queued cancellation does not wait for the active stream')
  assert.equal(await pool.withInitiator(b, undefined, async agent => { assert.equal(agent, bb); return 'parallel B' }), 'parallel B', 'other sessions do not wait for A')
  gate.resolve()
  assert.equal(await inference, 'settled')
  await tool
  assert.equal(cancelledQueuedExecuted, false, 'cancelled queued operation never executes')
  assert.deepEqual(order, ['inference', 'first', 'last', 'tool'])
  const ha = f.handles.find(handle => handle.agent === aa)
  assert.deepEqual(ha.events.map(e => e.type), ['turn/start', 'turn/end'])
  assert.equal(ha.events[1].data.reason.kind, 'completed')
  await pool.execute(a, undefined, async () => ({ isError: true }))
  assert.equal(ha.events.at(-1).data.reason.kind, 'error')
  await assert.rejects(pool.withInitiator(a, undefined, async () => (async function* () { yield 'not consumed' })()), /Consume the model stream/)
  await assert.rejects(pool.get({ ...a, cwd: other }), /project changed/)
  await assert.rejects(pool.get({ ...a, sessionKey: 'native-session-id' }), /opaque SHA-256/)
  await assert.rejects(pool.get({ ...a, cwd: 'relative' }), /absolute/)

  const cancel = new AbortController(), cancellationEntered = deferred()
  const cancelled = pool.execute(a, cancel.signal, async (_agent, signal) => {
    cancellationEntered.resolve()
    await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }))
    return { isError: false }
  })
  await cancellationEntered.promise
  cancel.abort(new Error('user cancelled'))
  await assert.rejects(cancelled, /user cancelled/)
  assert.equal(ha.events.at(-1).data.reason.reason.kind, 'user')

  const disposeEntered = deferred()
  const active = pool.withInitiator(a, undefined, async (_agent, signal) => {
    disposeEntered.resolve()
    await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }))
    return 'must not be published'
  })
  await disposeEntered.promise
  const disposed = pool.dispose()
  await assert.rejects(active, /disposed/)
  await disposed
  await pool.dispose()
  assert.ok(f.handles.every(handle => handle.disposed === 1), 'disable disposes every owned handle exactly once')
  await assert.rejects(pool.get(a), /disposed/)

  // A new activation resumes only persisted metadata; no copied history is supplied.
  const reloaded = new SessionScopePool(f.ctx)
  await reloaded.get(a)
  assert.equal(f.resumes.length, 1)
  assert.deepEqual(Object.keys(f.resumes[0]).sort(), ['resumeSessionId', 'signal'])
  await reloaded.dispose()

  const broken = fixture(), brokenPool = new SessionScopePool(broken.ctx)
  broken.state.statError = new Error('storage unreadable')
  await assert.rejects(brokenPool.get(a), /storage unreadable/)
  assert.equal(broken.starts.length, 0, 'read failure cannot create a replacement empty session')
  await brokenPool.dispose()

  const late = fixture(), latePool = new SessionScopePool(late.ctx)
  late.state.createGate = deferred()
  const opening = latePool.get(a)
  // Wait on an explicit start observation, without arbitrary elapsed-time sleeps.
  while (late.starts.length === 0) await new Promise(resolve => setImmediate(resolve))
  const lateDisposal = latePool.dispose()
  late.state.createGate.resolve()
  await assert.rejects(opening, /disposed/)
  await lateDisposal
  assert.equal(late.handles[0].disposed, 1, 'late creation after disable is disposed before becoming available')
  console.log('check-session-scope: opaque user/session isolation, single flight, complete inference ALS, tool audit, concurrency, cancellation, reload, read failure and disable disposal passed')
} finally { await rm(root, { recursive: true, force: true }) }
