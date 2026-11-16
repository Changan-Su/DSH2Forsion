// 右栏页（第 2 档）端到端：真运行时 + 官方 DSH + 本机假模型，全新目录。引擎半身像 tangu-agent 那样激活，测试自己当 Forsion：
// ACP 建一场会话、跑一句，再用一个无头 Chromium 像 Forsion 右栏那样打开「只画一页」的 DSH 网页（地址 # 带页、会话、口令），
// 看 DSH 自己画出的只有右侧栏那一页、报回的结果对、换页 / 收起 / 变宽 / DSH 重启都接得住，以及对不上时报得出来。
//
//   DSH2FORSION_ROOT=<已装好运行时的根目录:node/ 与 runtime/> PLAYWRIGHT_CORE=<某个检出里的 node_modules/playwright-core> node tests/check-rail.mjs
//
// 只装测试自己的 fixture 插件（tests/fixtures/rail-page：经 DSH 公开接口登记一页，代替社区插件里带右栏页的那类），不跑第三方代码。
// 启动令牌不打印。截图存在测试目录的 shots/ 里（不入库）。
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, symlink, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { startStubModel } from './helpers/stub-model.mjs'

const repo = join(dirname(fileURLToPath(import.meta.url)), '..')
const pluginDir = join(repo, 'plugin/tangu-plugins/dsh2forsion')
const sourceRoot = process.env.DSH2FORSION_ROOT
const pwDir = process.env.PLAYWRIGHT_CORE
if (!sourceRoot || !pwDir) { console.error('set DSH2FORSION_ROOT (data root with node/ and runtime/) and PLAYWRIGHT_CORE (a node_modules/playwright-core folder)'); process.exit(2) }
const { chromium } = createRequire(join(pwDir, 'package.json'))('playwright-core')
const findChromium = () => {
  if (process.env.CHROMIUM_EXE) return process.env.CHROMIUM_EXE
  const own = chromium.executablePath()
  if (existsSync(own)) return own
  const mac = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  if (existsSync(mac)) return mac
  throw new Error('no Chromium: set CHROMIUM_EXE')
}

