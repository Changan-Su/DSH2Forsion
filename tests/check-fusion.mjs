// 端到端（第 1 档融合）：真运行时 + 官方 DSH，把构建好的引擎半身像 tangu-agent 那样激活，走用户路径：
//   对话连常驻进程（按需启动、ACP 握手、建会话）→ 同一个进程的网页界面认得那场会话 → 工作台地址 →
//   工作台里 DSH 自己的插件页装插件：被停住、体检（装前 / 装后各试启动一次）、拒绝时真没装上（负对照）、放行后装上且进程没重启 →
//   「在工作台里打开」交给宿主 hold → 停用后不留 DSH 进程。
//
//   DSH2FORSION_ROOT=<已装好运行时的根目录：node/ 与 runtime/> node tests/check-fusion.mjs
//   DSH2FORSION_FRESH=1 node tests/check-fusion.mjs     从网上真装一遍运行时（约 1.1 GB），走界面上「下载并启动」那条路由（CI 用）
//
// 全部在仓库的 .tmp/ 下一个全新目录里：HOME、DSH_HOME、XDG、TMPDIR 都指进去（DSH 用的是「用户自己的 DSH 目录」，测试里必须换掉）。
// 装的社区插件只用 dsh-genui@0.3.3（三个获准实跑的之一）。启动令牌不打印。
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repo = join(dirname(fileURLToPath(import.meta.url)), '..')
const pluginDir = join(repo, 'plugin/tangu-plugins/dsh2forsion')
const sourceRoot = process.env.DSH2FORSION_ROOT
const fresh = process.env.DSH2FORSION_FRESH === '1'
if (!sourceRoot && !fresh) { console.error('set DSH2FORSION_ROOT to a data root with node/ and runtime/, or DSH2FORSION_FRESH=1'); process.exit(2) }
const PLUGIN = process.env.DSH2FORSION_REVIEW_SPEC || 'dsh-genui@0.3.3'

let n = 0
const it = async (name, fn) => { const t0 = Date.now(); await fn(); n++; console.log(`ok ${n} ${name} (${((Date.now() - t0) / 1000).toFixed(1)}s)`) }
const sleep = ms => new Promise(r => setTimeout(r, ms))
const waitFor = async (what, fn, ms) => {
  const t0 = Date.now()
  for (;;) {
    const v = await fn()
    if (v) return v
    if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`)
    await sleep(400)
  }
}

const scratch = resolve(repo, '.tmp', `fusion-${new Date().toISOString().replace(/[:.]/g, '-')}`)
const dataDir = join(scratch, 'plugin-data')
for (const d of ['home', 'dsh', 'xc', 'xd', 'xs', 'tmp', 'ws']) await mkdir(join(scratch, d), { recursive: true })
await mkdir(dataDir, { recursive: true })
if (!fresh) for (const sub of ['node', 'runtime']) await symlink(join(sourceRoot, sub), join(dataDir, sub), process.platform === 'win32' ? 'junction' : 'dir')
Object.assign(process.env, {
  HOME: join(scratch, 'home'), USERPROFILE: join(scratch, 'home'), DSH_HOME: join(scratch, 'dsh'), XDG_CACHE_HOME: join(scratch, 'xc'), XDG_DATA_HOME: join(scratch, 'xd'),
  XDG_STATE_HOME: join(scratch, 'xs'), TMPDIR: join(scratch, 'tmp'), DSH_TELEMETRY_DISABLED: '1',
})
const { resolveDshHome } = await import('../src/engine/layout.mjs')
// 硬闸：解析出来的 DSH 目录必须在这次的测试目录里，绝不能是真实的 ~/.dsh
assert.ok(resolveDshHome(process.env).startsWith(scratch) && !resolveDshHome(process.env).startsWith(join(homedir(), '.dsh')), 'DSH_HOME must point into the test folder')
console.log(`test data: ${scratch}`)

// 用户 DSH 目录顶层的 cordis.patch.yml：所有组合共用，融合插件只读不写
const HOME_PATCH = '# the user\'s own global patch; DSH2Forsion must never write this file\n[]\n'
await writeFile(join(scratch, 'dsh', 'cordis.patch.yml'), HOME_PATCH)

const settings = { autoStart: false, downloadSource: 'auto' }
const routes = new Map()
const router = { get: (p, h) => routes.set(`GET ${p}`, h), post: (p, h) => routes.set(`POST ${p}`, h) }
let meta = null, resident = null, modelProvider = null
const holds = []
const ctx = {
  paths: { pluginDir, dataDir },
  sdk: {
    pluginStore: { getScopeSettings: () => settings, isPluginEnabledSync: () => true, setScopeSettings: async (_id, _scope, patch) => Object.assign(settings, patch) },
    engines: { hold: async (engineId, sessionId, userId) => { holds.push({ engineId, sessionId, userId }); return { ok: true, engineSessionId: 'e-held', state: 'open' } } },
  },
  registerPlugin: m => { meta = m },
  registerSkillProvider: () => {},
  registerModelProvider: p => { modelProvider = p },
  registerResidentEngine: h => { resident = h },
  registerScopedRoutes: fn => fn(router),
  log: line => console.log(`  [engine] ${line}`),
}
const call = (method, path, body, user = { userId: 'u1' }) => new Promise((resolve, reject) => {
  const h = routes.get(`${method} ${path}`)
  if (!h) return reject(new Error(`no route ${method} ${path}`))
  const res = { code: 200, status(c) { this.code = c; return this }, json(v) { if (this.code >= 400) reject(new Error(`${path} → ${this.code}: ${v.error}`)); else resolve(v) } }
  h({ body: body ?? {}, user }, res)
})

const { createPlugin } = await import(pathToFileURL(join(pluginDir, 'dist/index.js')).href)
const engine = createPlugin()
let conn = null, acpId = 0, acpBuf = ''
const acpWaiters = new Map()
const acp = (method, params, ms = 60_000) => new Promise((resolve, reject) => {
  const id = ++acpId
  const timer = setTimeout(() => { acpWaiters.delete(id); reject(new Error(`ACP ${method} timed out`)) }, ms)
  acpWaiters.set(id, m => { clearTimeout(timer); m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result) })
  conn.input.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
})
let web = null
const webRpc = async (method, args) => {
  if (!web.cookie) { const login = await fetch(web.url, { redirect: 'manual' }); web.cookie = (login.headers.get('set-cookie') ?? '').split(';')[0] }
  const r = await fetch(`${web.base}/api/${method}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: web.base, cookie: web.cookie },
    body: JSON.stringify({ type: 'client-request', rpcId: `t-${randomUUID()}`, method, payload: { args } }) })
  return r.json()
}
const profilePkg = async () => JSON.parse(await readFile(join(scratch, 'dsh/profiles/forsion/package.json'), 'utf8'))

