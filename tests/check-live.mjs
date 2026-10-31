// Real Tangu loader + Codex model + DSH plugins. All data is isolated.
// FORSION_AGENT=<Genesis>/tangu-agent DSH2FORSION_ROOT=<runtime> npm run test:live
// Optional DSH2FORSION_AUTH points to existing provider-auth.json. Never print it.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const agent = process.env.FORSION_AGENT
const runtime = process.env.DSH2FORSION_ROOT
const auth = process.env.DSH2FORSION_AUTH || join(homedir(), '.forsion-dev', 'provider-auth.json')
assert.ok(agent && existsSync(join(agent, 'dist/standalone/main.js')), 'Build FORSION_AGENT first')
assert.ok(runtime && existsSync(join(runtime, 'runtime')), 'Set DSH2FORSION_ROOT to the installed runtime')
assert.ok(existsSync(auth), 'Codex subscription authentication is required')
const out = mkdtempSync(join(tmpdir(), 'd2f-live-'))
const shared = join(out, 'forsion'), home = join(shared, 'tangu'), workspace = join(out, 'workspace')
for (const dir of [home, workspace]) mkdirSync(dir, { recursive: true })
cpSync(join(repo, 'plugin'), join(shared, 'plugins/dsh2forsion'), { recursive: true })
const data = join(home, 'plugin-data/dsh2forsion')
mkdirSync(data, { recursive: true })
for (const sub of ['node', 'runtime']) symlinkSync(join(runtime, sub), join(data, sub), process.platform === 'win32' ? 'junction' : 'dir')
const authLink = join(shared, 'provider-auth.json')
symlinkSync(auth, authLink)
const socket = createServer()
await new Promise(r => socket.listen(0, '127.0.0.1', r))
const port = socket.address().port
await new Promise(r => socket.close(r))
const token = randomUUID(), base = `http://127.0.0.1:${port}`, prefix = '/extensions/dsh2forsion/dsh2forsion'
const model = 'codex/gpt-6-luna', startedAt = new Date().toISOString(), results = []
const env = { ...process.env, TANGU_HOME: home, TANGU_DEFAULT_WORKSPACE: workspace, TANGU_BROWSER_CDP: 'off', TANGU_BROWSER_EXTENSION: '0', FORSION_DESKTOP_CONFIG: join(out, 'desktop-config.json') }
delete env.TANGU_PLUGINS_DIR
delete env.TANGU_BUNDLE_DIRS
delete env.TANGU_BACKEND_URL
env.TANGU_PLUGINS = 'on'
const child = spawn(process.execPath, [join(agent, 'dist/standalone/main.js'), '--host', '127.0.0.1', '--port', String(port), '--data-dir', join(home, 'state.db'), '--sandbox', 'off', '--cloud-url', 'http://127.0.0.1:9', '--token', token], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
for (const stream of [child.stdout, child.stderr]) stream.on('data', b => appendFileSync(join(out, 'engine.log'), b.toString().replaceAll(token, '[local-auth]')))
child.on('error', e => appendFileSync(join(out, 'engine.log'), String(e)))
const api = async (path, body) => {
  const res = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(300_000) })
  const value = await res.json()
  if (!res.ok) throw new Error(`${path}: ${res.status} ${JSON.stringify(value)}`)
  return value
}
const sleep = ms => new Promise(r => setTimeout(r, ms))
const until = async (fn, label, ms = 180_000) => {
  const end = Date.now() + ms
  while (Date.now() < end) { const value = await fn(); if (value) return value; await sleep(500) }
  throw new Error(`Timed out: ${label}`)
}
const save = () => writeFileSync(join(out, 'results.json'), JSON.stringify({ startedAt, model, only: ['dsh2forsion'], results }, null, 2))
async function test(key, name, fn) {
  const begin = Date.now(), row = { key, name, ok: false }
  results.push(row)
  try { await fn(row); row.ok = true; console.log(`PASS ${name}`) }
  catch (error) { row.error = String(error.stack || error); console.error(`FAIL ${name}: ${error.message}`); throw error }
  finally { row.ms = Date.now() - begin; save() }
}
function records(marker) {
  const file = join(workspace, 'dsh-probe.jsonl')
  return existsSync(file) ? readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse).filter(r => r.marker === marker) : []
}
async function run(label, message, tools, decision = 'approve', cancelMarker) {
  const config = { execMode: 'host', cwd: workspace, approvalMode: 'full-auto', toolsStrict: true, toolsMode: 'allow', toolsList: tools, enabledMcpServers: [], maxIterations: 12, thinkingLevel: 'low', debugSystemPrompt: true }
  const session = (await api('/agent/sessions', { title: `D2F ${label}`, model_id: model, project_path: workspace, agent_config: config })).session
  const { runId } = await api('/agent/runs', { session_id: session.id, model_id: model, message, agent_config: config })
  const trace = { sessionId: session.id, runId, events: [], content: '', approvals: [], calls: [], results: [] }
  const ac = new AbortController(), timer = setTimeout(() => ac.abort(), 240_000)
  let cancelTask
  try {
    const response = await fetch(`${base}/agent/runs/${runId}/events`, { headers: { Authorization: `Bearer ${token}` }, signal: ac.signal })
    assert.ok(response.ok && response.body, 'SSE opened')
    let buffer = ''
    outer: for await (const chunk of response.body) {
      buffer += Buffer.from(chunk).toString()
      let end
      while ((end = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, end); buffer = buffer.slice(end + 2)
        for (const line of frame.split('\n')) {
          if (!line.startsWith('data:')) continue
          const e = JSON.parse(line.slice(5)), p = e.payload || {}
          if (e.type !== 'system_prompt') trace.events.push(e)
          if (e.type === 'token') trace.content += p.delta || ''
          if (e.type === 'tool_call') trace.calls.push(p)
          if (e.type === 'tool_result') trace.results.push(p)
          if (e.type === 'approval_request') {
            trace.approvals.push(p)
            assert.ok(tools.includes(p.name), `unexpected approval: ${p.name}`)
            await api(`/agent/runs/${p.runId || runId}/approvals/${p.approvalId || p.id}`, { action: decision })
            if (cancelMarker && !cancelTask) cancelTask = until(() => records(cancelMarker).some(r => r.phase === 'started'), 'probe started', 20_000).then(() => api(`/agent/runs/${runId}/abort`, {}))
          }
          if (e.type === 'error') trace.error = p
          if (e.type === 'done' || e.type === 'error') { trace.terminal = e; break outer }
        }
      }
    }
    if (cancelTask) trace.abort = await cancelTask
    assert.ok(trace.terminal, 'run reached a terminal event')
    if (cancelMarker) {
      assert.equal(trace.error?.aborted, true, 'run reports cancellation')
      assert.equal(trace.abort?.settled, true, 'aborted run has settled')
      assert.equal(trace.abort?.status, 'aborted')
    } else {
      assert.equal(trace.terminal.type, 'done', JSON.stringify(trace.error))
      assert.equal(trace.error, undefined, 'model completed without an SSE error')
    }
    return trace
  } finally {
    clearTimeout(timer)
    await api(`/agent/runs/${runId}/abort`, {}).catch(() => {})
    writeFileSync(join(out, `${label}-evidence.json`), JSON.stringify(trace, null, 2))
  }
}

