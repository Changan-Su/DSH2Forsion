// 审批 B 的纯逻辑:桥在链首那一环什么时候把审批交给 DSH 的对话入口(问到 Forsion 的审批卡)、什么时候留在工作台,
// 自检对不上时整块退回工作台提示,以及插件在 ACP 管道上报「Forsion 在这场会话上开始 / 结束一轮」。
// 用一张假的 cordis 事件表(形状同 DSH 0.2.2-rc.3 的 ctx.events._hooks),不起 DSH;真进程见 tests/check-approvals.mjs。
import assert from 'node:assert/strict'
import { PassThrough } from 'node:stream'
import { APPROVAL_EVENT, NOTICE_METHOD, createApprovalRouter, startedInWorkbench } from '../src/dsh-bridge/approvals.js'
import { promptGate } from '../src/engine/sidecar.mjs'

let n = 0
const it = async (name, fn) => { await fn(); n++; console.log(`ok ${n} ${name}`) }
const BRIDGE = 'dsh2forsion-bridge'
const quiet = { info() {}, warn() {} }

// dsh-acp 那一环的形状:只认它开着的会话(这里 = owned 里的 id),认了就问 ACP 客户端,不认就 next()
function fakeAcp(owned, asks) {
  return (req, next) => {
    if (!owned.has(req.agent.session.id) || req.callId === undefined) return next()
    asks.push(req.callId)
    return Promise.resolve('allowed-once')
  }
}
function world({ acp, order = 'bridge-first', extra = {} } = {}) {
  const acpFiber = { name: 'acp' }, bridgeFiber = { name: BRIDGE }, webFiber = { name: 'root' }
  const hook = (fiber, callback) => ({ ctx: { fiber }, callback })
  const asks = []
  const owned = new Set(['S1', 'S2'])
  const acpCb = acp ?? fakeAcp(owned, asks)
  const bridgeLink = hook(bridgeFiber, () => {})
  const acpLink = hook(acpFiber, acpCb)
  const webLink = hook(webFiber, () => 'web')
  const chain = order === 'bridge-first' ? [bridgeLink, webLink, acpLink] : [webLink, bridgeLink, acpLink]
  const table = {
    [APPROVAL_EVENT]: chain,
    'agent/inbox/claimed': [hook(acpFiber, () => {}), hook(bridgeFiber, () => {})],
    'session/event': [hook(acpFiber, () => {}), hook(bridgeFiber, () => {})],
    ...extra,
  }
  const lines = []
  const timers = []
  const router = createApprovalRouter({
    events: () => ({ _hooks: table }), ownName: BRIDGE, log: quiet, write: line => lines.push(JSON.parse(line)),
    delay: (fn) => { timers.push(fn); return fn }, cancel: (t) => { const i = timers.indexOf(t); if (i >= 0) timers.splice(i, 1) },
  })
  const flush = () => { while (timers.length) timers.shift()() }
  return { router, table, asks, owned, lines, flush }
}
const req = (sid, callId = 'c1', toolName = 'write') => ({ agent: { session: { id: sid } }, callId, toolName })
const web = () => 'web'

