import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { request } from 'node:http'
import { NativeExecution } from '../src/engine/native-execution.mjs'

const root = await mkdtemp(join(tmpdir(), 'dsh-native-execution-'))
const file = join(root, 'ledger.json'), cwd = join(root, 'project')
await mkdir(cwd)
const records = new Map()
let starts = 0, enabled = true, failReply = false
const missing = () => Object.assign(new Error('not found'), { code: 'RUN_NOT_FOUND' })
const runs = {
  async context(sessionId, userId) {
    assert.equal(userId, 'local-user')
    if (sessionId !== 'parent') throw new Error('Session not found')
    return { sessionId, cwd, modelId: 'native/model', approvalMode: 'auto-edit', thinkingLevel: null }
  },
  async start(input) {
    if (!records.has(input.requestId)) { starts++; records.set(input.requestId, { input, status: 'queued', waiting: [], summary: '' }) }
    if (failReply) { failReply = false; throw new Error('lost reply') }
    return { sessionId: input.sessionId, runId: input.requestId }
  },
  async status(runId, userId) {
    assert.equal(userId, 'local-user')
    const run = records.get(runId)
    if (!run) throw missing()
    return { ...run, runId, sessionId: run.input.sessionId }
  },
  async stop(runId, userId) {
    const run = await this.status(runId, userId)
    records.get(runId).status = 'aborted'
    return run
  },
}
const create = () => new NativeExecution({ runs, file, enabled: () => enabled, navigationTimeoutMs: 40 })
const call = (host, op, payload) => host.invoke({ adapter: 'task-board', version: 1, op, payload })
const payload = { taskId: 'task-1', executionId: 'execution-1', prompt: 'Read project notes', cwd, permission: 'read-only' }
let host = create()
let checks = 0
async function test(name, fn) { await fn(); checks++; console.log(`PASS ${name}`) }
try {
  await test('context needs an authenticated project; rejects foreign users', async () => {
    await assert.rejects(() => call(host, 'context'), /project session/)
    await host.configure('local-user', { sessionId: 'parent' })
    assert.equal((await call(host, 'context')).defaultModelId, 'native/model')
    await assert.rejects(() => host.configure('other-user', { sessionId: 'parent' }), /another local user/)
  })
  await test('launch owns deterministic native identities and deduplicates concurrent calls', async () => {
    const [a, b] = await Promise.all([call(host, 'launch', payload), call(host, 'launch', payload)])
    assert.deepEqual(a, b); assert.equal(starts, 1)
    const input = records.get(a.runId).input
    assert.equal(input.userId, 'local-user'); assert.equal(input.readOnly, true); assert.equal(input.parentSessionId, 'parent')
    assert.equal(Object.hasOwn(input, 'approvalMode'), false)
    await assert.rejects(() => call(host, 'launch', { ...payload, prompt: 'changed' }), /different input/)
    await assert.rejects(() => call(host, 'launch', { ...payload, executionId: '__proto__' }), /Invalid execution/)
  })
  await test('unmapped permissions, modes, models and projects fail closed', async () => {
    for (const extra of [{ permission: 'danger-full-access' }, { mode: 'dsh-coding' }, { modelId: 'foreign' }, { cwd: root }, { workspaceId: 'foreign' }]) {
      await assert.rejects(() => call(host, 'launch', { ...payload, executionId: 'rejected', ...extra }))
    }
    assert.equal(starts, 1)
  })
  await test('lost launch response recovers the existing run after engine restart', async () => {
    failReply = true
    await assert.rejects(() => call(host, 'launch', { ...payload, executionId: 'lost' }), /lost reply/)
    await host.dispose(); host = create(); await host.ready
    const status = await call(host, 'status', { executionId: 'lost' })
    assert.equal(status.state, 'queued'); assert.equal(starts, 2)
    const retry = await call(host, 'launch', { ...payload, executionId: 'lost' })
    assert.equal(starts, 2); assert.ok(records.has(retry.runId))
  })
  await test('approval waiting, success, failure and cancellation use native states', async () => {
    const record = host.data.executions['execution-1'], live = records.get(record.runId)
    live.status = 'running'; live.waiting = ['approval']
    assert.equal((await call(host, 'status', { executionId: 'execution-1' })).state, 'waiting')
    live.status = 'done'; live.summary = 'actual native summary'
    assert.equal((await call(host, 'status', { sessionId: 'forsion-task:execution-1' })).state, 'succeeded')
    live.status = 'error'; live.error = 'actual failure'
    assert.equal((await call(host, 'status', { executionId: 'execution-1' })).error, 'actual failure')
    live.status = 'running'; live.waiting = []
    assert.equal((await call(host, 'cancel', { executionId: 'execution-1' })).settled, true)
    assert.equal((await call(host, 'status', { executionId: 'execution-1' })).state, 'cancelled')
  })
  await test('persisted cancelled intent never creates a missing run', async () => {
    const ledger = JSON.parse(await readFile(file, 'utf8'))
    ledger.executions['execution-1'].started = false
    await host.dispose(); records.delete(ledger.executions['execution-1'].runId)
    await writeFile(file, JSON.stringify(ledger)); host = create(); await host.ready
    assert.equal((await call(host, 'status', { executionId: 'execution-1' })).state, 'cancelled')
    await call(host, 'launch', payload); assert.equal(starts, 2)
  })
  await test('restart retries a cancellation persisted before stop reached the native run', async () => {
    const ledger = JSON.parse(await readFile(file, 'utf8'))
    ledger.executions.lost.cancelRequested = true
    await host.dispose(); await writeFile(file, JSON.stringify(ledger)); host = create(); await host.ready
    assert.equal(records.get(ledger.executions.lost.runId).status, 'queued')
    assert.equal((await call(host, 'status', { executionId: 'lost' })).state, 'cancelled')
    assert.equal(starts, 2)
  })
  await test('openSession is acknowledged by the authenticated renderer, or rejects', async () => {
    const opened = call(host, 'openSession', { executionId: 'lost' })
    await new Promise(resolve => setTimeout(resolve, 0))
    const { events } = await host.pendingEvents('local-user'); assert.equal(events.length, 1)
    await assert.rejects(() => host.acknowledge('other-user', { eventId: events[0].eventId }), /another local user/)
    await host.acknowledge('local-user', { eventId: events[0].eventId })
    assert.deepEqual(await opened, { opened: true })
    await assert.rejects(() => call(host, 'openSession', { executionId: 'lost' }), /acknowledge/)
  })
  await test('private callback rejects unauthenticated and browser-origin requests', async () => {
    const endpoint = await host.listen()
    const body = JSON.stringify({ adapter: 'task-board', version: 1, op: 'context' })
    assert.equal((await fetch(endpoint.url, { method: 'POST', body })).status, 401)
    assert.equal((await fetch(endpoint.url, { method: 'POST', body, headers: { origin: 'https://other.test', 'x-dsh2forsion-native': endpoint.secret } })).status, 401)
    const response = await fetch(endpoint.url, { method: 'POST', body, headers: { 'x-dsh2forsion-native': endpoint.secret } })
    assert.equal(response.status, 200); assert.equal(Object.hasOwn(await response.json(), 'userId'), false)
  })
  await test('private callback preserves Unicode split across HTTP chunks', async () => {
    const endpoint = await host.listen()
    const originalInvoke = host.invoke
    const expected = { prompt: '检查发布 🌸', cwd: '项目/资料' }
    host.invoke = async value => value
    try {
      const body = Buffer.from(JSON.stringify(expected))
      const cut = body.indexOf(Buffer.from('检')) + 1
      const actual = await new Promise((resolve, reject) => {
        const req = request(endpoint.url, { method: 'POST', headers: { 'x-dsh2forsion-native': endpoint.secret } }, res => {
          const chunks = []
          res.on('data', chunk => chunks.push(chunk))
          res.on('end', () => resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))))
          res.on('error', reject)
        })
        req.on('error', reject)
        req.write(body.subarray(0, cut))
        setTimeout(() => req.end(body.subarray(cut)), 30)
      })
      assert.deepEqual(actual, expected)
    } finally { host.invoke = originalInvoke }
  })
  await test('disable revokes operations while preserving native history', async () => {
    enabled = false
    await assert.rejects(() => call(host, 'context'), /disabled/)
    assert.equal(records.size, 1)
    await host.dispose(); enabled = true
  })
  await test('continuing a task reuses its owned session with a distinct idempotent run', async () => {
    host = create(); await host.ready
    const previous = host.data.executions.lost
    const continued = await call(host, 'launch', { ...payload, executionId: 'continued', prompt: 'Continue the original task', resumeExecutionId: 'lost' })
    assert.equal(continued.sessionId, previous.sessionId)
    assert.notEqual(continued.runId, previous.runId)
    await assert.rejects(() => call(host, 'launch', { ...payload, executionId: 'foreign-resume', resumeExecutionId: 'foreign' }), /Unknown native/)
    await host.dispose()
  })
  await test('unreadable ledger is not treated as empty or overwritten', async () => {
    await writeFile(file, '{broken')
    host = create()
    await assert.rejects(() => host.ready)
    await assert.rejects(() => host.configure('local-user', { sessionId: 'parent' }))
    assert.equal(await readFile(file, 'utf8'), '{broken')
  })
  console.log(`${checks} native execution checks passed`)
} finally { await host.dispose(); await rm(root, { recursive: true, force: true }) }
