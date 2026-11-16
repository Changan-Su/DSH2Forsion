// Fixed-version original Billion activation + native Tangu model source.
// Hard-limited upstream requests include hidden proxy summary calls.
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, cp, symlink, writeFile, readFile, appendFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { homedir } from 'node:os'
import { layout } from '../src/engine/layout.mjs'
import { ensureProfile, ensureBridge, profileDir, dsh } from '../src/engine/profile.mjs'
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const agent = resolve(process.env.FORSION_AGENT || join(repo, '../.worktrees/genesis-dsh-skills/tangu-agent'))
const sourceRoot = process.env.DSH2FORSION_ROOT
const authFile = process.env.DSH2FORSION_AUTH || join(homedir(), '.forsion-dev/provider-auth.json')
const upstreamLimit = Number(process.env.BILI_FIXTURE_UPSTREAM_LIMIT || 2)
assert.ok(Number.isSafeInteger(upstreamLimit) && upstreamLimit >= 1 && upstreamLimit <= 3)
assert.ok(sourceRoot && existsSync(join(sourceRoot, 'runtime')), 'Set DSH2FORSION_ROOT')
assert.ok(existsSync(join(agent, 'dist/standalone/main.js')) && existsSync(authFile), 'Built host and authorized Codex credential path are required')
await mkdir(join(repo, '.tmp'), { recursive: true })
const out = await mkdtemp(join(repo, '.tmp', 'billion-live-'))
const shared = join(out, 'forsion'), home = join(shared, 'tangu'), workspace = join(out, 'workspace'), built = join(out, 'built-plugin')
const xdg = Object.fromEntries(['CONFIG','DATA','CACHE','STATE'].map(key => [`XDG_${key}_HOME`, join(out, 'xdg', key.toLowerCase())]))
const temp = join(out, 'temp')
for (const dir of [shared, home, workspace, temp, ...Object.values(xdg)]) await mkdir(dir, { recursive: true })
Object.assign(process.env,xdg,{TEMP:temp,TMP:temp,TMPDIR:temp})
const requests = [], denied = []
const budget = createServer(async (req, res) => {
  try { let raw='';for await(const part of req)raw+=part;const record=JSON.parse(raw);if(requests.length>=upstreamLimit){denied.push({pid:record.pid,pathname:record.pathname});res.writeHead(429);res.end('{}');return}requests.push(record);await writeFile(join(out,'upstream-requests.json'),JSON.stringify(requests,null,2));res.writeHead(200);res.end('{}') }
  catch {res.writeHead(400);res.end('{}')}
})
await new Promise(resolve => budget.listen(0,'127.0.0.1',resolve))
const budgetUrl = `http://127.0.0.1:${budget.address().port}/claim`
const result = { version:'0.1.201', startedAt:new Date().toISOString(), ok:false, budget:upstreamLimit, scope:'single-inference native model-source fixture; no Tangu historian or conversation DB seeding', originalPackageScriptsExecuted:false }
let child, proxyOrigin, api, token
const until = async (fn,label,ms=120000) => {const end=Date.now()+ms;for(;;){const v=await fn();if(v)return v;if(Date.now()>end)throw new Error('Timed out: '+label);await new Promise(resolve=>setTimeout(resolve,300))}}
const command = (exe,args) => new Promise((resolve,reject)=>{const p=spawn(exe,args,{windowsHide:true,stdio:['ignore','pipe','pipe']});p.on('error',reject);p.on('exit',code=>code===0?resolve():reject(new Error('Isolated fixture build failed')))})
try {
  await command(process.execPath,[join(repo,'build.mjs'),built])
  const bundle=join(shared,'plugins/dsh2forsion');await mkdir(dirname(bundle),{recursive:true});await cp(built,bundle,{recursive:true})
  const data=join(home,'plugin-data/dsh2forsion');await mkdir(data,{recursive:true})
  for(const sub of ['node','runtime'])await symlink(join(resolve(sourceRoot),sub),join(data,sub),process.platform==='win32'?'junction':'dir')
  const paths=layout(data);await ensureProfile(paths,paths.home);await ensureBridge(paths,paths.home,join(bundle,'tangu-plugins/dsh2forsion/dsh-bridge'))
  const install=await dsh(paths,paths.home,['plugin','--profile','forsion','add','--ignore-scripts','billion-context@0.1.201'])
  await writeFile(join(out,'install.log'),install.out)
  assert.equal(install.code,0,'fixed official package installs with scripts disabled')
  const packageDir=join(profileDir(paths.home),'node_modules/billion-context')
  const fixture=join(out,'dsh-fixture');await mkdir(fixture)
  const budgetModule=join(repo,'tests/helpers/billion-fixture/upstream-budget.mjs')
  const config=join(xdg.XDG_CONFIG_HOME,'billion-context/billion-context.json');await mkdir(dirname(config),{recursive:true})
  await writeFile(config,JSON.stringify({host:'127.0.0.1',autoUpdate:false,persist:{enabled:false},diagnostics:{noInjectTool:true,noCompressPrompt:true},compress:{modelContextLimit:2000,maxContextLimit:'75%',emergencyThresholdPercent:'95%',preserveRecentMessages:1,preserveRecentTokens:0,minCompressRangeChars:100,minPressureBenefitTokens:0,nudgeModelDecided:false,streamSummary:true,tiers:false,maxSummaryLength:400},security:{adminRelay:false}},null,2))
  await writeFile(join(fixture,'package.json'),JSON.stringify({name:'billion-native-codex-fixture',version:'1.0.0',type:'module',main:'index.js'}))
  await writeFile(join(fixture,'index.js'),`import{fixturePlugin}from${JSON.stringify(pathToFileURL(join(repo,'tests/helpers/billion-fixture/direct-provider.mjs')).href)};const plugin=fixturePlugin(${JSON.stringify({runtimeDir:paths.runtimeDir,packageDir,expectedNativeHash:'fe1d610014672bb50b8271e45e18c202b850d07a158999baac4f3e9f5a3db69e',budgetUrl,budgetModule,agentDir:agent,authFile,proxyConfig:config})});export const inject=plugin.inject;export const apply=plugin.apply;`)
  await symlink(fixture,join(profileDir(paths.home),'node_modules/billion-native-codex-fixture'),process.platform==='win32'?'junction':'dir')
  await writeFile(join(profileDir(paths.home),'cordis.patch.yml'),`- id: agent-default-model\n  config:\n    provider: native-codex-fixture\n    model: gpt-6-luna\n    reasoningEffort: low\n- id: bili-native\n  inject: [nativeBillionFixtureReady]\n- insert:\n    - id: billion-native-codex-fixture\n      name: billion-native-codex-fixture\n`)
  const native=join(bundle,'tangu-plugins/billion-native-fixture');await mkdir(native)
  await writeFile(join(native,'package.json'),JSON.stringify({type:'module'}))
  await writeFile(join(native,'tangu-plugin.json'),JSON.stringify({id:'billion-native-fixture',name:'Billion single-inference acceptance fixture',version:'1.0.0',apiVersion:1,entry:'index.js'}))
  const mod=file=>pathToFileURL(join(agent,'dist',file)).href
  await writeFile(join(native,'index.js'),`import{randomUUID}from'node:crypto';import{withPluginModelProviders}from${JSON.stringify(mod('llm/pluginModels.js'))};import{runWithUserAgentScope,enterRunContext,setRunSessionContext,setRunCwd}from${JSON.stringify(mod('seams/runContext.js'))};export default{activate(ctx){ctx.registerScopedRoutes(router=>router.post('/infer',async(req,res)=>{const ac=new AbortController();res.once('close',()=>{if(!res.writableEnded)ac.abort()});try{const answer=await runWithUserAgentScope('billion-fixture-user','fixture',async()=>{enterRunContext('billion-fixture-user',randomUUID());setRunSessionContext('billion-fixture-session',false);setRunCwd(${JSON.stringify(workspace)});const bad=()=>{throw new Error('Only native plugin model inference is allowed')};const brain=withPluginModelProviders({models:{},llm:{resolveModelAndKey:bad,buildProviderPayload:bad,streamProviderCompletion:bad}});const selected=await brain.llm.resolveModelAndKey(req.body.modelId);const payload=await brain.llm.buildProviderPayload({model:selected.model,apiModelId:selected.apiModelId,messages:req.body.messages,toolChoice:'none',maxTokens:512,thinkingLevel:'low'});return brain.llm.streamProviderCompletion({apiKey:'',baseUrl:'',payload,signal:ac.signal})});res.json(answer)}catch(error){res.status(400).json({error:String(error.message)})}}))}}`)
  const free=createServer();await new Promise(resolve=>free.listen(0,'127.0.0.1',resolve));const port=free.address().port;await new Promise(resolve=>free.close(resolve));token=randomUUID();const base=`http://127.0.0.1:${port}`
  const env={...process.env,...xdg,TEMP:temp,TMP:temp,TMPDIR:temp,TANGU_HOME:home,TANGU_DEFAULT_WORKSPACE:workspace,TANGU_PLUGINS:'on',TANGU_BROWSER_CDP:'off',TANGU_BROWSER_EXTENSION:'0',FORSION_DESKTOP_CONFIG:join(out,'desktop-config.json')}
  for(const key of ['TANGU_PLUGINS_DIR','TANGU_BUNDLE_DIRS','TANGU_BACKEND_URL'])delete env[key]
  child=spawn(process.execPath,[join(agent,'dist/standalone/main.js'),'--host','127.0.0.1','--port',String(port),'--data-dir',join(home,'state.db'),'--sandbox','off','--cloud-url','http://127.0.0.1:9','--token',token],{env,windowsHide:true,stdio:['ignore','pipe','pipe']})
  for(const stream of [child.stdout,child.stderr])stream.on('data',bytes=>{void appendFile(join(out,'engine.log'),bytes.toString().split(token).join('[local-auth]').replace(/\?token=\S+/g,'?token=[local-auth]'))})
  api=async(path,body)=>{const response=await fetch(base+path,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(180000)});const value=await response.json();if(!response.ok)throw new Error(value.error||`Fixture API ${response.status}`);return value}
  const prefix='/extensions/dsh2forsion/dsh2forsion'
  await until(()=>api('/health').catch(()=>null),'native host startup')
  const sidecar=await until(async()=>{const s=(await api(prefix+'/status')).sidecar;if(s.state==='failed')throw new Error(s.error);return s.state==='running'?s:null},'DSH startup')
  const logs=await api(prefix+'/logs');await writeFile(join(out,'dsh-startup.log'),JSON.stringify(logs.sidecar).replace(/\?token=[^\s"\\]+/g,'?token=[local-auth]'))
  assert.ok(!logs.sidecar.some(line=>line.includes('did not activate')),'all original and fixture DSH plugins activated')
  proxyOrigin=await until(async()=>{const response=await fetch(sidecar.base+'/bili/origin');if(!response.ok)return null;return(await response.json()).origin},'original Billion proxy startup',60000)
  assert.equal(new URL(proxyOrigin).hostname,'127.0.0.1')
  const manifest=await(await fetch(proxyOrigin+'/__bili/plugin/manifest')).json()
  result.prerequisites={proxyVersion:manifest.version,manifestToolNames:(manifest.tools?.anthropic||[]).map(tool=>tool.name),isolatedPaths:true,metadata:'fixed exact public default-model route; no forged requestHeader',actualUpstreamBudgetGuard:true}
  assert.match(String(manifest.version),/^0\.1\.201/)
  const all=value=>value&&typeof value==='object'?[value,...Object.values(value).flatMap(all)]:[]
  const modelId=await until(async()=>all(await api('/agent/models')).find(row=>row.id?.startsWith('plugin:')&&row.name==='Billion direct Luna fixture')?.id,'native direct model source')
  result.modelId=modelId
  await writeFile(join(out,'results.json'),JSON.stringify(result,null,2))
  console.log(`PASS Billion prerequisites: fixed original plugin + isolated proxy + direct native source; evidence ${out}`)
  const fact='COBALT-'+randomUUID().slice(0,8).toUpperCase()
  const filler=Array.from({length:100},(_,i)=>`Obsolete briefing ${i}: the retired assembly corridor held routine packing slips; no decisions remain. `).join('').slice(0,7000)
  const messages=[{role:'system',content:'This is an explicit synthetic acceptance history. Preserve exact launch codes when summarizing. Answer the final query using only the recorded briefing.'},{role:'user',content:`The immutable launch code is ${fact}. Preserve this exact code.\n${filler}`},{role:'assistant',content:'The old briefing and its immutable launch code are recorded.'},{role:'user',content:'The old packing slips are obsolete. Preserve the launch code as a durable fact.'},{role:'assistant',content:'Understood; only the immutable launch code matters.'},{role:'user',content:'What is the immutable launch code from the early briefing? Reply only with that code.'}]
  result.syntheticHistory={earlyFact:fact,fillerCharacters:filler.length,messageCount:messages.length}
  const answer=await api('/extensions/dsh2forsion/billion-native-fixture/infer',{modelId,messages})
  result.answer={content:answer.content,usage:answer.usage}
  const sessionKey=createHash('sha256').update(JSON.stringify(['billion-fixture-user','billion-fixture-session'])).digest('hex')
  const statusResponse=await fetch(proxyOrigin+'/__bili/plugin/status?conversationId='+encodeURIComponent('dsh2forsion-session-'+sessionKey))
  const status=await statusResponse.json();result.proxyStatus=status
  assert.match(answer.content,new RegExp(fact),'a real Luna answer recalls the early unique fact')
  assert.ok(requests.length<=upstreamLimit,'hidden summary requests count against the same upstream ceiling')
  assert.equal(denied.length,0,'no third upstream request was attempted')
  assert.ok(requests.length>=2,'real summary work and a real final answer are required for this fixture')
  const bodyFirst=JSON.stringify(requests[0].payload),bodyLast=JSON.stringify(requests[1].payload)
  result.compression={firstBodyCharacters:bodyFirst.length,lastBodyCharacters:bodyLast.length,rawBriefingKept:bodyLast.includes(filler),factRetained:bodyLast.includes(fact)}
  assert.ok(bodyLast.length<bodyFirst.length,'the final actual upstream payload is shorter than the summary input')
  assert.equal(bodyLast.includes(filler),false,'the original long briefing is not merely forwarded verbatim')
  assert.equal(bodyLast.includes(fact),true,'the exact fact survives in the effective compressed input')
  result.ok=true
  console.log(`PASS original Billion actual compression and real Luna fact recall, upstream calls ${requests.length}; evidence ${out}`)
}catch(error){result.error=String(error.stack||error);throw error}
finally{
  result.actualUpstreamRequests=requests.length;result.blockedRequests=denied;result.upstreamRequests=requests
  // Proxy session persistence is off. Never copy provider credentials or headers.
  await writeFile(join(out,'results.json'),JSON.stringify(result,null,2))
  if(proxyOrigin)await fetch(proxyOrigin+'/__bili/shutdown',{method:'POST',headers:{'content-type':'application/json'},body:'{}',signal:AbortSignal.timeout(5000)}).catch(()=>{})
  child?.kill('SIGTERM');budget.closeAllConnections();await new Promise(resolve=>budget.close(resolve))
}
