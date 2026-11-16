// 审批 B 端到端(真运行时 + 官方 DSH + 本机假模型,全新目录):把构建好的引擎半身像 tangu-agent 那样激活,ACP 客户端由测试扮演 Forsion。
//   ① Forsion 发的轮:提权写文件、skills-manager 的 create_skill 都问到对话入口(Forsion 的审批卡),允许 / 拒绝都管用,工作台里不出卡;
//   ② 工作台发的轮(网页界面对同一场发一句):审批留在网页,对话入口没被问;
//   ③ 两边同时有待批的:Forsion 那场问 Forsion、工作台那场留网页,各回各的;
//   ④ 故意把自检弄成对不上(DSH2FORSION_APPROVAL_EVENT 改事件名):Forsion 的轮不接管,对话入口收到「在工作台里等你批准」的提示,
//      状态里写明原因;停掉这一轮后提示撤掉。
//
//   DSH2FORSION_ROOT=<已装好运行时的根目录:node/ 与 runtime/> node tests/check-approvals.mjs
//
// 只装 @michengai/dsh-skills-manager@1.4.6(获准实跑的三个之一),走工作台装插件的真路径(停住 → 体检 → 放行)。启动令牌不打印。
//
// 真模型:DSH2FORSION_LIVE_HOME=<一份登录过的 DSH 目录> [DSH2FORSION_LIVE_MODEL=<模型 id 或名字里的一段,缺省 deepseek-flash>]
//   只把那份目录的登录(.credentials.yaml / .anonymous-user-id)拷进临时 DSH 目录,跑完删掉;那份目录本身不读别的、不写。
//   组合里关掉 DSH 自带的读写文件 / 搜文件 / 跑命令 / 后台任务(真模型手里只有 skills-manager 这类插件工具),
//   只跑 create_skill 那几条:Forsion 发的轮允许 / 拒绝,工作台发的轮留在工作台。写文件、③、④ 是按假模型剧本写的,真模型下跳过。
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { chmod, copyFile, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { startStubModel } from './helpers/stub-model.mjs'

const repo = join(dirname(fileURLToPath(import.meta.url)), '..')
const pluginDir = join(repo, 'plugin/tangu-plugins/dsh2forsion')
const sourceRoot = process.env.DSH2FORSION_ROOT
if (!sourceRoot) { console.error('set DSH2FORSION_ROOT to a data root with node/ and runtime/'); process.exit(2) }
const SKILLS_MANAGER = '@michengai/dsh-skills-manager@1.4.6'
const RENAMED = 'approval/request-renamed-by-test'
const LIVE_HOME = process.env.DSH2FORSION_LIVE_HOME ?? ''
const LIVE = !!LIVE_HOME
const LIVE_MODEL = process.env.DSH2FORSION_LIVE_MODEL || 'deepseek-flash' // 账号登录那条线上的;官方线(deepseek-official)的 deepseek-v4-flash 要 API key
const NATIVE_OFF = ['tool-bash', 'tool-pwsh', 'tool-jobs', 'tool-fs', 'tool-fs-search']
if (LIVE && !existsSync(join(LIVE_HOME, '.credentials.yaml'))) { console.error('DSH2FORSION_LIVE_HOME has no DSH login (.credentials.yaml)'); process.exit(2) }

let n = 0
const it = async (name, fn) => { const t0 = Date.now(); await fn(); n++; console.log(`ok ${n} ${name} (${((Date.now() - t0) / 1000).toFixed(1)}s)`) }
const sleep = ms => new Promise(r => setTimeout(r, ms))
const waitFor = async (what, fn, ms) => {
  const t0 = Date.now()
  for (;;) {
    const v = await fn()
    if (v) return v
    if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`)
    await sleep(300)
  }
}

const scratch = resolve(repo, '.tmp', `approvals-${new Date().toISOString().replace(/[:.]/g, '-')}`)
const dataDir = join(scratch, 'plugin-data')
const OUTSIDE = join(scratch, 'outside')
for (const d of ['home', 'dsh', 'xc', 'xd', 'xs', 'tmp', 'ws', 'outside']) await mkdir(join(scratch, d), { recursive: true })
await mkdir(dataDir, { recursive: true })
for (const sub of ['node', 'runtime']) await symlink(join(sourceRoot, sub), join(dataDir, sub), process.platform === 'win32' ? 'junction' : 'dir')
Object.assign(process.env, {
  HOME: join(scratch, 'home'), USERPROFILE: join(scratch, 'home'), DSH_HOME: join(scratch, 'dsh'), XDG_CACHE_HOME: join(scratch, 'xc'), XDG_DATA_HOME: join(scratch, 'xd'),
  XDG_STATE_HOME: join(scratch, 'xs'), TMPDIR: join(scratch, 'tmp'), DSH_TELEMETRY_DISABLED: '1',
})
delete process.env.DSH2FORSION_APPROVAL_EVENT
const { resolveDshHome } = await import('../src/engine/layout.mjs')
assert.ok(resolveDshHome(process.env).startsWith(scratch) && !resolveDshHome(process.env).startsWith(join(homedir(), '.dsh')), 'DSH_HOME must point into the test folder')
console.log(`test data: ${scratch}`)

const stub = LIVE ? null : await startStubModel({ outside: OUTSIDE })
// 常驻 DSH 的环境走白名单、不带 provider key:像用户那样写进 DSH 目录的 .env
if (!LIVE) await writeFile(join(scratch, 'dsh', '.env'), `DEEPSEEK_BASE_URL=${stub.url}\nDEEPSEEK_API_KEY=stub-not-a-real-key\n`)
const liveLogin = ['.credentials.yaml', '.anonymous-user-id'].map(f => join(scratch, 'dsh', f))
if (LIVE) {
  for (const f of liveLogin) {
    const from = join(LIVE_HOME, f.slice(join(scratch, 'dsh').length + 1))
    if (existsSync(from)) { await copyFile(from, f); await chmod(f, 0o600) }
  }
  // 组合先由测试照插件的样子建好(带记号,插件认作自己的),补丁里把 DSH 自带的读写 / 命令关掉;插件见补丁已在就不再写
  const { FUSION_MARKER } = await import('../src/engine/constants.mjs')
  const { fusionPatch, FUSION_PATCH_VERSION } = await import('../src/engine/fusion.mjs')
  const prof = join(scratch, 'dsh', 'profiles', 'forsion')
  await mkdir(prof, { recursive: true })
  await writeFile(join(prof, FUSION_MARKER), JSON.stringify({ createdBy: 'dsh2forsion', patch: FUSION_PATCH_VERSION, at: new Date().toISOString() }) + '\n')
  let patch = fusionPatch()
  for (const id of NATIVE_OFF) patch = patch.replace(`- id: ${id}\n  disabled: false\n`, '')
  await writeFile(join(prof, 'cordis.patch.yml'), patch + '# check-approvals (live): DSH\'s own file / shell / search / job tools are off\n' + NATIVE_OFF.map(id => `- id: ${id}\n  disabled: true\n`).join(''))
  console.log(`live: login copied in (removed afterwards), DSH's own ${NATIVE_OFF.join(' / ')} off, model matching "${LIVE_MODEL}"`)
}

const { createPlugin } = await import(pathToFileURL(join(pluginDir, 'dist/index.js')).href)

/** 激活一份引擎半身(像 tangu-agent 那样),连上常驻进程,测试自己当 ACP 客户端(= Forsion)。 */
async function boot() {
  const settings = { autoStart: false, downloadSource: 'auto' }
  const routes = new Map()
  const router = { get: (p, h) => routes.set(`GET ${p}`, h), post: (p, h) => routes.set(`POST ${p}`, h) }
  let resident = null
  const ctx = {
    paths: { pluginDir, dataDir },
    sdk: {
      pluginStore: { getScopeSettings: () => settings, isPluginEnabledSync: () => true, setScopeSettings: async (_id, _scope, patch) => Object.assign(settings, patch) },
      engines: { hold: async () => ({ ok: true, engineSessionId: 'e', state: 'open' }) },
    },
    registerPlugin: () => {}, registerSkillProvider: () => {}, registerModelProvider: () => {},
    registerResidentEngine: h => { resident = h },
    registerScopedRoutes: fn => fn(router),
    log: () => {},
  }
  const call = (method, path, body) => new Promise((ok, fail) => {
    const h = routes.get(`${method} ${path}`)
    if (!h) return fail(new Error(`no route ${method} ${path}`))
    const res = { code: 200, status(c) { this.code = c; return this }, json(v) { if (this.code >= 400) fail(new Error(`${path} → ${this.code}: ${v.error}`)); else ok(v) } }
    h({ body: body ?? {}, user: { userId: 'u1' } }, res)
  })
  const engine = createPlugin()
  await engine.activate(ctx)
  // 测试扮演的 Forsion:审批按 policy 回(allow / reject / hold),扩展通知记下来
  const forsion = { asked: [], notices: [], policy: 'allow', held: [], text: {}, tools: [] }
  let conn = null, id = 0, buf = ''
  const waiters = new Map()
  const send = m => conn.input.write(JSON.stringify(m) + '\n')
  const answer = (m, how) => {
    const opt = (m.params?.options ?? []).find(o => o.kind === (how === 'allow' ? 'allow_once' : 'reject_once'))
    send({ jsonrpc: '2.0', id: m.id, result: { outcome: opt ? { outcome: 'selected', optionId: opt.optionId } : { outcome: 'cancelled' } } })
  }
  const onData = d => {
    buf += d
    let i
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1)
      const m = JSON.parse(line)
      if (m.id != null && !m.method && waiters.has(m.id)) { waiters.get(m.id)(m); waiters.delete(m.id) }
      else if (m.method === 'session/request_permission') {
        forsion.asked.push({ sessionId: m.params.sessionId, toolCallId: m.params.toolCall?.toolCallId, title: String(m.params.toolCall?.title ?? '') })
        if (forsion.policy === 'hold') forsion.held.push(m)
        else answer(m, forsion.policy)
      } else if (m.method === '_forsion/notice') forsion.notices.push(m.params)
      else if (m.method === 'session/update') {
        const u = m.params?.update, sid = m.params?.sessionId
        if (u?.sessionUpdate === 'agent_message_chunk' && u.content?.type === 'text') forsion.text[sid] = (forsion.text[sid] ?? '') + u.content.text
        else if (u?.sessionUpdate === 'tool_call') forsion.tools.push({ sessionId: sid, title: String(u.title ?? ''), kind: u.kind })
      }
      else if (m.method && m.id != null) send({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'not in this test' } })
    }
  }
  const acp = (method, params, ms = 90_000) => new Promise((ok, fail) => {
    const my = ++id
    const timer = setTimeout(() => { waiters.delete(my); fail(new Error(`ACP ${method} timed out`)) }, ms)
    waiters.set(my, m => { clearTimeout(timer); m.error ? fail(new Error(`${method}: ${m.error.message}`)) : ok(m.result) })
    send({ jsonrpc: '2.0', id: my, method, params })
  })
  const web = { url: null, base: null, cookie: null }
  // (重新)连上常驻进程:第一次,以及插件要求重启 DSH 之后(skills-manager 装上要重启才加载)
  const attach = async () => {
    conn = await resident.connect()
    assert.ok(conn, 'connect() returned a live connection')
    buf = ''
    conn.output.on('data', onData)
    await acp('initialize', { protocolVersion: 1, clientCapabilities: {} })
    const wb = await call('POST', '/workbench')
    Object.assign(web, { url: wb.url, base: wb.base, cookie: null })
  }
  await attach()
  const webRpc = async (method, args) => {
    if (!web.cookie) { const login = await fetch(web.url, { redirect: 'manual' }); web.cookie = (login.headers.get('set-cookie') ?? '').split(';')[0] }
    const r = await fetch(`${web.base}/api/${method}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: web.base, cookie: web.cookie },
      body: JSON.stringify({ type: 'client-request', rpcId: `t-${randomUUID()}`, method, payload: { args } }) })
    return r.json()
  }
  const pending = async sessionId => (await webRpc('session/state', { request: { sessionId } }))?.result?.value?.pendingInput ?? []
  const webSay = (sessionId, text) => webRpc('session/prompt', { request: { requestId: randomUUID(), sessionId, mode: 'queue', content: [{ type: 'text', text }] } })
  const newSession = async () => {
    const r = await acp('session/new', { cwd: join(scratch, 'ws'), mcpServers: [] })
    if (LIVE) await pickModel(r)
    return r.sessionId
  }
  // 真模型:用登录的账号能用的那条线上、名字含 LIVE_MODEL 的模型(DSH 的模型在 configOptions 里,值是不透明的串)
  const flat = opts => (Array.isArray(opts) ? opts : []).flatMap(o => Array.isArray(o?.options) ? flat(o.options) : typeof o?.value === 'string' ? [o] : [])
  const pickModel = async r => {
    const sel = (r.configOptions ?? []).find(o => o?.type === 'select' && (o.category === 'model' || o.id === 'model'))
    const all = flat(sel?.options)
    const m = all.find(o => o.value.includes(LIVE_MODEL) || String(o.name ?? '').includes(LIVE_MODEL))
    if (!sel || !m) throw new Error(`no model matching "${LIVE_MODEL}": ${all.map(o => o.name ?? o.value).join(' | ')}`)
    if (sel.currentValue !== m.value) await acp('session/set_config_option', { sessionId: r.sessionId, configId: sel.id, value: m.value })
    if (!pickModel.said) { pickModel.said = true; console.log(`   live model: ${m.name ?? m.value}`) }
  }
  const say = (sessionId, text, ms) => acp('session/prompt', { sessionId, prompt: [{ type: 'text', text }] }, ms)
  return { engine, get conn() { return conn }, attach, call, acp, notify: (method, params) => send({ jsonrpc: '2.0', method, params }), webRpc, pending, webSay, newSession, say, forsion, answer }
}
const noDshLeft = () => !execFileSync('ps', ['-axo', 'pid,command'], { encoding: 'utf8' }).split('\n').some(l => l.includes('dsh/lib/bin.js') && l.includes(scratch))
const wrote = name => existsSync(join(OUTSIDE, name))
const skillAt = name => existsSync(join(scratch, 'dsh', 'skills', name))
const stubOnly = (name, fn) => LIVE ? console.log(`skip (stub script, not live) ${name}`) : it(name, fn)
const LIVE_SKILL = name => `Use the create_skill tool exactly once to create a skill named "${name}" (description: "Live approval test", body: "# ${name}\\nA test skill."). Do not use any other tool. When the tool returns, reply with one word: DONE if the skill was created, REFUSED if it was not.`
const said = (x, sid) => `model said: ${String(x.forsion.text[sid] ?? '').trim().replace(/\s+/g, ' ').slice(0, 160) || '(nothing)'}; tools: ${x.forsion.tools.filter(t => t.sessionId === sid).map(t => t.title).join(' | ') || '(none)'}`
const NATIVE_TOOL = /^(read|read_image|write|edit|apply_patch|glob|grep|bash|pwsh|job_\w+)\b/i

let A = null, B = null
try {
  A = await boot()
  const { call, forsion } = A

  await it('the bridge self-check passes on the pinned DSH: Forsion turns ask in Forsion', async () => {
    const st = await waitFor('the approval self-check', async () => (await call('GET', '/status')).approvals, 15_000)
    assert.equal(st.mode, 'forsion', `self-check: ${st.reason}`)
  })

  await it(`${SKILLS_MANAGER} from the workbench: the report names koffi's build script; unallowed the install fails and DSH records it pending; nothing allows it for the user`, async () => {
    // skills-manager 1.4.6 带的 koffi 有构建脚本;DSH 0.2.2 的 pnpm 11 不跑没允许过的构建脚本(ERR_PNPM_IGNORED_BUILDS)。
    // 产品缺省不替用户允许:体检报告写明,放行后这次装不上,DSH 在组合里记下「待定」,允许的入口是 DSH 插件页「允许这些脚本并重试」
    const install = (options) => { const p = A.webRpc('pluginManager/installBundle', { spec: SKILLS_MANAGER, options: { enabled: true, requestId: randomUUID(), ...options } }); p.catch(() => {}); return p }
    const seen = new Set((await call('GET', '/reviews')).reviews.map(x => x.id))
    const nextReport = () => waitFor('the review report', async () => (await call('GET', '/reviews')).reviews.find(x => x.state === 'ready' && !seen.has(x.id)), 300_000).then(x => { seen.add(x.id); return x })
    let done = install({})
    let r = await nextReport()
    assert.deepEqual(r.report?.builds, [{ key: 'koffi@3.1.1', state: 'needs' }], JSON.stringify(r.report))
    await call('POST', '/reviews/decide', { id: r.id, allow: true })
    let res = await done
    assert.ok(res?.result?.ok === false || res?.result?.value?.application === 'failed', `unallowed build scripts did not stop the install: ${JSON.stringify(res).slice(0, 300)}`)
    assert.match(JSON.stringify(res), /koffi@3\.1\.1/)
    const policy = join(scratch, 'dsh/profiles/forsion/pnpm-workspace.yaml')
    assert.match(await readFile(policy, 'utf8'), /koffi@3\.1\.1: set this to true or false/, 'DSH records the build as waiting for a decision')
    // DSH 插件页「允许这些脚本并重试」= 同一个安装带上 approvedBuilds:再体检一次,报告写「你在 DSH 里允许了」。这里按「不装」,不跑它的脚本
    done = install({ approvedBuilds: ['koffi@3.1.1'] })
    r = await nextReport()
    assert.deepEqual(r.report?.builds, [{ key: 'koffi@3.1.1', state: 'approved' }], JSON.stringify(r.report))
    await call('POST', '/reviews/decide', { id: r.id, allow: false })
    res = await done
    assert.notEqual(res?.result?.ok, true, 'declined in Forsion: not installed')
    assert.match(await readFile(policy, 'utf8'), /koffi@3\.1\.1: set this to true or false/, 'declining did not allow the build script')
  })

  await it(`installs ${SKILLS_MANAGER} through the workbench once the profile says not to run koffi's script (held → review → allowed)`, async () => {
    // 测试替用户选「不跑它的脚本」(koffi 自带预编译,不跑也能用);只在这个临时目录里,不是产品缺省
    await writeFile(join(scratch, 'dsh/profiles/forsion/pnpm-workspace.yaml'), 'allowBuilds:\n  koffi: false\n')
    const requestId = randomUUID()
    const done = A.webRpc('pluginManager/installBundle', { spec: SKILLS_MANAGER, options: { enabled: true, requestId } })
    done.catch(() => {})
    const r = await waitFor('the review report', async () => (await call('GET', '/reviews')).reviews.find(x => x.state === 'ready' && x.report?.builds?.[0]?.state === 'skipped'), 300_000)
    assert.deepEqual(r.report.builds, [{ key: 'koffi@3.1.1', state: 'skipped' }])
    await call('POST', '/reviews/decide', { id: r.id, allow: true })
    const res = await done
    assert.equal(res?.result?.ok, true, JSON.stringify(res?.result?.error ?? res).slice(0, 300))
    assert.notEqual(res.result.value?.application, 'failed', 'the plugin loaded into the running DSH')
    // 它不能热加载(application = restart-required):像 Harness 卡上的「重启 DSH」那样重启,再连上
    if (res.result.value?.application === 'restart-required') {
      await call('POST', '/sidecar/restart')
      await A.attach()
    }
    await waitFor('the self-check after the restart', async () => (await call('GET', '/status')).approvals?.mode === 'forsion', 15_000)
  })

  const S1 = await A.newSession()
  if (LIVE) {
    await it('live ① Forsion turn, the real model calls create_skill, allowed in Forsion: asked over ACP, the skill is created', async () => {
      forsion.policy = 'allow'
      const before = forsion.asked.length
      const r = await A.say(S1, LIVE_SKILL('forsion-live-allowed'), 240_000)
      console.log(`   ${said(A, S1)}; asked: ${forsion.asked.length - before}`)
      assert.equal(r.stopReason, 'end_turn')
      const asked = forsion.asked.slice(before)
      assert.ok(asked.length >= 1 && asked.every(a => a.sessionId === S1), `Forsion was asked for S1 (${asked.length})`)
      assert.ok(skillAt('forsion-live-allowed'), 'skill folder exists')
      assert.ok(!forsion.notices.some(x => x.sessionId === S1 && !x.clear), 'no "waiting in the workbench" notice for an approval Forsion took')
    })
    await it('live ① the real model calls create_skill, rejected in Forsion: asked, no skill', async () => {
      forsion.policy = 'reject'
      const before = forsion.asked.length, mark = forsion.text[S1]?.length ?? 0
      const r = await A.say(S1, LIVE_SKILL('forsion-live-rejected'), 240_000)
      console.log(`   model said: ${String(forsion.text[S1] ?? '').slice(mark).trim().replace(/\s+/g, ' ').slice(0, 160) || '(nothing)'}; asked: ${forsion.asked.length - before}`)
      assert.ok(['end_turn', 'cancelled', 'refusal'].includes(r.stopReason), r.stopReason)
      assert.ok(forsion.asked.length - before >= 1, 'Forsion was asked')
      assert.ok(!skillAt('forsion-live-rejected'), 'rejected: no skill')
    })
    await it('live ② workbench turn on the same session, the real model calls create_skill: the approval stays in the workbench, Forsion is not asked', async () => {
      forsion.policy = 'allow'
      const before = forsion.asked.length
      const accepted = await A.webSay(S1, LIVE_SKILL('workbench-live-skill'))
      assert.equal(accepted?.result?.ok, true, JSON.stringify(accepted).slice(0, 200))
      await waitFor('the approval pending in the workbench', async () => (await A.pending(S1)).includes('approval'), 180_000)
      await sleep(1000)
      assert.equal(forsion.asked.length, before, 'ACP client was not asked')
      await A.webRpc('session/cancel', { request: { sessionId: S1 } })
      await waitFor('the workbench approval to settle', async () => !(await A.pending(S1)).includes('approval'), 15_000)
      assert.ok(!skillAt('workbench-live-skill'))
    })
    await it('live: DSH\'s own file / shell tools stayed off (no such tool call; the profile patch still says so)', async () => {
      const native = forsion.tools.filter(t => NATIVE_TOOL.test(t.title))
      assert.deepEqual(native, [], `native tools used: ${native.map(t => t.title).join(' | ')}`)
      const patch = await readFile(join(scratch, 'dsh/profiles/forsion/cordis.patch.yml'), 'utf8')
      for (const id of NATIVE_OFF) assert.match(patch, new RegExp(`- id: ${id}\\n  disabled: true`))
    })
  }
  await stubOnly('① Forsion turn, elevated write, allowed in Forsion: asked over ACP (not in the workbench), the file is written', async () => {
    forsion.policy = 'allow'
    const before = forsion.asked.length
    const r = await A.say(S1, 'WRITE allowed.txt')
    assert.equal(r.stopReason, 'end_turn')
    assert.deepEqual(forsion.asked.slice(before).map(a => a.sessionId), [S1])
    assert.ok(wrote('allowed.txt'))
    assert.ok(!forsion.notices.some(x => x.sessionId === S1 && !x.clear), 'no "waiting in the workbench" notice for an approval Forsion took')
  })

  await stubOnly('① Forsion turn, elevated write, rejected in Forsion: the file is not written', async () => {
    forsion.policy = 'reject'
    const before = forsion.asked.length
    await A.say(S1, 'WRITE rejected.txt')
    assert.equal(forsion.asked.length - before, 1)
    assert.ok(!wrote('rejected.txt'))
  })

  await stubOnly('① Forsion turn, skills-manager create_skill (plugin approval), allowed in Forsion: the skill is created', async () => {
    forsion.policy = 'allow'
    const before = forsion.asked.length
    await A.say(S1, 'SKILL forsion-allowed-skill')
    assert.equal(forsion.asked.length - before, 1, 'create_skill asked Forsion')
    assert.ok(skillAt('forsion-allowed-skill'), 'skill folder exists')
  })

  await stubOnly('① Forsion turn, create_skill rejected in Forsion: no skill', async () => {
    forsion.policy = 'reject'
    const before = forsion.asked.length
    await A.say(S1, 'SKILL forsion-rejected-skill')
    assert.equal(forsion.asked.length - before, 1)
    assert.ok(!skillAt('forsion-rejected-skill'))
  })

  await stubOnly('② workbench turn on the same (Forsion-held) session: the approval stays in the workbench, Forsion is not asked', async () => {
    forsion.policy = 'allow'
    const before = forsion.asked.length
    const accepted = await A.webSay(S1, 'WRITE from-workbench.txt')
    assert.equal(accepted?.result?.ok, true, JSON.stringify(accepted).slice(0, 200))
    await waitFor('the approval pending in the workbench', async () => (await A.pending(S1)).includes('approval'), 30_000)
    await sleep(1000)
    assert.equal(forsion.asked.length, before, 'ACP client was not asked')
    // 工作台里取消(= 用户在工作台里不批):这一轮收住,文件没写
    await A.webRpc('session/cancel', { request: { sessionId: S1 } })
    await waitFor('the workbench approval to settle', async () => !(await A.pending(S1)).includes('approval'), 15_000)
    assert.ok(!wrote('from-workbench.txt'))
  })

  await stubOnly('③ both pending at once: Forsion\'s session asks Forsion, the workbench session waits in the workbench; each answers its own', async () => {
    const S2 = await A.newSession()
    forsion.policy = 'hold'
    const before = forsion.asked.length
    const forsionTurn = A.say(S1, 'WRITE both-forsion.txt')
    const accepted = await A.webSay(S2, 'WRITE both-workbench.txt')
    assert.equal(accepted?.result?.ok, true)
    await waitFor('Forsion asked for S1', async () => forsion.asked.length > before, 30_000)
    await waitFor('S2 pending in the workbench', async () => (await A.pending(S2)).includes('approval'), 30_000)
    assert.deepEqual(forsion.asked.slice(before).map(a => a.sessionId), [S1], 'only S1 asked Forsion')
    assert.ok(!(await A.pending(S1)).includes('approval'), 'S1 is not pending in the workbench')
    forsion.policy = 'allow'
    for (const m of forsion.held.splice(0)) A.answer(m, 'allow')
    assert.equal((await forsionTurn).stopReason, 'end_turn')
    assert.ok(wrote('both-forsion.txt'))
    assert.ok((await A.pending(S2)).includes('approval'), 'S2 still waits in the workbench after Forsion answered S1')
    await A.webRpc('session/cancel', { request: { sessionId: S2 } })
    await waitFor('S2 to settle', async () => !(await A.pending(S2)).includes('approval'), 15_000)
    assert.ok(!wrote('both-workbench.txt'))
  })

  await stubOnly('③b a workbench approval already pending, then Forsion sends on that session (queued behind it): Forsion is told it waits in the workbench, the notice clears, Forsion\'s turn comes back', async () => {
    const S4 = await A.newSession()
    const accepted = await A.webSay(S4, 'WRITE queued-workbench.txt')
    assert.equal(accepted?.result?.ok, true)
    await waitFor('S4 pending in the workbench', async () => (await A.pending(S4)).includes('approval'), 30_000)
    await sleep(600) // 提示那时就发了,但没有 Forsion 的轮,宿主那边没人接
    const mark = forsion.notices.length
    const asked = forsion.asked.length
    const forsionTurn = A.say(S4, 'Just say hi.')
    const told = await waitFor('Forsion told S4 is waiting in the workbench', async () => forsion.notices.slice(mark).find(n => n.sessionId === S4 && n.kind === 'approval-elsewhere'), 15_000)
    assert.equal(told.action.id, 'open-in-workbench')
    assert.equal(forsion.asked.length, asked, 'the workbench approval was not handed to Forsion')
    await A.webRpc('session/cancel', { request: { sessionId: S4 } })
    await waitFor('the notice to clear', async () => forsion.notices.slice(mark).some(n => n.id === told.id && n.clear), 15_000)
    const out = await Promise.race([forsionTurn, sleep(60_000).then(() => null)])
    assert.ok(out, 'Forsion\'s queued turn came back')
    console.log(`   ③b Forsion's queued turn ended: ${out.stopReason}`)
    assert.ok(!wrote('queued-workbench.txt'))
  })

  await it('stopping the plugin leaves no DSH process', async () => {
    await A.engine.deactivate()
    await Promise.race([A.conn.closed, sleep(8000).then(() => { throw new Error('connection did not close') })])
    await waitFor('no DSH left', noDshLeft, 10_000)
    A = null
  })

  // ④ 负对照 / 退回 A:桥挂到改了名的事件上
  if (!LIVE) process.env.DSH2FORSION_APPROVAL_EVENT = RENAMED
  B = LIVE ? null : await boot()
  await stubOnly('④ self-check forced to mismatch (event renamed): status says the workbench, with the reason', async () => {
    const st = await waitFor('the approval self-check', async () => (await B.call('GET', '/status')).approvals, 15_000)
    assert.equal(st.mode, 'workbench')
    assert.match(st.reason, /approval\/request-renamed-by-test/)
  })

  await stubOnly('④ Forsion turn with the self-check off: not taken over; Forsion gets "waiting in the workbench" + "Open the workbench"; cleared when it settles', async () => {
    const S3 = await B.newSession()
    B.forsion.policy = 'allow'
    const before = B.forsion.asked.length
    const turn = B.say(S3, 'WRITE fallback.txt').catch(error => ({ error }))
    const notice = await waitFor('the notice', async () => B.forsion.notices.find(x => x.sessionId === S3 && !x.clear), 30_000)
    assert.equal(notice.kind, 'approval-elsewhere')
    assert.equal(notice.text.zh, 'DSH 在工作台里等你批准')
    assert.equal(notice.action.id, 'open-in-workbench')
    assert.ok((await B.pending(S3)).includes('approval'), 'the approval waits in the workbench')
    assert.equal(B.forsion.asked.length, before, 'ACP was not asked')
    B.notify('session/cancel', { sessionId: S3 })
    const r = await turn
    assert.ok(r.error || r.stopReason === 'cancelled', `the turn ended: ${JSON.stringify(r).slice(0, 120)}`)
    await waitFor('the notice clear', async () => B.forsion.notices.some(x => x.id === notice.id && x.clear), 15_000)
    assert.ok(!wrote('fallback.txt'))
  })

  await stubOnly('④ stopping leaves no DSH process', async () => {
    await B.engine.deactivate()
    await Promise.race([B.conn.closed, sleep(8000).then(() => { throw new Error('connection did not close') })])
    await waitFor('no DSH left', noDshLeft, 10_000)
    B = null
  })
} catch (error) {
  console.error(error)
  for (const t of stub?.transcript.slice(-4) ?? []) console.error(`  model saw ${t.tools.length} tools (create_skill: ${t.tools.includes('create_skill')}) → ${String(t.reply).slice(0, 200)}`)
  try { const x = A ?? B; if (x) console.error((await x.call('GET', '/logs')).sidecar.slice(-25).join('\n')) } catch { /* 已停 */ }
  process.exitCode = 1
} finally {
  for (const x of [A, B]) if (x) { try { await x.engine.deactivate() } catch { /* 已停 */ } }
  await stub?.close()
  if (LIVE) for (const f of liveLogin) await rm(f, { force: true })
  delete process.env.DSH2FORSION_APPROVAL_EVENT
}
console.log(`check-approvals: ${n} passed`)