try {
  await it('a turn is "from the workbench" only when its first message carries rpcId (ACP, /plan, /goal, subagents do not)', () => {
    assert.equal(startedInWorkbench({ kind: 'user', rpcId: 'r1', principal: 'p' }), true)
    assert.equal(startedInWorkbench({ kind: 'retry', rpcId: undefined }), true)
    assert.equal(startedInWorkbench({ kind: 'user' }), false)
    assert.equal(startedInWorkbench(undefined), false)
  })

  await it('self-check passes on the DSH 0.2.2-rc.3 shape and probes the ACP link with a session it does not own', () => {
    let probed = 0
    const { router } = world({ acp: (r, next) => { probed++; return next() } })
    assert.deepEqual(router.status(), { mode: 'forsion', reason: 'ok', event: APPROVAL_EVENT })
    router.check()
    assert.equal(probed, 1, 'the shape probe runs once per ACP link')
  })

  await it('Forsion turn: the approval goes to DSH\'s ACP link (Forsion\'s card), the web link is never reached', async () => {
    const { router, asks } = world()
    router.setForsionTurn('S1', 7, true)
    const out = await router.link(undefined, req('S1'), web)
    assert.equal(out, 'allowed-once')
    assert.deepEqual(asks, ['c1'])
  })

  await it('no Forsion turn on the session (workbench turn): stays in the workbench, Forsion is not asked', () => {
    const { router, asks } = world()
    assert.equal(router.link(undefined, req('S1'), web), 'web')
    router.setForsionTurn('S1', 7, true)
    router.setForsionTurn('S1', 7, false)
    assert.equal(router.link(undefined, req('S1'), web), 'web')
    assert.deepEqual(asks, [])
  })

  await it('Forsion queued behind a turn started in the workbench: that turn\'s approval stays in the workbench', () => {
    const { router, asks } = world()
    router.setForsionTurn('S1', 7, true)
    router.onClaim({ agent: { session: { id: 'S1' } }, message: { source: { kind: 'user', rpcId: 'r' } }, turn: 3 })
    assert.equal(router.link(undefined, req('S1'), web), 'web')
    // 同一轮里后来插进来的消息不改这一轮的归属
    router.onClaim({ agent: { session: { id: 'S1' } }, message: { source: { kind: 'user' } }, turn: 3 })
    assert.equal(router.link(undefined, req('S1'), web), 'web')
    // 那一轮结束,Forsion 那一轮开始(第一条是对话入口的消息)
    router.onSessionEvent({ header: { id: 'S1' } }, { type: 'turn/end', data: { turn: 3 } })
    router.onClaim({ agent: { session: { id: 'S1' } }, message: { source: { kind: 'user' } }, turn: 4 })
    assert.notEqual(router.link(undefined, req('S1'), web), 'web')
    assert.deepEqual(asks, ['c1'])
  })

  await it('both sides pending at once: Forsion\'s session asks Forsion, the workbench session stays in the workbench', async () => {
    const { router, asks } = world()
    router.setForsionTurn('S1', 1, true)
    const a = router.link(undefined, req('S1', 'a'), web)
    const b = router.link(undefined, req('S2', 'b'), web)
    assert.equal(b, 'web')
    assert.equal(await a, 'allowed-once')
    assert.deepEqual(asks, ['a'])
  })

  await it('ACP does not own the session (or no callId): passed on to the workbench', () => {
    const { router, asks } = world()
    router.setForsionTurn('S9', 1, true)
    assert.equal(router.link(undefined, req('S9'), web), 'web')
    router.setForsionTurn('S1', 1, true)
    assert.equal(router.link(undefined, { agent: { session: { id: 'S1' } }, toolName: 'write' }, web), 'web')
    assert.deepEqual(asks, [])
  })

  const mismatches = [
    ['event renamed (the ACP link is not on our event name)', w => { w.table['approval/request2'] = w.table[APPROVAL_EVENT]; delete w.table[APPROVAL_EVENT] }, /no link on "approval\/request"|bridge link is not on/],
    ['another link was prepended before the bridge', w => { w.table[APPROVAL_EVENT].unshift({ ctx: { fiber: { name: 'someone' } }, callback: () => {} }) }, /"someone" runs before the bridge/],
    ['the ACP plugin is no longer named acp', w => { for (const h of w.table[APPROVAL_EVENT]) if (h.ctx.fiber.name === 'acp') h.ctx.fiber = { name: 'acp2' } }, /no link on/],
    ['the ACP link swallows requests it does not own', w => { for (const h of w.table[APPROVAL_EVENT]) if (h.ctx.fiber.name === 'acp') h.callback = () => 'cancelled' }, /did not pass on/],
    ['the ACP link throws', w => { for (const h of w.table[APPROVAL_EVENT]) if (h.ctx.fiber.name === 'acp') h.callback = () => { throw new Error('shape changed') } }, /threw/],
    ['the ACP module stopped listening to turn claims', w => { w.table['agent/inbox/claimed'] = w.table['agent/inbox/claimed'].filter(h => h.ctx.fiber.name !== 'acp') }, /agent\/inbox\/claimed/],
    ['cordis event table not readable', w => { w.router = createApprovalRouter({ events: () => ({}), ownName: BRIDGE, log: quiet }) }, /not readable/],
  ]
  for (const [label, breakIt, why] of mismatches) {
    await it(`self-check mismatch → whole fallback to the workbench prompt: ${label}`, () => {
      const w = world()
      breakIt(w)
      const s = w.router.status()
      assert.equal(s.mode, 'workbench')
      assert.match(s.reason, why)
      w.router.setForsionTurn('S1', 1, true)
      assert.equal(w.router.link(undefined, req('S1'), web), 'web', 'Forsion turn is not taken over')
      assert.deepEqual(w.asks, [])
    })
  }

  await it('an approval that went to the workbench tells Forsion (notice + clear); one Forsion took gets no notice', async () => {
    const { router, lines, flush } = world()
    router.setForsionTurn('S1', 1, true)
    const ses = { header: { id: 'S1' } }
    // 接管的那次:asked 落盘 → waterfall → 交给 Forsion
    router.onSessionEvent(ses, { type: 'approval/asked', data: { id: 'A1', callId: 'c1', toolName: 'write' } })
    await router.link(undefined, req('S1', 'c1'), web)
    flush()
    router.onSessionEvent(ses, { type: 'approval/decided', data: { id: 'A1', outcome: 'allowed-once' } })
    assert.deepEqual(lines, [])
    // 没接管(工作台那边):提示、批完撤掉
    router.onSessionEvent({ header: { id: 'S2' } }, { type: 'approval/asked', data: { id: 'A2', callId: 'c2', toolName: 'create_skill' } })
    flush()
    router.onSessionEvent({ header: { id: 'S2' } }, { type: 'approval/decided', data: { id: 'A2', outcome: 'rejected' } })
    assert.equal(lines.length, 2)
    assert.equal(lines[0].method, NOTICE_METHOD)
    assert.deepEqual({ ...lines[0].params, text: undefined, action: undefined }, { sessionId: 'S2', id: 'dsh-approval-A2', kind: 'approval-elsewhere', text: undefined, action: undefined })
    assert.equal(lines[0].params.text.zh, 'DSH 在工作台里等你批准')
    assert.equal(lines[0].params.action.id, 'open-in-workbench')
    assert.equal(lines[0].params.action.label.zh, '打开工作台')
    assert.deepEqual(lines[1].params, { sessionId: 'S2', id: 'dsh-approval-A2', clear: true })
  })

  await it('fallback A: with the event renamed the bridge link never runs, but the notice still comes from the session log', () => {
    const w = world()
    delete w.table[APPROVAL_EVENT]
    w.router.setForsionTurn('S1', 1, true)
    w.router.onSessionEvent({ header: { id: 'S1' } }, { type: 'approval/asked', data: { id: 'A1', callId: 'c1' } })
    w.flush()
    assert.equal(w.lines.length, 1)
    assert.equal(w.lines[0].params.sessionId, 'S1')
  })

  await it('a subagent\'s approval is reported on the conversation Forsion waits on (its root session)', () => {
    const { router, lines, flush } = world()
    router.onSessionEvent({ header: { id: 'C1', origin: 'subagent', parentSession: 'S1' } }, { type: 'approval/asked', data: { id: 'A9', callId: 'c9' } })
    flush()
    assert.equal(lines[0].params.sessionId, 'S1')
  })

  await it('decided before the notice delay: nothing is shown or cleared', () => {
    const { router, lines, flush } = world()
    router.onSessionEvent({ header: { id: 'S2' } }, { type: 'approval/asked', data: { id: 'A3', callId: 'c3' } })
    router.onSessionEvent({ header: { id: 'S2' } }, { type: 'approval/decided', data: { id: 'A3' } })
    flush()
    assert.deepEqual(lines, [])
  })

  await it('a workbench approval already pending when Forsion starts a turn on that session: the notice is sent again', () => {
    const { router, lines, flush } = world()
    // 工作台的轮在 S1(含它的子代理 C1)上等审批;这时没有 Forsion 的轮,宿主把提示丢掉
    router.onSessionEvent({ header: { id: 'S1' } }, { type: 'approval/asked', data: { id: 'A1', callId: 'c1' } })
    router.onSessionEvent({ header: { id: 'C1', origin: 'subagent', parentSession: 'S1' } }, { type: 'approval/asked', data: { id: 'A2', callId: 'c2' } })
    router.onSessionEvent({ header: { id: 'S2' } }, { type: 'approval/asked', data: { id: 'A3', callId: 'c3' } })
    flush()
    assert.equal(lines.length, 3)
    lines.length = 0
    // Forsion 在 S1 上发一句(DSH 会把它排在那一轮后面):S1 的两件再说一次,S2 那件不说
    router.setForsionTurn('S1', 'p1', true)
    assert.deepEqual(lines.map(l => [l.params.sessionId, l.params.id]), [['S1', 'dsh-approval-A1'], ['S1', 'dsh-approval-A2']])
    // 已经批完的不再说
    router.onSessionEvent({ header: { id: 'S1' } }, { type: 'approval/decided', data: { id: 'A1' } })
    lines.length = 0
    router.setForsionTurn('S1', 'p2', true)
    assert.deepEqual(lines.map(l => l.params.id), ['dsh-approval-A2'])
  })

  await it('ACP\'s link rejects: the rejection reaches the caller and nothing is left unhandled (DSH exits on an unhandled rejection)', async () => {
    const unhandled = []
    const onUnhandled = e => unhandled.push(e)
    process.on('unhandledRejection', onUnhandled)
    try {
      const { router, flush } = world({ acp: (r, next) => r.agent.session.id === 'S1' ? Promise.reject(new Error('ACP client went away')) : next() })
      router.onClaim({ agent: { session: { id: 'S1' } }, message: { source: { kind: 'user' } }, turn: 1 })
      router.setForsionTurn('S1', 'p1', true)
      await assert.rejects(Promise.resolve(router.link(null, req('S1'), web)), /went away/)
      flush()
      await new Promise(r => setTimeout(r, 20))
      assert.deepEqual(unhandled, [])
    } finally { process.off('unhandledRejection', onUnhandled) }
  })

  await it('prompt gate: reports a Forsion turn to the bridge before DSH sees the prompt, and its end when the response comes out', async () => {
    const stdin = new PassThrough()
    const seen = []
    const calls = []
    const sidecar = {
      log() {},
      bridge: async (path, init) => { calls.push([path, JSON.parse(init.body), seen.length]); await new Promise(r => setTimeout(r, 20)) },
    }
    stdin.on('data', d => seen.push(String(d)))
    const gate = promptGate(sidecar, stdin)
    gate.input.write(JSON.stringify({ jsonrpc: '2.0', id: 4, method: 'session/new', params: { cwd: '/w' } }) + '\n')
    gate.input.write(JSON.stringify({ jsonrpc: '2.0', id: 5, method: 'session/prompt', params: { sessionId: 'S1', prompt: [] } }) + '\n{"jsonrpc":"2.0","method":"session/cancel","params":{"sessionId":"S1"}}\n')
    await new Promise(r => setTimeout(r, 80))
    assert.deepEqual(calls[0].slice(0, 2), ['/forsion-turns', { sessionId: 'S1', id: 5, active: true }])
    assert.equal(calls[0][2], 1, 'reported after session/new went through and before the prompt reached DSH')
    assert.equal(seen.length, 3, 'every line still reaches DSH, in order')
    assert.match(seen[1], /session\/prompt/)
    gate.onOutput(JSON.stringify({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 'S1' } }))
    gate.onOutput(JSON.stringify({ jsonrpc: '2.0', id: 5, result: { stopReason: 'end_turn' } }))
    assert.deepEqual(calls[1].slice(0, 2), ['/forsion-turns', { sessionId: 'S1', id: 5, active: false }])
    assert.equal(gate.pending.size, 0)
  })

  await it('prompt gate: a bridge that does not answer does not hold the prompt back for more than a moment', async () => {
    const stdin = new PassThrough()
    const seen = []
    stdin.on('data', d => seen.push(String(d)))
    const gate = promptGate({ log() {}, bridge: () => Promise.reject(new Error('DSH is not running')) }, stdin)
    gate.input.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'session/prompt', params: { sessionId: 'S1', prompt: [] } }) + '\n')
    await new Promise(r => setTimeout(r, 30))
    assert.equal(seen.length, 1)
  })

  console.log(`\n${n} passed`)
} catch (error) {
  console.error(error)
  process.exit(1)
}