let n = 0
const it = async (name, fn) => { const t0 = Date.now(); await fn(); n++; console.log(`ok ${n} ${name} (${((Date.now() - t0) / 1000).toFixed(1)}s)`) }
const sleep = ms => new Promise(r => setTimeout(r, ms))
const waitFor = async (what, fn, ms) => {
  const t0 = Date.now()
  for (;;) {
    const v = await fn()
    if (v) return v
    if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`)
    await sleep(250)
  }
}

const scratch = resolve(repo, '.tmp', `rail-${new Date().toISOString().replace(/[:.]/g, '-')}`)
const dataDir = join(scratch, 'plugin-data')
const WS = join(scratch, 'ws')
const SHOTS = join(scratch, 'shots')
for (const d of ['home', 'dsh', 'xc', 'xd', 'xs', 'tmp', 'ws/docs', 'outside', 'shots']) await mkdir(join(scratch, d), { recursive: true })
await mkdir(dataDir, { recursive: true })
for (const sub of ['node', 'runtime']) await symlink(join(sourceRoot, sub), join(dataDir, sub), process.platform === 'win32' ? 'junction' : 'dir')
await writeFile(join(WS, 'README.md'), '# rail check\n')
await writeFile(join(WS, 'docs', 'release-notes.md'), '# notes\n')
Object.assign(process.env, {
  HOME: join(scratch, 'home'), USERPROFILE: join(scratch, 'home'), DSH_HOME: join(scratch, 'dsh'), XDG_CACHE_HOME: join(scratch, 'xc'), XDG_DATA_HOME: join(scratch, 'xd'),
  XDG_STATE_HOME: join(scratch, 'xs'), TMPDIR: join(scratch, 'tmp'), DSH_TELEMETRY_DISABLED: '1',
})
const { resolveDshHome, layout } = await import('../src/engine/layout.mjs')
assert.ok(resolveDshHome(process.env).startsWith(scratch) && !resolveDshHome(process.env).startsWith(join(homedir(), '.dsh')), 'DSH_HOME must point into the test folder')
console.log(`test data: ${scratch}`)

const stub = await startStubModel({ outside: join(scratch, 'outside') })
await writeFile(join(scratch, 'dsh', '.env'), `DEEPSEEK_BASE_URL=${stub.url}\nDEEPSEEK_API_KEY=stub-not-a-real-key\n`)
const { createPlugin } = await import(pathToFileURL(join(pluginDir, 'dist/index.js')).href)

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
  let conn = null, id = 0, buf = ''
  const waiters = new Map()
  const send = m => conn.input.write(JSON.stringify(m) + '\n')
  const onData = d => {
    buf += d
    let i
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1)
      const m = JSON.parse(line)
      if (m.id != null && !m.method && waiters.has(m.id)) { waiters.get(m.id)(m); waiters.delete(m.id) }
      else if (m.method && m.id != null) send({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'not in this test' } })
    }
  }
  const acp = (method, params, ms = 90_000) => new Promise((ok, fail) => {
    const my = ++id
    const timer = setTimeout(() => { waiters.delete(my); fail(new Error(`ACP ${method} timed out`)) }, ms)
    waiters.set(my, m => { clearTimeout(timer); m.error ? fail(new Error(`${method}: ${m.error.message}`)) : ok(m.result) })
    send({ jsonrpc: '2.0', id: my, method, params })
  })
  const attach = async () => {
    conn = await resident.connect()
    buf = ''
    conn.output.on('data', onData)
    await acp('initialize', { protocolVersion: 1, clientCapabilities: {} })
  }
  await attach()
  return { engine, call, acp, attach, get conn() { return conn } }
}
const noDshLeft = () => !execFileSync('ps', ['-axo', 'pid,command'], { encoding: 'utf8' }).split('\n').some(l => l.includes('dsh/lib/bin.js') && l.includes(scratch))

let A = null
let browser = null
const pageLogs = []
try {
  A = await boot()
  const { call, acp } = A
  // fixture 插件：像用户在 DSH 里装插件那样进 forsion 组合（dsh plugin add），再重启常驻 DSH 让它加载
  const paths = layout(dataDir)
  const add = spawnSync(paths.nodeBin, [paths.dshBin, 'plugin', '--profile', 'forsion', 'add', '--ignore-scripts', `file:${join(repo, 'tests/fixtures/rail-page')}`],
    { env: { ...process.env, PATH: `${paths.nodeBinDir}:${join(dirname(paths.dshBin), '..', '..', '..', '.bin')}:${process.env.PATH}` }, encoding: 'utf8' })
  assert.equal(add.status, 0, `fixture install failed: ${(add.stdout + add.stderr).slice(-600)}`)
  await call('POST', '/sidecar/restart')
  await A.attach()
  const S1 = (await acp('session/new', { cwd: WS, mcpServers: [] })).sessionId
  const S2 = (await acp('session/new', { cwd: join(WS, 'docs'), mcpServers: [] })).sessionId
  for (const s of [S1, S2]) assert.equal((await acp('session/prompt', { sessionId: s, prompt: [{ type: 'text', text: 'hello' }] })).stopReason, 'end_turn')

  browser = await chromium.launch({ executablePath: findChromium(), headless: true })
  let seq = 0
  const railUrl = (rail, kind, session) => `${rail.url}#d2f-rail=${encodeURIComponent(kind)}&d2f-session=${encodeURIComponent(session)}&d2f-nonce=${rail.nonce}&n=${++seq}`
  const reportOf = async (rail, n) => waitFor(`the rail report #${n}`, async () => {
    const r = await call('POST', '/rail/report', { nonce: rail.nonce })
    return r?.report && r.report.n === String(n) ? r.report : null
  }, 20_000)
  const visibleText = (page, text) => page.getByText(text, { exact: false }).first().isVisible().catch(() => false)

  // 一、窄（Forsion 右栏常见宽度 360）：只画文件页
  const narrow = await browser.newContext({ viewport: { width: 360, height: 760 }, locale: 'zh-CN' })
  await narrow.addInitScript(() => { window.__D2F_DEBUG__ = true })
  const page = await narrow.newPage()
  const logs = pageLogs
  page.on('console', m => { if (/dsh2forsion/.test(m.text())) logs.push(m.text()) })
  page.on('pageerror', e => logs.push(`pageerror: ${e.message}`))
  let rail = await call('POST', '/rail')
  assert.ok(rail.url && rail.nonce, 'the engine half gives a login address and a report nonce')

  await it('narrow (360): the files page alone, on the Forsion conversation\'s session; the report lists the pages, plugin page included', async () => {
    await page.goto(railUrl(rail, 'files', S1))
    const r = await reportOf(rail, seq)
    assert.equal(r.state, 'ok', JSON.stringify(r))
    assert.equal(r.session, S1)
    await waitFor('the right sidebar covering the page', async () => (await call('POST', '/rail/report', { nonce: rail.nonce })).report?.covering, 8_000)
    const kinds = r.pages.map(p => p.kind)
    assert.ok(kinds.includes('files') && kinds.includes('d2f-fixture'), `pages: ${kinds.join(', ')}`)
    await waitFor('the file list', () => visibleText(page, 'README.md'), 15_000)
    assert.ok(await visibleText(page, 'docs'))
    await page.screenshot({ path: join(SHOTS, '01-narrow-files.png') })
  })

  await it('switching pages is a hash change on the same page (no reload): the plugin page', async () => {
    const before = await page.evaluate(() => performance.timeOrigin)
    await page.evaluate(u => { location.hash = u.slice(u.indexOf('#')) }, railUrl(rail, 'd2f-fixture', S1))
    const r = await reportOf(rail, seq)
    assert.equal(r.state, 'ok', JSON.stringify(r))
    await waitFor('the plugin page', () => visibleText(page, 'D2F-FIXTURE-PAGE'), 15_000)
    assert.equal(await page.evaluate(() => performance.timeOrigin), before, 'same document')
    await page.screenshot({ path: join(SHOTS, '02-narrow-plugin-page.png') })
  })

  await it('following another Forsion conversation: the files page of that session', async () => {
    await page.evaluate(u => { location.hash = u.slice(u.indexOf('#')) }, railUrl(rail, 'files', S2))
    const r = await reportOf(rail, seq)
    assert.equal(r.state, 'ok', JSON.stringify(r))
    assert.equal(r.session, S2)
    await waitFor('the docs folder as root', () => visibleText(page, 'release-notes.md'), 15_000)
    assert.ok(!(await visibleText(page, 'README.md')), 'not the other session\'s folder')
  })

  await it('coming back without naming a page (*): the page DSH remembered for that session (the plugin page), not files', async () => {
    await page.evaluate(u => { location.hash = u.slice(u.indexOf('#')) }, railUrl(rail, '*', S1))
    const r = await reportOf(rail, seq)
    assert.equal(r.state, 'ok', JSON.stringify(r))
    assert.equal(r.session, S1)
    await waitFor('the plugin page S1 was on', () => visibleText(page, 'D2F-FIXTURE-PAGE'), 15_000)
    await waitFor('the right sidebar covering the page', async () => (await call('POST', '/rail/report', { nonce: rail.nonce })).report?.covering, 8_000)
    await page.screenshot({ path: join(SHOTS, '02b-narrow-remembered-page.png') })
  })

  await it('collapsing the right sidebar inside DSH (its own control / shortcut): it opens again', async () => {
    await page.evaluate(u => { location.hash = u.slice(u.indexOf('#')) }, railUrl(rail, 'files', S1))
    await reportOf(rail, seq)
    await waitFor('the file list', () => visibleText(page, 'README.md'), 15_000)
    const buttons = await page.$$eval('button[aria-label], [role=button][aria-label]', els => els.map(e => e.getAttribute('aria-label')))
    const label = buttons.find(b => /收起|折叠|关闭侧栏|collapse|hide/i.test(b ?? ''))
    assert.ok(label, `a collapse control: ${buttons.join(' | ')}`)
    await page.click(`[aria-label="${label}"]`)
    await sleep(400)
    await waitFor('the page again', () => visibleText(page, 'README.md'), 8_000)
    await page.screenshot({ path: join(SHOTS, '03-narrow-after-collapse.png') })
  })

  await it('a page kind this DSH does not have: reported as missing with the real page list', async () => {
    await page.evaluate(u => { location.hash = u.slice(u.indexOf('#')) }, railUrl(rail, 'no-such-page', S1))
    const r = await reportOf(rail, seq)
    assert.equal(r.state, 'missing', JSON.stringify(r))
    assert.ok(r.pages.some(p => p.kind === 'files'))
  })

  // 二、宽（右栏拖得很宽 / 撕成独立窗口）：DSH 不会自己铺满，按一次它自己的「全屏」
  await it('wide (900): the page still covers the whole surface', async () => {
    const wide = await browser.newContext({ viewport: { width: 900, height: 760 }, locale: 'zh-CN' })
    const p = await wide.newPage()
    await p.goto(railUrl(rail, 'files', S1))
    const r = await reportOf(rail, seq)
    assert.equal(r.state, 'ok', JSON.stringify(r))
    await waitFor('covering', async () => (await call('POST', '/rail/report', { nonce: rail.nonce })).report?.covering, 10_000)
    await waitFor('the file list', () => visibleText(p, 'README.md'), 15_000)
    await p.screenshot({ path: join(SHOTS, '04-wide-files.png') })
    await wide.close()
  })

  // 三、一份登录地址在两个分区（工作台、右栏）都能登录；DSH 重启后换新地址重开
  await it('the same login address works in a second, separate partition (the workbench keeps its own storage)', async () => {
    const other = await browser.newContext({ viewport: { width: 1100, height: 760 } })
    const p = await other.newPage()
    await p.goto(rail.url)
    await waitFor('logged in', async () => !/login|登录/i.test(await p.title()) && (await p.evaluate(() => document.body.innerText.length)) > 50, 15_000)
    const leaked = await p.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('dsh.sidebar-right.v1.')))
    assert.deepEqual(leaked, [], 'the rail\'s layout does not reach another partition')
    await other.close()
  })

  await it('after DSH restarts (new port and token): a new address, the page comes back', async () => {
    await call('POST', '/sidecar/restart')
    await A.attach()
    const again = await call('POST', '/rail')
    assert.notEqual(again.url, rail.url, 'new address')
    rail = again
    await page.goto(railUrl(rail, 'files', S1))
    const r = await reportOf(rail, seq)
    assert.equal(r.state, 'ok', JSON.stringify(r))
    await waitFor('the file list', () => visibleText(page, 'README.md'), 15_000)
  })

  await it('an old nonce cannot write a report; a forged one is refused', async () => {
    const base = new URL(rail.url).origin
    const forged = await fetch(`${base}/forsion-bridge/rail/report`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-d2f-rail-nonce': 'not-a-nonce' }, body: JSON.stringify({ state: 'ok' }) })
    assert.equal(forged.status, 403)
    const noSecret = await fetch(`${base}/forsion-bridge/rail?nonce=${rail.nonce}`)
    assert.equal(noSecret.status, 401, 'reading a report needs the startup secret')
  })

  // 四、负对照：这一版 DSH 没有右侧栏的服务（在页面里把那个模块挡掉，模拟上游拆包 / 改名）→ 报 incompatible
  await it('negative control: without DSH\'s right sidebar services the page reports incompatible', async () => {
    const neg = await browser.newContext({ viewport: { width: 360, height: 760 } })
    // 这一版 DSH 「没有」右侧栏那个包：拦掉它的网页脚本（模拟上游拆包 / 改名）
    const blocked = []
    await neg.route(/dsh-client-ui-sidebar-right/, route => { blocked.push(route.request().url()); return route.abort() })
    const p = await neg.newPage()
    await p.goto(railUrl(rail, 'files', S1))
    // 两种结局都算「对不上」：DSH 照样起来、桥报 incompatible；或者 DSH 的网页整个起不来、桥的模块都没跑到，一直没有回报
    // （Forsion 那半等回报有时限，到点同样退回工作台提示）。这里记下是哪一种。
    const r = await waitFor('a report or the deadline', async () => (await call('POST', '/rail/report', { nonce: rail.nonce })).report?.n === String(seq) ? 'reported' : null, 15_000).catch(() => 'silent')
    const got = (await call('POST', '/rail/report', { nonce: rail.nonce })).report
    assert.ok(blocked.length > 0, 'the right sidebar bundle was requested and blocked')
    if (r === 'reported') assert.equal(got.state, 'incompatible', JSON.stringify(got))
    else assert.ok(!got || got.n !== String(seq), 'no ok report')
    console.log(`   negative control: ${r === 'reported' ? `reported ${got.state} (${got.reason})` : 'no report (the DSH page did not get as far as the bridge module)'}`)
    await p.screenshot({ path: join(SHOTS, '05-negative-no-right-sidebar.png') })
    await neg.close()
  })

  await it('stopping leaves no DSH process', async () => {
    await browser.close(); browser = null
    await A.engine.deactivate()
    await waitFor('no DSH left', noDshLeft, 15_000)
    A = null
  })
  if (logs.length) console.log(`page log (last 6):\n  ${logs.slice(-6).join('\n  ')}`)
} catch (error) {
  console.error(error)
  console.error(`page log (last 20):\n  ${pageLogs.slice(-20).join('\n  ')}`)
  try { if (A) console.error((await A.call('GET', '/logs')).sidecar.slice(-25).join('\n').replace(/token=[\w.%-]+/g, 'token=<redacted>')) } catch { /* 已停 */ }
  process.exitCode = 1
} finally {
  if (browser) await browser.close().catch(() => {})
  if (A) { try { await A.engine.deactivate() } catch { /* 已停 */ } }
  await stub.close()
}
console.log(`check-rail: ${n} passed; screenshots in ${SHOTS}`)