try {
  await it('activates: registers the resident DSH host and the plugin; tools are not offered to Tangu by default; no model provider', async () => {
    await engine.activate(ctx)
    assert.equal(resident?.engineId, 'dsh')
    assert.equal(typeof resident.connect, 'function')
    assert.equal(meta.settings.fields.find(f => f.key === 'exposeTools').default, false)
    assert.equal(modelProvider, null)
    if (fresh) {
      // 界面上「下载并启动」：装完运行时会顺手起 DSH
      assert.equal((await call('POST', '/runtime/install')).started, true)
      await waitFor('the runtime install', async () => { const st = await call('GET', '/status'); if (st.job.error) throw new Error(st.job.error); return st.runtime.installed && !st.job.running }, 25 * 60_000)
    } else {
      assert.equal((await call('GET', '/status')).sidecar.state, 'stopped', 'autoStart off: nothing runs until first use')
    }
  })

  await it('first chat connects: DSH starts on demand with the fused profile in the user\'s DSH folder; the shared home patch is untouched', async () => {
    conn = await resident.connect()
    assert.ok(conn && conn.id && conn.input && conn.output && conn.closed, 'connect() returned a live connection')
    conn.output.on('data', d => {
      acpBuf += d
      let i
      while ((i = acpBuf.indexOf('\n')) >= 0) {
        const line = acpBuf.slice(0, i); acpBuf = acpBuf.slice(i + 1)
        const m = JSON.parse(line) // 只有 JSON 行能到这里（就绪行等被插件滤掉）
        if (m.id != null && !m.method && acpWaiters.has(m.id)) { acpWaiters.get(m.id)(m); acpWaiters.delete(m.id) }
        else if (m.method && m.id != null) conn.input.write(JSON.stringify({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'not in this test' } }) + '\n')
      }
    })
    const prof = join(scratch, 'dsh/profiles/forsion')
    assert.ok(existsSync(join(prof, '.dsh2forsion-fusion.json')), 'marker written')
    assert.deepEqual((await profilePkg()).dsh.profile.bundles, ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@deepseek-ai/dsh-acp-app', 'dsh2forsion-bridge'])
    assert.match(await readFile(join(prof, 'cordis.patch.yml'), 'utf8'), /openBrowser: false/)
    assert.equal(await readFile(join(scratch, 'dsh', 'cordis.patch.yml'), 'utf8'), HOME_PATCH)
    const again = await resident.connect()
    assert.equal(again.id, conn.id, 'a second connect while running gets the same process')
  })

  let sessionId
  await it('ACP over the connection: initialize and a new session; the web interface of the same process knows that session', async () => {
    const init = await acp('initialize', { protocolVersion: 1, clientCapabilities: {} })
    assert.equal(init.protocolVersion, 1)
    sessionId = (await acp('session/new', { cwd: join(scratch, 'ws'), mcpServers: [] })).sessionId
    assert.ok(sessionId)
    const wb = await call('POST', '/workbench')
    assert.match(wb.url, /^http:\/\/127\.0\.0\.1:\d+\/\?token=/)
    web = { url: wb.url, base: wb.base }
    const st = await webRpc('session/state', { request: { sessionId } })
    assert.equal(st?.result?.ok, true, `session/state: ${JSON.stringify(st?.result?.error ?? st).slice(0, 200)}`)
  })

  await it('logs never carry the launch token', async () => {
    const { sidecar, lines } = await call('GET', '/logs')
    const all = [...sidecar, ...lines].join('\n')
    assert.match(all, /token=<redacted>/)
    assert.ok(!/token=(?!<redacted>)/.test(all))
    assert.ok(!all.includes(new URL(web.url).searchParams.get('token')))
  })

  const install = () => {
    const requestId = randomUUID()
    const done = webRpc('pluginManager/installBundle', { spec: PLUGIN, options: { enabled: true, requestId } })
    done.catch(() => {}) // 测试中途失败时别让它变成未处理的拒绝、来不及停 DSH
    return { requestId, done }
  }
  const reviewed = async () => waitFor('the review report', async () => (await call('GET', '/reviews')).reviews.find(r => r.state === 'ready'), 240_000)

  await it(`installing ${PLUGIN} from DSH's plugin page is held; denying it leaves the profile without it (negative control)`, async () => {
    const pid = (await call('GET', '/status')).sidecar.pid
    const first = install()
    const checking = await waitFor('the held install', async () => (await call('GET', '/reviews')).reviews[0], 20_000)
    assert.equal(checking.spec, PLUGIN)
    const r = await reviewed()
    console.log(`  report: ${JSON.stringify({ verdict: r.report?.verdict, tools: r.report?.tools, promptChars: r.report?.promptChars, sections: r.report?.sections, inactive: r.report?.inactive, hosts: r.report?.hosts, ms: r.report?.ms })}`)
    assert.ok(['ok', 'partial'].includes(r.report?.verdict), `verdict ${r.report?.verdict}: ${(r.report?.reasons ?? []).join('; ')}`)
    assert.ok(r.report.measured.before && r.report.measured.after, 'both trial starts came up')
    assert.equal(typeof r.report.promptChars, 'number')
    assert.ok(Array.isArray(r.report.hosts))
    await call('POST', '/reviews/decide', { id: r.id, allow: false })
    const res = await first.done
    assert.notEqual(res?.result?.ok === true && res.result.value?.application !== 'failed', true, 'denied install must not succeed')
    assert.ok(!Object.hasOwn((await profilePkg()).dependencies ?? {}, PLUGIN.replace(/@[^@]+$/, '')), 'not in the profile')
    assert.equal((await call('GET', '/status')).sidecar.pid, pid, 'DSH did not restart')
  })

  await it(`allowing it installs ${PLUGIN} into the running DSH without a restart`, async () => {
    const pid = (await call('GET', '/status')).sidecar.pid
    const second = install()
    const r = await reviewed()
    await call('POST', '/reviews/decide', { id: r.id, allow: true })
    const res = await second.done
    assert.equal(res?.result?.ok, true, JSON.stringify(res?.result?.error ?? res).slice(0, 300))
    assert.ok(Object.hasOwn((await profilePkg()).dependencies ?? {}, PLUGIN.replace(/@[^@]+$/, '')), 'in the profile')
    const { plugins } = await call('GET', '/plugins')
    assert.ok(plugins.some(p => p.name === PLUGIN.replace(/@[^@]+$/, '')))
    assert.equal((await call('GET', '/status')).sidecar.pid, pid, 'DSH did not restart')
    // 宿主开着的那场会话还在
    const st = await webRpc('session/state', { request: { sessionId } })
    assert.equal(st?.result?.ok, true)
  })

  await it('"open in the workbench" hands the conversation to the host first', async () => {
    const r = await call('POST', '/hold', { sessionId: 's-forsion' })
    assert.equal(r.ok, true)
    assert.deepEqual(holds, [{ engineId: 'dsh', sessionId: 's-forsion', userId: 'u1' }])
  })

  await it('deactivate stops DSH: the connection closes and no DSH process is left', async () => {
    await engine.deactivate()
    await Promise.race([conn.closed, sleep(8000).then(() => { throw new Error('connection did not close') })])
    if (process.platform !== 'win32') await waitFor('no DSH left', () => !execFileSync('ps', ['-axo', 'pid,command'], { encoding: 'utf8' }).split('\n').some(l => l.includes('dsh/lib/bin.js') && l.includes('--profile forsion') && l.includes(scratch)), 10_000)
    assert.equal(await resident.connect(), null, 'after deactivate there is no resident process')
  })
} catch (error) {
  console.error(error)
  try { await engine.deactivate() } catch { /* 已停 */ }
  process.exitCode = 1
}
console.log(`check-fusion: ${n} passed`)