console.log(`live evidence: ${out}`)
try {
  await test('dshboot', 'Real Tangu bundle discovery and authenticated model availability', async () => {
    await until(() => api('/health').catch(() => null), 'engine health')
    const models = await api('/agent/models')
    assert.ok(JSON.stringify(models).includes(model), 'GPT 6 Luna available')
    unlinkSync(authLink)
    await until(async () => { const s = await api(prefix + '/status'); if (s.sidecar.state === 'failed') throw new Error(JSON.stringify(s.sidecar)); return s.sidecar.state === 'running' }, 'DSH ready')
    for (const spec of [`file:${join(repo, 'tests/fixtures/live-probe')}`, '@linxin666/dsh-client-ui-task-board@0.4.7', 'dsh-trae-skin@0.2.0']) {
      console.log(`install ${spec}`)
      const installed = await api(prefix + '/plugins/install', { spec })
      assert.equal(installed.status, 'installed', JSON.stringify(installed))
    }
  })
  const probe = 'dsh__acceptance_probe', suffix = randomUUID().slice(0, 8)
  await test('dshapprove', 'Real model approval and execution in the selected directory', async row => {
    const marker = `D2F-approve-${suffix}`
    const trace = await run('approve', `Call ${probe} exactly once with marker "${marker}" and waitMs 0. Report its returned marker and working directory. Do not use any other tool.`, [probe])
    row.output = trace.content
    assert.equal(trace.approvals.length, 1)
    assert.ok(trace.results.some(r => !r.isError && String(r.result).includes(marker)), 'successful real tool result')
    assert.deepEqual(records(marker).map(r => r.phase), ['started', 'finished'])
    assert.ok(records(marker).every(r => r.cwd.toLowerCase() === workspace.toLowerCase()))
  })
  await test('dshreject', 'Rejecting a real model approval never executes the tool', async row => {
    const marker = `D2F-reject-${suffix}`
    const trace = await run('reject', `Call ${probe} once with marker "${marker}" and waitMs 0. If permission is denied, stop immediately, do not retry, and explain that it was denied.`, [probe], 'reject')
    row.output = trace.content
    assert.ok(trace.approvals.length >= 1)
    assert.equal(records(marker).length, 0)
    assert.ok(trace.events.some(e => e.type === 'approval_result'), 'approval decision returned')
  })
  await test('dshcancel', 'Cancelling an approved model call stops DSH work', async () => {
    const marker = `D2F-cancel-${suffix}`
    await run('cancel', `Call ${probe} exactly once with marker "${marker}" and waitMs 30000. Wait for the result.`, [probe], 'approve', marker)
    await until(() => records(marker).some(r => r.phase === 'cancelled'), 'DSH observes cancellation', 10_000)
    assert.equal(records(marker).some(r => r.phase === 'finished'), false)
  })
  await test('dshtaskboard', 'Real third-party task board create/read/update/list through the model', async row => {
    const marker = `D2F-board-${suffix}`
    const tools = ['create', 'get', 'update', 'list'].map(x => `dsh__task_board_${x}`)
    const trace = await run('taskboard', `Use the task_board tools to create one local todo task titled "${marker}" with description "initial-${suffix}". Read it by its returned taskId, update its description to "updated-${suffix}", then list tasks with query "${marker}" and report the saved description. Do not run or schedule the task.`, tools)
    row.output = trace.content
    for (const name of tools) assert.ok(trace.results.some(r => r.name === name && !r.isError), `successful ${name}`)
    assert.ok(trace.results.some(r => String(r.result).includes(`updated-${suffix}`)))
    assert.ok(trace.approvals.length >= 4)
    writeFileSync(join(out, 'gui-seed.json'), JSON.stringify({ shared, workspace, marker, description: `updated-${suffix}`, model }))
  })
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
} finally {
  if (existsSync(authLink)) unlinkSync(authLink)
  child.kill()
  await Promise.race([new Promise(r => child.once('exit', r)), sleep(5000)])
  if (child.exitCode === null) child.kill('SIGKILL')
  save()
  writeFileSync(join(out, 'report.md'), `# DSH2Forsion real model acceptance\n\nModel: ${model}\n\n${results.map(r => `- ${r.ok ? 'PASS' : 'FAIL'} ${r.name}${r.error ? ': ' + r.error : ''}`).join('\n')}\n`)
  console.log(`results: ${results.filter(r => r.ok).length}/${results.length}; ${out}`)
}
