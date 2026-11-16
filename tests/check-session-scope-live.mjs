// Real DSH factory/session/persistence/archive/ALS/approval validation; no model calls.
// DSH2FORSION_ROOT points to an existing managed runtime root (node/ and runtime/).
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { cp, mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { layout } from '../src/engine/layout.mjs'
import { ensureProfile, profileDir } from '../src/engine/profile.mjs'
import { Sidecar } from '../src/engine/sidecar.mjs'
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sourceRoot = process.env.DSH2FORSION_ROOT
assert.ok(sourceRoot, 'Set DSH2FORSION_ROOT to an installed managed runtime root')
await mkdir(join(repo, '.tmp'), { recursive: true })
const root = await mkdtemp(join(repo, '.tmp', 'session-scope-live-'))
const data = join(root, 'data'), home = join(data, 'home'), fixture = join(root, 'fixture'), cwd = join(root, 'workspace')
for (const dir of [data, fixture, cwd]) await mkdir(dir, { recursive: true })
for (const sub of ['node', 'runtime']) await symlink(join(resolve(sourceRoot), sub), join(data, sub), process.platform === 'win32' ? 'junction' : 'dir')
await cp(join(repo, 'src/dsh-bridge/session-scope.js'), join(fixture, 'session-scope.js'))
await writeFile(join(fixture, 'package.json'), JSON.stringify({ name: 'dsh-session-scope-live-fixture', version: '1.0.0', type: 'module', main: 'index.js' }))
await writeFile(join(fixture, 'index.js'), String.raw`
import { SessionScopePool } from './session-scope.js'
export const name = 'session-scope-live-fixture'
export const inject = ['agents','sessionProjections','webServer','workspaceRegistry','tools','approval','sessionPersistence']
export function apply(ctx) {
  let pool = new SessionScopePool(ctx)
  ctx.effect(() => () => pool.dispose())
  ctx.on('approval/request', () => 'allowed-once', { prepend: true })
  ctx.tools.register({ name: 'scope_fixture_probe', description: 'Original local test fixture', parameters: { type: 'object', properties: {} }, output: { schema: { type: 'object', properties: {scope:{type:'string'},initiator:{type:'string'}}, required:['scope','initiator'] }, render: (_args,value) => [{type:'text',text:JSON.stringify(value)}] }, execute: async (_args,exec) => ({ scope:exec.agent.session.id, initiator:ctx.agents.currentInitiator()?.session.id }) })
  ctx.webServer.register({kind:'prefix',path:'/forsion-bridge',handler:async(req,res)=>{
    if(req.headers['x-dsh2forsion-secret']!==process.env.DSH2FORSION_SECRET){res.writeHead(401);res.end('{}');return}
    const send=(status,value)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value))}
    if(req.url==='/forsion-bridge/health'){send(200,{ok:true});return}
    try {
      let body='';for await(const chunk of req)body+=chunk
      const input=JSON.parse(body||'{}')
      if(input.action==='dispose') {
        const ids=input.ids
        let entered, observedAbort=false
        const ready=new Promise(resolve=>{entered=resolve})
        const active=pool.withInitiator(input.a,undefined,async(_agent,signal)=>{
          entered()
          await new Promise(resolve=>signal.addEventListener('abort',resolve,{once:true}))
          observedAbort=signal.aborted
          return 'late-result-must-not-publish'
        }).then(()=>false,()=>true)
        await ready
        await pool.dispose()
        const activeRejected=await active
        const live=ids.map(id=>Boolean(ctx.agents.get(id)))
        let rejected=false;try{await pool.get(input.a)}catch{rejected=true}
        pool=new SessionScopePool(ctx)
        send(200,{live,rejected,observedAbort,activeRejected});return
      }
      const [a,b,same]=await Promise.all([pool.get(input.a),pool.get(input.b),pool.get(input.a)])
      const ids=[a.session.id,b.session.id]
      const before=a.session.snapshotEvents().map(event=>event.type)
      const inference=await pool.withInitiator(input.a,undefined,async(agent,signal)=>{
        const observed=[]
        async function* stream(){yield 1;await Promise.resolve();yield 2}
        for await(const part of stream()){signal.throwIfAborted();observed.push({part,id:ctx.agents.currentInitiator()?.session.id})}
        return observed
      })
      const parallel=await Promise.all([input.a,input.b].map(identity=>pool.withInitiator(identity,undefined,async(agent,signal)=>{
        const observed=[ctx.agents.currentInitiator()?.session.id]
        await new Promise(resolve=>setImmediate(resolve))
        signal.throwIfAborted()
        observed.push(ctx.agents.currentInitiator()?.session.id)
        return observed
      })))
      const tool=await pool.execute(input.a,undefined,async(agent,signal)=>{
        const approval=await ctx.approval.request({agent,toolName:'scope_fixture_probe',callId:'scope-live-probe',signal})
        if(approval!=='allowed-once')throw new Error('Original fixture approval was not allowed')
        const result=await ctx.tools.execute({agent,signal,callId:'scope-live-probe',name:'scope_fixture_probe',arguments:{}})
        return {approval,result}
      })
      const events=a.session.snapshotEvents().map(event=>({type:event.type,data:event.type.startsWith('approval/')||event.type.startsWith('turn/')?event.data:undefined}))
      send(200,{ids,same:a===same,cwds:[a.session.header.cwd,b.session.header.cwd],archived:ids.map(id=>ctx.workspaceRegistry.archivedSessionIds.includes(id)),registered:ids.map(id=>ctx.agents.get(id)=== (id===ids[0]?a:b)),before,inference,parallel,tool,events,status:[a.status,b.status],stored:await Promise.all(ids.map(id=>ctx.sessionPersistence.stat(id).then(value=>Boolean(value))))})
    }catch(error){send(500,{error:String(error?.stack||error)})}
  }})
}
`)
const paths = layout(data)
const results = { root, startedAt: new Date().toISOString(), phases: [], ok: false }
const sidecar = new Sidecar(paths, { home })
const saveLog = async label => {
  const scrub = text => [sidecar.secret, sidecar.token].filter(Boolean).reduce((value, secret) => value.split(secret).join('[local-auth]'), text)
  await writeFile(join(root, `${label}.log`), scrub(sidecar.lines.join('\n')))
}
const sessionKey = native => createHash('sha256').update(JSON.stringify(['fixture-local-user', native])).digest('hex')
const a = { sessionKey: sessionKey('A'), cwd }, b = { sessionKey: sessionKey('B'), cwd }
try {
  await ensureProfile(paths, home)
  const p = profileDir(home)
  await mkdir(join(p, 'node_modules'), { recursive: true })
  await symlink(fixture, join(p, 'node_modules/dsh-session-scope-live-fixture'), process.platform === 'win32' ? 'junction' : 'dir')
  await writeFile(join(p, 'cordis.patch.yml'), "- insert:\n    - id: session-scope-live-fixture\n      name: dsh-session-scope-live-fixture\n")
  const runPhase = async label => {
    await sidecar.start()
    const response = await sidecar.bridge('/test', { method: 'POST', body: JSON.stringify({ a, b }), signal: AbortSignal.timeout(60_000) })
    results.phases.push({ label, response })
    assert.notEqual(response.ids[0], response.ids[1])
    assert.equal(response.same, true)
    assert.deepEqual(response.cwds, [cwd, cwd])
    assert.deepEqual(response.archived, [true, true])
    assert.deepEqual(response.registered, [true, true])
    assert.deepEqual(response.stored, [true, true])
    assert.ok(response.inference.every(chunk => chunk.id === response.ids[0]))
    assert.ok(response.parallel.every((observed,index)=>observed.every(id=>id===response.ids[index])), 'concurrent real initiator scopes remain isolated')
    assert.equal(response.tool.approval, 'allowed-once')
    assert.equal(response.tool.result.isError, false, JSON.stringify(response.tool))
    assert.equal(response.tool.result.value.scope, response.ids[0])
    assert.equal(response.tool.result.value.initiator, response.ids[0])
    const types = response.events.map(event => event.type)
    assert.ok(types.includes('approval/asked') && types.includes('approval/decided'))
    assert.ok(types.indexOf('turn/start') < types.indexOf('approval/asked'))
    assert.ok(types.lastIndexOf('turn/end') > types.lastIndexOf('approval/decided'))
    assert.ok(!types.some(type => type === 'user/message' || type === 'assistant/message' || type === 'request/header'), 'no fabricated conversation/model requests')
    await saveLog(label)
    await writeFile(join(root, 'results.json'), JSON.stringify(results, null, 2))
    console.log(`PASS real DSH session scope: ${label}`)
    return response
  }
  const first = await runPhase('first')
  const disposed = await sidecar.bridge('/test', { method: 'POST', body: JSON.stringify({ action: 'dispose', a, ids: first.ids }) })
  results.dispose = disposed
  assert.deepEqual(disposed.live, [false, false])
  assert.equal(disposed.rejected, true)
  assert.equal(disposed.observedAbort, true)
  assert.equal(disposed.activeRejected, true)
  const reload = await runPhase('reload')
  assert.deepEqual(reload.ids, first.ids)
  assert.ok(reload.before.includes('approval/asked'), 'new pool resumes the actual persisted audit log')
  await sidecar.stop()
  const restarted = await runPhase('restart')
  assert.deepEqual(restarted.ids, first.ids)
  assert.ok(restarted.before.includes('approval/asked'), 'new DSH process resumes durable session events')
  results.ok = true
  console.log(`check-session-scope-live: real DSH scope identity/archive/approval/ALS/reload/restart/dispose passed; evidence ${root}`)
} catch (error) {
  results.error = String(error.stack || error)
  await saveLog('failure')
  throw error
} finally {
  await sidecar.stop()
  await writeFile(join(root, 'results.json'), JSON.stringify(results, null, 2))
}
