// Real native Tangu source -> official DSH single inference -> original local
// Codex relay. Exactly two GPT 6 Luna calls; protocol edge cases use marked fixtures.
// FORSION_AGENT=<built worktree/tangu-agent> DSH2FORSION_ROOT=<existing plugin-data> node tests/check-models-live.mjs
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomUUID, createHash } from 'node:crypto'
import { mkdir, mkdtemp, cp, symlink, readFile, writeFile, appendFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createServer } from 'node:net'
import { layout } from '../src/engine/layout.mjs'
import { ensureProfile, ensureBridge, profileDir } from '../src/engine/profile.mjs'
import { startNativeModelRelay } from './helpers/native-model-relay.mjs'
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const agent = resolve(process.env.FORSION_AGENT || join(repo, '../.worktrees/genesis-dsh-skills/tangu-agent'))
const runtime = process.env.DSH2FORSION_ROOT
const authFile = process.env.DSH2FORSION_AUTH || join(homedir(), '.forsion-dev/provider-auth.json')
assert.ok(runtime && existsSync(join(runtime, 'runtime')), 'Set DSH2FORSION_ROOT to the existing managed runtime')
assert.ok(existsSync(join(agent, 'dist/standalone/main.js')), 'Build the current model-source host first')
assert.ok(existsSync(authFile), 'The authorized existing Codex subscription credential file is required')
await mkdir(join(repo, '.tmp'), { recursive: true })
const out = await mkdtemp(join(repo, '.tmp', 'models-live-'))
const built = join(out, 'built-plugin'), shared = join(out, 'forsion'), home = join(shared, 'tangu'), workspace = join(out, 'workspace')
for (const dir of [shared, home, workspace]) await mkdir(dir, { recursive: true })
const report = { startedAt: new Date().toISOString(), model: 'codex/gpt-6-luna', liveCallLimit: 2, phases: [], ok: false }
const command = (exe, args) => new Promise((resolve, reject) => {
  const p = spawn(exe, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); let output = ''
  for (const stream of [p.stdout, p.stderr]) stream.on('data', bytes => { output += bytes })
  p.on('error', reject); p.on('exit', code => code === 0 ? resolve(output) : reject(new Error(`Fixture build failed (${code})`)))
})
assert.ok(built.startsWith(join(repo, '.tmp') + (process.platform === 'win32' ? '\\' : '/')))
await command(process.execPath, [join(repo, 'build.mjs'), built])
const bundle = join(shared, 'plugins/dsh2forsion')
await mkdir(dirname(bundle), { recursive: true }); await cp(built, bundle, { recursive: true })
const data = join(home, 'plugin-data/dsh2forsion')
await mkdir(data, { recursive: true })
for (const sub of ['node', 'runtime']) await symlink(join(resolve(runtime), sub), join(data, sub), process.platform === 'win32' ? 'junction' : 'dir')
const relay = await startNativeModelRelay({ agentDir: agent, authFile, maxLiveCalls: 2 })
let child
try {
const auditFile = join(out, 'dsh-inference-scope.jsonl')
const audit = join(out, 'dsh-audit')
await mkdir(audit)
await writeFile(join(audit, 'package.json'), JSON.stringify({ name: 'native-model-audit-fixture', version: '1.0.0', type: 'module', main: 'index.js' }))
await writeFile(join(audit, 'index.js'), `import {appendFile} from 'node:fs/promises';export const inject=['agents'];export function apply(ctx){ctx.on('llm/stream',async function*(options,next){await appendFile(${JSON.stringify(auditFile)},JSON.stringify({scope:ctx.agents.currentInitiator()?.session.id??null,provider:options.provider,model:options.model})+'\\n');yield*next()})}`)
const paths = layout(data)
await ensureProfile(paths, paths.home)
await ensureBridge(paths, paths.home, join(bundle, 'tangu-plugins/dsh2forsion/dsh-bridge'))
const profile = profileDir(paths.home)
await mkdir(join(profile, 'node_modules'), { recursive: true })
await symlink(audit, join(profile, 'node_modules/native-model-audit-fixture'), process.platform === 'win32' ? 'junction' : 'dir')
await writeFile(join(profile, 'cordis.patch.yml'), `- id: llm-pi-ai\n  disabled: true\n- insert:\n    - id: native-model-relay-fixture\n      name: '@deepseek-ai/dsh-llm-pi-ai'\n      config:\n        providers:\n          native-model-relay:\n            displayName: Native model relay fixture\n            api: openai-completions\n            baseURL: ${JSON.stringify(relay.url)}\n            headers:\n              Authorization: Bearer original-local-fixture\n            compat:\n              thinkingFormat: deepseek\n            retryPolicy:\n              mode: normal\n              maxRetries: 0\n            models:\n              - id: gpt-6-luna\n                name: GPT 6 Luna relay fixture\n                contextWindow: 262144\n                reasoningEfforts:\n                  off:\n                  low: low\n    - id: native-model-audit-fixture\n      name: native-model-audit-fixture\n`)
const fixture = join(bundle, 'tangu-plugins/native-model-fixture')
await mkdir(fixture, { recursive: true })
await writeFile(join(fixture, 'package.json'), JSON.stringify({ type: 'module' }))
await writeFile(join(fixture, 'tangu-plugin.json'), JSON.stringify({ id: 'native-model-fixture', name: 'Native model fixture', version: '1.0.0', apiVersion: 1, entry: 'index.js' }))
const moduleUrl = file => pathToFileURL(join(agent, 'dist', file)).href
await writeFile(join(fixture, 'index.js'), `
import {appendFile} from 'node:fs/promises';import{randomUUID}from'node:crypto';
import {withPluginModelProviders} from ${JSON.stringify(moduleUrl('llm/pluginModels.js'))};
import {runWithUserAgentScope,enterRunContext,setRunSessionContext,setRunCwd} from ${JSON.stringify(moduleUrl('seams/runContext.js'))};
export default {activate(ctx){
ctx.registerToolProvider({id:'native-model-fixture',tools:()=>[{name:'native_model_probe',definition:{type:'function',function:{name:'native_model_probe',description:'Original native model acceptance fixture; returns the supplied marker and native project.',parameters:{type:'object',properties:{marker:{type:'string'}},required:['marker']}}},capabilities:{sideEffect:'unknown',approval:'always',automationSafe:false,externalMcp:true},execute:async(args,toolCtx)=>{const value={marker:args.marker,cwd:toolCtx.cwd};await appendFile(${JSON.stringify(join(out, 'native-tool.jsonl'))},JSON.stringify(value)+'\\n');return JSON.stringify(value)}}]});
ctx.registerScopedRoutes(router=>router.post('/infer',async(req,res)=>{const ac=new AbortController();let timer;res.once('close',()=>ac.abort());try{const value=await runWithUserAgentScope(req.body.fixtureUser,'model-fixture',async()=>{enterRunContext(req.body.fixtureUser,randomUUID());setRunSessionContext(req.body.fixtureSession,false);setRunCwd(${JSON.stringify(workspace)});const reject=()=>{throw new Error('Non-plugin inference is forbidden in this fixture')};const brain=withPluginModelProviders({models:{},llm:{resolveModelAndKey:reject,buildProviderPayload:reject,streamProviderCompletion:reject}});const selected=await brain.llm.resolveModelAndKey(req.body.modelId);const payload=await brain.llm.buildProviderPayload({model:selected.model,apiModelId:selected.apiModelId,messages:[{role:'user',content:req.body.message}],toolChoice:'none',maxTokens:128});if(req.body.cancel)timer=setTimeout(()=>ac.abort(new Error('Fixture cancelled')),300);return brain.llm.streamProviderCompletion({apiKey:'',baseUrl:'',payload,signal:ac.signal})});res.json(value)}catch(error){res.status(400).json({error:'Protocol inference rejected',name:error.name})}finally{clearTimeout(timer)}}));
}}
`)
const freePort = createServer(); await new Promise(resolve => freePort.listen(0, '127.0.0.1', resolve)); const port = freePort.address().port; await new Promise(resolve => freePort.close(resolve))
const token = randomUUID(), base = `http://127.0.0.1:${port}`, prefix = '/extensions/dsh2forsion/dsh2forsion', fixturePrefix = '/extensions/dsh2forsion/native-model-fixture'
const env = { ...process.env, TANGU_HOME: home, TANGU_DEFAULT_WORKSPACE: workspace, TANGU_PLUGINS: 'on', TANGU_BROWSER_CDP: 'off', TANGU_BROWSER_EXTENSION: '0', FORSION_DESKTOP_CONFIG: join(out, 'desktop-config.json') }
for (const key of ['TANGU_PLUGINS_DIR', 'TANGU_BUNDLE_DIRS', 'TANGU_BACKEND_URL']) delete env[key]
child = spawn(process.execPath, [join(agent, 'dist/standalone/main.js'), '--host', '127.0.0.1', '--port', String(port), '--data-dir', join(home, 'state.db'), '--sandbox', 'off', '--cloud-url', 'http://127.0.0.1:9', '--token', token], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
for (const stream of [child.stdout, child.stderr]) stream.on('data', bytes => { void appendFile(join(out, 'engine.log'), bytes.toString().split(token).join('[local-auth]').replace(/\?token=\S+/g,'?token=[local-auth]')) })
const api = async (path, body, method = body === undefined ? 'GET' : 'POST') => {
  const response = await fetch(base + path, { method, headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(180_000) })
  const value = await response.json(); if (!response.ok) throw new Error(`${path} rejected (${response.status})`); return value
}
const until = async (fn, label, ms = 120_000) => { const end = Date.now() + ms; for (;;) { const value = await fn(); if (value) return value; if (Date.now() > end) throw new Error(`Timed out: ${label}`); await new Promise(resolve => setTimeout(resolve, 300)) } }
const objects = value => value && typeof value === 'object' ? [value, ...Object.values(value).flatMap(objects)] : []
const modelFrom = value => objects(value).find(value => typeof value.id === 'string' && value.id.startsWith('plugin:') && String(value.name).includes('Luna relay fixture'))?.id
const protocol = (modelId, fixtureUser, fixtureSession, message, extra = {}) => api(fixturePrefix + '/infer', { modelId, fixtureUser, fixtureSession, message, ...extra })
  await until(() => api('/health').catch(() => null), 'native host health')
  await until(async () => { const state = (await api(prefix + '/status')).sidecar; if (state.state === 'failed') throw new Error(`Fixture DSH startup failed: ${state.error}`); return state.state === 'running' }, 'real DSH sidecar')
  const modelId = await until(async () => modelFrom(await api('/agent/models')), 'native DSH model source in host directory')
  report.modelId = modelId
  const tools = await api('/agent/plugins/external-tools')
  const tool = tools.tools.find(tool => tool.description?.includes('Original native model acceptance fixture'))
  assert.ok(tool, 'original native fixture tool loaded')
  const smoke = await protocol(modelId, 'protocol-smoke-user', 'protocol-smoke-session', 'MODEL_PROTOCOL_BOOT')
  assert.match(smoke.content, /MODEL_PROTOCOL_OK/, 'deterministic provider smoke passes before spending model quota')
  const config = { execMode: 'host', cwd: workspace, approvalMode: 'auto-edit', toolsStrict: true, toolsMode: 'allow', toolsList: [tool.name], enabledMcpServers: [], maxIterations: 3, thinkingLevel: 'off' }
  const session = (await api('/agent/sessions', { title: 'Native DSH model live acceptance', model_id: modelId, project_path: workspace, agent_config: config })).session
  const marker = 'MODEL_SOURCE_OK'
  const { runId } = await api('/agent/runs', { session_id: session.id, model_id: modelId, message: `Call ${tool.name} exactly once with marker "${marker}". After the tool result, answer only ${marker}. Use no other tools.`, agent_config: config })
  const trace = { runId, sessionId: session.id, events: [], content: '', approvals: [] }
  const response = await fetch(`${base}/agent/runs/${runId}/events`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(180_000) })
  let buffer = ''
  outer: for await (const bytes of response.body) {
    buffer += Buffer.from(bytes).toString(); let boundary
    while ((boundary = buffer.indexOf('\n\n')) >= 0) {
      const frame = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2)
      for (const line of frame.split('\n')) if (line.startsWith('data:')) {
        const event = JSON.parse(line.slice(5)), payload = event.payload || {}
        if (event.type !== 'system_prompt') trace.events.push(event)
        if (event.type === 'token') trace.content += payload.delta || ''
        if (event.type === 'approval_request') { assert.equal(payload.name, tool.name); trace.approvals.push(payload); await api(`/agent/runs/${payload.runId || runId}/approvals/${payload.approvalId || payload.id}`, { action: 'approve' }) }
        if (event.type === 'done' || event.type === 'error') { trace.terminal = event; break outer }
      }
    }
  }
  report.phases.push({ name: 'real-luna-native-tool-and-answer', trace })
  assert.equal(trace.terminal?.type, 'done', JSON.stringify(trace.terminal))
  assert.equal(trace.approvals.length, 1)
  assert.match(trace.content, /MODEL_SOURCE_OK/)
  assert.ok(trace.events.some(event => event.type === 'tool_result' && !event.payload?.isError))
  assert.equal(relay.liveCalls, 2, 'one real tool request and one real final answer, no hidden inference loop')
  assert.ok(relay.records.filter(row => row.mode === 'real-luna').every(row => row.usage?.prompt_tokens > 0 && row.usage?.completion_tokens > 0), 'authoritative usage traversed the real provider')
  console.log('PASS real Luna: native model source, tool approval/execution, final answer and usage (2 calls)')

  const values = await Promise.all([
    protocol(modelId, 'scope-user-A', 'same-session', 'MODEL_PROTOCOL_SCOPE_A'),
    protocol(modelId, 'scope-user-B', 'same-session', 'MODEL_PROTOCOL_SCOPE_B'),
    protocol(modelId, 'scope-user-A', 'other-session', 'MODEL_PROTOCOL_SCOPE_C'),
  ])
  assert.ok(values.every(value => value.content.includes('MODEL_PROTOCOL_OK')))
  const scopes = (await readFile(auditFile, 'utf8')).trim().split('\n').map(line => JSON.parse(line)).map(row => row.scope)
  for (const [user, sessionId] of [['scope-user-A', 'same-session'], ['scope-user-B', 'same-session'], ['scope-user-A', 'other-session']]) {
    const expected = 'dsh2forsion-session-' + createHash('sha256').update(JSON.stringify([user, sessionId])).digest('hex')
    assert.ok(scopes.includes(expected), 'same cwd synthetic users and sessions reach distinct real DSH initiator scopes')
  }
  await assert.rejects(protocol(modelId, 'scope-user-A', 'cancel-session', 'MODEL_PROTOCOL_CANCEL', { cancel: true }))
  await until(() => relay.records.some(row => row.waiting && row.cancelled), 'provider cancellation reaches relay', 15_000)
  report.phases.push({ name: 'deterministic-protocol-scope-and-cancel', syntheticScopeCount: 3, nativeContextInjection: true })
  const pending = protocol(modelId, 'scope-user-A', 'disable-session', 'MODEL_PROTOCOL_CANCEL_DISABLE').then(() => false, () => true)
  await until(() => relay.records.filter(row => row.waiting).length >= 2, 'disable fixture request started', 15_000)
  await api('/agent/plugins/dsh2forsion/enabled', { enabled: false }, 'PUT')
  assert.equal(await pending, true, 'disable revokes in-flight native model source')
  assert.equal(modelFrom(await api('/agent/models')), undefined, 'disabled source leaves no native directory entry')
  await assert.rejects(protocol(modelId, 'scope-user-A', 'after-disable', 'MODEL_PROTOCOL_SCOPE_DISABLED'))
  assert.equal(relay.liveCalls, 2, 'protocol edge cases consume no additional real model calls')
  report.phases.push({ name: 'deterministic-protocol-disable', revoked: true, directoryRemoved: true })
  report.ok = true
  console.log(`check-models-live passed; evidence ${out}`)
} catch (error) { report.error = String(error.stack || error); throw error }
finally {
  report.relay = relay.records; report.liveCalls = relay.liveCalls
  await writeFile(join(out, 'results.json'), JSON.stringify(report, null, 2))
  child?.kill('SIGTERM'); await relay.close()
}
