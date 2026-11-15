// 渲染半身检查：照宿主的方式（new Function('ctx', source)）在 happy-dom 里加载 plugin/main.js，
// 用假 ctx 驱动 DSH 工作台、Harness 卡上的行、对话右键菜单、装插件体检卡与运行时管理页的各条路径。
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Window } from 'happy-dom'

const repo = join(dirname(fileURLToPath(import.meta.url)), '..')
const source = await readFile(join(repo, 'plugin/main.js'), 'utf8')
const manifest = JSON.parse(await readFile(join(repo, 'plugin/manifest.json'), 'utf8'))

let n = 0
const it = async (name, fn) => { await fn(); n++; console.log(`ok ${n} ${name}`) }
const tick = (ms = 0) => new Promise(r => setTimeout(r, ms))
const until = async (fn, ms = 3000) => {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await tick(10) }
  throw new Error('timed out waiting')
}

function setup({ locale = 'zh', routes = {}, withSurface = false, tangu = {}, harness = true } = {}) {
  const window = new Window({ url: 'http://localhost/' })
  globalThis.window = window
  globalThis.document = window.document
  globalThis.Node = window.Node
  globalThis.MutationObserver = window.MutationObserver
  document.documentElement.setAttribute('data-mode', 'dark')
  const calls = []
  const reg = { views: {}, settings: {}, commands: {}, harness: null, refreshed: 0, notes: [], surfaces: [] }
  let loc = locale
  const localeSubs = new Set()
  const ctx = {
    getLocale: () => loc,
    subscribeLocale: cb => { localeSubs.add(cb); return () => localeSubs.delete(cb) },
    registerView: v => { reg.views[v.id] = v },
    registerSettingsView: v => { reg.settings[v.id] = v },
    registerCommand: c => { reg.commands[c.id] = c },
    openView: (id, opts) => calls.push({ openView: id, location: opts?.location }),
    notify: (message, opts) => reg.notes.push({ message, level: opts?.level }),
    app: { openSettings: target => calls.push({ openSettings: target }) },
    tangu: {
      ...tangu,
      request: async (engine, path, opts = {}) => {
        assert.equal(engine, 'dsh2forsion')
        calls.push({ path, method: opts.method ?? 'GET', body: opts.body })
        const handler = routes[`${opts.method ?? 'GET'} ${path}`] ?? routes[path]
        if (!handler) throw new Error(`no route ${path}`)
        return typeof handler === 'function' ? handler(opts.body) : handler
      },
    },
  }
  if (harness) ctx.registerEngineHarness = def => { reg.harness = def; return { refresh: () => { reg.refreshed++ }, dispose() {} } }
  if (withSurface) ctx.ui = { mountWebSurface: (el, o) => {
    const d = document.createElement('div'); d.className = 'surface'; d.dataset.url = o.url; d.dataset.partition = o.partition; el.append(d)
    const handle = { reloads: 0, navigated: [], opts: o, reload() { handle.reloads++ }, dispose() { d.remove() }, navigate(u) { handle.navigated.push(u) }, focus() {} }
    reg.surfaces.push(handle)
    return handle
  } }
  new Function('ctx', source)(ctx)
  const setLocale = l => { loc = l; for (const cb of localeSubs) cb(l) }
  return { window, ctx, reg, calls, setLocale }
}

const status = (over = {}) => ({
  pluginVersion: '0.2.0', dshVersion: '0.2.2-rc.3', pinnedVersion: '0.2.2-rc.3', nodeVersion: 'v24.22.0',
  runtime: { installed: true, installedVersions: ['0.2.2-rc.3'], previous: null }, job: { running: false, lines: [] },
  fusion: { home: '/home/u/.dsh', profile: 'forsion', incompatible: null, resident: true, events: [] },
  channel: { published: null, latest: null }, sidecar: { state: 'running', base: 'http://127.0.0.1:4100' },
  tools: [], promptSections: [], pluginJob: null, settings: { updateChannel: 'pinned' }, ...over,
})


await it('registers the workbench view, the runtime page, two commands and the DSH harness; no Space', () => {
  const { reg } = setup()
  assert.deepEqual(Object.keys(reg.views), ['workbench'])
  assert.deepEqual(Object.keys(reg.settings), ['manage'])
  assert.deepEqual(Object.keys(reg.commands).sort(), ['dsh2forsion-manage', 'dsh2forsion-open-workbench'])
  assert.equal(reg.harness.engineId, 'dsh')
  assert.deepEqual(reg.harness.sessionActions.map(a => a.id), ['open-in-workbench'])
  assert.deepEqual(reg.harness.sessionActions[0].label, { zh: '在 DSH 工作台里打开', en: 'Open in the DSH workbench' })
  assert.equal(manifest.spaces, undefined)
  assert.equal(typeof reg.commands['dsh2forsion-open-workbench'].title, 'function')
})

await it('every string exists in both languages, English has no Chinese characters, placeholders match', () => {
  const STRINGS = new Function('ctx', `${source}\n;return STRINGS`)({ registerView() {}, registerSettingsView() {}, registerCommand() {} })
  assert.deepEqual(Object.keys(STRINGS.zh).sort(), Object.keys(STRINGS.en).sort())
  for (const [k, v] of Object.entries(STRINGS.en)) {
    assert.ok(!/[㐀-鿿]/.test(v), `en.${k} has Chinese`)
    const vars = s => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join(',')
    assert.equal(vars(v), vars(STRINGS.zh[k]), `placeholders differ in ${k}`)
  }
})

await it('first open: onboarding names the DSH folder and download; install polls, then the workbench mounts in the controlled surface', async () => {
  let polls = 0
  const { reg, calls } = setup({
    withSurface: true,
    routes: {
      '/status': () => {
        if (!calls.some(c => c.path === '/runtime/install')) return status({ runtime: { installed: false }, sidecar: { state: 'stopped' } })
        polls++
        return polls < 2 ? status({ runtime: { installed: false }, job: { running: true, lines: ['download node'] }, sidecar: { state: 'stopped' } }) : status()
      },
      'POST /runtime/install': { started: true },
      'POST /workbench': { url: 'http://127.0.0.1:4100/?token=abc', base: 'http://127.0.0.1:4100' },
      'POST /appearance': { ok: true },
      '/reviews': { reviews: [] },
    },
  })
  const el = document.createElement('div')
  const dispose = reg.views.workbench.mount(el)
  const btn = await until(() => [...el.querySelectorAll('button')].find(b => b.textContent === '下载并启动'))
  assert.match(el.textContent, /\/home\/u\/\.dsh/)
  assert.match(el.textContent, /1\.1 GB/)
  btn.click()
  const surface = await until(() => el.querySelector('.surface'), 6000)
  assert.equal(surface.dataset.url, 'http://127.0.0.1:4100/?token=abc')
  assert.equal(surface.dataset.partition, 'workbench')
  await until(() => calls.some(c => c.path === '/appearance' && c.body?.theme === 'dark' && c.body?.locale === 'zh'))
  dispose()
  assert.equal(el.querySelector('.surface'), null)
})

await it('an old host without the controlled surface: no raw webview, the workbench asks to update Forsion', async () => {
  const { reg } = setup({ routes: { '/status': status(), 'POST /workbench': { url: 'http://127.0.0.1:4100/?token=abc' }, 'POST /appearance': { ok: true }, '/reviews': { reviews: [] } } })
  const el = document.createElement('div')
  const dispose = reg.views.workbench.mount(el)
  const card = await until(() => el.querySelector('[data-d2f="old-host"]'))
  assert.match(card.textContent, /更新 Forsion/)
  assert.equal(el.querySelector('webview'), null)
  dispose()
})

await it('incompatible DSH: the workbench says to wait for a plugin update, chat falls back honestly, and going back is offered only when possible', async () => {
  const inc = { dshVersion: '0.2.3', reason: 'install review not armed' }
  for (const previous of [null, '0.2.2-rc.3']) {
    const { reg, calls } = setup({ withSurface: true, routes: { '/status': status({ fusion: { ...status().fusion, incompatible: inc } }), 'POST /workbench': { incompatible: inc, previous }, 'POST /runtime/previous': status(), 'POST /appearance': { ok: true }, '/reviews': { reviews: [] } } })
    const el = document.createElement('div')
    const dispose = reg.views.workbench.mount(el)
    await until(() => el.querySelector('[data-d2f="incompatible"]'))
    assert.match(el.textContent, /等插件更新/)
    assert.match(el.textContent, /依赖网页界面的 DSH 插件在这条路上不生效/)
    const back = el.querySelector('[data-act="runtime-previous"]')
    assert.equal(back.textContent, '先退回上一版 DSH')
    assert.equal(back.disabled, !previous)
    assert.equal(el.querySelector('.surface'), null)
    if (previous) { back.click(); await until(() => calls.some(c => c.path === '/runtime/previous')) }
    dispose()
  }
})

await it('the workbench remounts when DSH restarts on a new address and reloads when the host reopened a session', async () => {
  let base = 'http://127.0.0.1:4100', events = []
  const { reg } = setup({ withSurface: true, routes: {
    '/status': () => status({ sidecar: { state: 'running', base }, fusion: { ...status().fusion, events } }),
    'POST /workbench': () => ({ url: `${base}/?token=t`, base }), 'POST /appearance': { ok: true }, '/reviews': { reviews: [] } } })
  const el = document.createElement('div')
  const dispose = reg.views.workbench.mount(el)
  await until(() => el.querySelector('.surface'))
  events = [{ type: 'held', engineSessionId: 'e1', seq: 1 }, { type: 'reopened', engineSessionId: 'e1', sessionId: 's1', seq: 2 }]
  await until(() => reg.surfaces[0].reloads === 1, 5000)
  // 状态里只带最后 10 条：满了之后按序号照样认得出新来的
  events = Array.from({ length: 10 }, (_, i) => ({ type: i === 9 ? 'reopened' : 'held', engineSessionId: 'e1', seq: 20 + i }))
  await until(() => reg.surfaces[0].reloads === 2, 5000)
  events = events.slice(1).concat({ type: 'reopened', engineSessionId: 'e1', seq: 30 })
  await until(() => reg.surfaces[0].reloads === 3, 5000)
  base = 'http://127.0.0.1:4200'
  await until(() => el.querySelector('.surface')?.dataset.url === 'http://127.0.0.1:4200/?token=t', 5000)
  dispose()
})

await it('installing from DSH\'s own plugin page: the workbench shows the check, then the report, and the answer goes back', async () => {
  let reviews = [{ id: 'r1', spec: 'dsh-genui@0.3.3', state: 'checking' }]
  const { reg, calls } = setup({ withSurface: true, routes: {
    '/status': status(), 'POST /workbench': { url: 'http://127.0.0.1:4100/?token=t' }, 'POST /appearance': { ok: true },
    '/reviews': () => ({ reviews }), 'POST /reviews/decide': { ok: true } } })
  const el = document.createElement('div')
  const dispose = reg.views.workbench.mount(el)
  const card = await until(() => { const r = el.querySelector('[data-d2f="review"]'); return r && !r.hidden && r })
  assert.match(card.textContent, /正在体检 dsh-genui@0\.3\.3/)
  reviews = [{ id: 'r1', spec: 'dsh-genui@0.3.3', state: 'ready', report: { verdict: 'ok', name: 'dsh-genui', version: '0.3.3', tools: ['render_ui'], promptChars: 812, inactive: [], hosts: ['registry.example.org'] } }]
  await until(() => card.querySelector('[data-act="review-allow"]'), 4000)
  assert.match(card.textContent, /要装 dsh-genui 0\.3\.3 吗/)
  assert.match(card.textContent, /加了 1 个工具: render_ui/)
  assert.match(card.textContent, /提示词多了 812 字/)
  assert.match(card.textContent, /各部分都启动了/)
  assert.match(card.textContent, /registry\.example\.org/)
  card.querySelector('[data-act="review-allow"]').click()
  await until(() => calls.some(c => c.path === '/reviews/decide' && c.body?.id === 'r1' && c.body?.allow === true))
  assert.equal(card.hidden, true)
  dispose()
})

await it('harness rows: runtime with open / restart, the update channel select, and the plugin count with manage', async () => {
  const { reg, calls } = setup({ routes: { '/status': status(), '/plugins': { plugins: [{ name: 'dsh-genui', version: '0.3.3' }] }, 'POST /channel/set': status(), 'POST /sidecar/restart': status() } })
  const rows = await reg.harness.rows({ agentSlug: 'dsh-mate' })
  assert.deepEqual(rows.map(r => r.id), ['runtime', 'channel', 'dsh-plugins'])
  assert.deepEqual(rows[0].text, { zh: 'DSH 0.2.2-rc.3 · 在运行', en: 'DSH 0.2.2-rc.3 · running' })
  assert.equal(rows[0].tone, 'ok')
  assert.deepEqual(rows[0].actions.map(a => a.id), ['open-workbench', 'restart-dsh'])
  rows[0].actions[0].run()
  assert.deepEqual(calls.at(-1), { openView: 'workbench', location: 'main' })
  assert.equal(rows[1].select.value, 'pinned')
  rows[1].select.onChange('follow')
  await until(() => calls.some(c => c.path === '/channel/set' && c.body?.updateChannel === 'follow'))
  await until(() => reg.refreshed > 0)
  assert.deepEqual(rows[2].text, { zh: '1 个', en: '1' })
})

await it('harness rows while DSH is starting ask the host to read them again until DSH is up', async () => {
  let state = 'starting'
  const { reg } = setup({ routes: { '/status': () => status({ sidecar: { state, base: 'http://127.0.0.1:4100' } }), '/plugins': { plugins: [] } } })
  const first = await reg.harness.rows({ agentSlug: 'dsh-mate' })
  assert.deepEqual(first[0].text, { zh: 'DSH 0.2.2-rc.3 · 正在启动', en: 'DSH 0.2.2-rc.3 · starting' })
  await until(() => reg.refreshed === 1, 4000)
  state = 'running'
  const second = await reg.harness.rows({ agentSlug: 'dsh-mate' })
  assert.equal(second[0].tone, 'ok')
  await new Promise(r => setTimeout(r, 2000))
  assert.equal(reg.refreshed, 1, 'no more re-reads once DSH is running')
})

await it('harness rows when DSH does not match the plugin: danger text and a disabled go-back without an earlier version', async () => {
  const inc = { dshVersion: '0.2.3', reason: 'x' }
  const { reg } = setup({ routes: { '/status': status({ fusion: { ...status().fusion, incompatible: inc } }) } })
  const [runtime] = await reg.harness.rows({ agentSlug: 'a' })
  assert.equal(runtime.tone, 'danger')
  assert.deepEqual(runtime.actions.map(a => [a.id, a.disabled]), [['runtime-previous', true]])
  assert.match(runtime.hint.zh, /等插件更新/)
  assert.ok(!/[㐀-鿿]/.test(runtime.hint.en))
})

await it('right-click "open in the workbench": holds the conversation first, then opens the tab; a conversation that never ran on DSH still opens it with a note', async () => {
  let hold = { ok: true, engineSessionId: 'e1', state: 'open' }
  const { reg, calls } = setup({ routes: { 'POST /hold': () => hold } })
  reg.harness.sessionActions[0].run({ sessionId: 's1', agentSlug: 'dsh-mate' })
  await until(() => calls.some(c => c.openView === 'workbench'))
  const i = calls.findIndex(c => c.path === '/hold')
  assert.deepEqual(calls[i].body, { sessionId: 's1' })
  assert.ok(i < calls.findIndex(c => c.openView === 'workbench'))
  assert.equal(reg.notes.length, 0)
  hold = { ok: false, status: 404, code: 'no_engine_session', detail: 'x' }
  reg.harness.sessionActions[0].run({ sessionId: 's2' })
  await until(() => reg.notes.length === 1)
  assert.match(reg.notes[0].message, /还没在 DSH 上跑过/)
})

await it('right-clicking two conversations quickly: the later one wins even if the earlier hold answers last', async () => {
  const pending = new Map()
  const routes = {
    '/status': () => status(),
    'POST /workbench': { url: 'http://127.0.0.1:4100/?token=abc', base: 'http://127.0.0.1:4100' },
    'POST /appearance': { ok: true }, '/reviews': { reviews: [] },
    'POST /hold': (body) => new Promise(r => pending.set(body.sessionId, () => r({ ok: true, engineSessionId: `dsh-${body.sessionId}`, state: 'open' }))),
  }
  const { reg, calls } = setup({ withSurface: true, routes })
  reg.harness.sessionActions[0].run({ sessionId: 'A' })
  reg.harness.sessionActions[0].run({ sessionId: 'B' })
  await until(() => pending.size === 2)
  pending.get('B')()
  await until(() => calls.filter(c => c.openView === 'workbench').length === 1)
  pending.get('A')()
  await new Promise(r => setTimeout(r, 50))
  assert.equal(calls.filter(c => c.openView === 'workbench').length, 1, 'the superseded hold opens nothing')
  const el = document.createElement('div')
  const dispose = reg.views.workbench.mount(el)
  const surface = await until(() => el.querySelector('.surface'), 6000)
  assert.match(surface.dataset.url, /#d2f-session=dsh-B&n=\d+$/)
  dispose()
})

await it('a newer right-click whose hold fails drops the earlier, unused landing (the workbench does not land on the older conversation)', async () => {
  let hold = { ok: true, engineSessionId: 'dsh-A', state: 'open' }
  const routes = {
    '/status': () => status(),
    'POST /workbench': { url: 'http://127.0.0.1:4100/?token=abc', base: 'http://127.0.0.1:4100' },
    'POST /appearance': { ok: true }, '/reviews': { reviews: [] },
    'POST /hold': () => hold,
  }
  const { reg, calls } = setup({ withSurface: true, routes })
  reg.harness.sessionActions[0].run({ sessionId: 'A' })
  await until(() => calls.filter(c => c.openView === 'workbench').length === 1)
  hold = { ok: false, status: 409, code: 'busy', detail: 'x' }
  reg.harness.sessionActions[0].run({ sessionId: 'B' })
  await until(() => calls.filter(c => c.openView === 'workbench').length === 2)
  const el = document.createElement('div')
  const dispose = reg.views.workbench.mount(el)
  const surface = await until(() => el.querySelector('.surface'), 6000)
  assert.equal(surface.dataset.url, 'http://127.0.0.1:4100/?token=abc')
  dispose()
})

await it('bridge web module: lands once the conversation shows up; busy session lists do not push the fallback back', async () => {
  const clientSrc = await readFile(join(repo, 'src/dsh-bridge/client.js'), 'utf8')
  const window = new Window({ url: 'http://127.0.0.1:4100/?token=abc' })
  let mod = null
  const subs = new Set()
  let byId = {}
  const opened = []
  window.__ModuleLoader__ = { load: (m) => { mod = m } }
  const run = new window.Function('window', 'globalThis', 'location', 'history', clientSrc)
  run(window, window, window.location, window.history)
  const def = mod.factory()
  assert.equal([...def.inject].join(','), 'uiWorkspace,sessions')
  const cleanups = []
  def.apply({
    uiWorkspace: { openSession: (id) => opened.push(id) },
    sessions: { list: { getSnapshot: () => ({ byId }), subscribe: (f) => { subs.add(f); return () => subs.delete(f) } } },
    effect: (f) => { cleanups.push(f()) },
  })
  // 列表里已经有这一场：马上落过去，并把 # 那段从地址里拿掉
  byId = { s1: {} }
  window.location.hash = '#d2f-session=s1&n=1'
  await until(() => opened.length === 1)
  assert.equal(opened[0], 's1')
  assert.equal(window.location.hash, '')
  // 列表还没有这一场：别的会话一直在更新，也在约 4 秒时直接开（不被一次次往后推）
  window.location.hash = '#d2f-session=s2&n=2'
  const t0 = Date.now()
  const noise = setInterval(() => { for (const f of subs) f() }, 300)
  try { await until(() => opened.length === 2, 7000) } finally { clearInterval(noise) }
  assert.equal(opened[1], 's2')
  assert.ok(Date.now() - t0 < 5500, `fallback fired after ${Date.now() - t0} ms`)
  for (const c of cleanups) c?.()
  await window.happyDOM.close()
})

await it('the workbench lands on the held conversation: on first mount through the address, when already open by changing only the # part', async () => {
  const routes = {
    '/status': () => status(),
    'POST /workbench': { url: 'http://127.0.0.1:4100/?token=abc', base: 'http://127.0.0.1:4100' },
    'POST /appearance': { ok: true },
    '/reviews': { reviews: [] },
    'POST /hold': () => ({ ok: true, engineSessionId: 'dsh-sess/1', state: 'open' }),
  }
  const { reg, calls } = setup({ withSurface: true, routes })
  // 工作台还没开：落点跟着第一次挂载的地址走
  reg.harness.sessionActions[0].run({ sessionId: 's1' })
  await until(() => calls.some(c => c.openView === 'workbench'))
  const el = document.createElement('div')
  const dispose = reg.views.workbench.mount(el)
  const surface = await until(() => el.querySelector('.surface'), 6000)
  assert.equal(surface.dataset.url, 'http://127.0.0.1:4100/?token=abc#d2f-session=dsh-sess%2F1&n=1')
  // 已经开着：只交给宿主 # 那段（宿主照页面此刻的地址换，登录后页面去掉了 ?token 也不整页重载），不重新挂载
  reg.harness.sessionActions[0].run({ sessionId: 's1' })
  await until(() => reg.surfaces[0].navigated.length === 1)
  assert.equal(reg.surfaces[0].navigated[0], '#d2f-session=dsh-sess%2F1&n=2')
  assert.equal(reg.surfaces.length, 1)
  // 没有落点的普通打开：地址里不带 #
  dispose()
  const el2 = document.createElement('div')
  const dispose2 = reg.views.workbench.mount(el2)
  const plain = await until(() => el2.querySelector('.surface'), 6000)
  assert.equal(plain.dataset.url, 'http://127.0.0.1:4100/?token=abc')
  dispose2()
})

await it('runtime page: versions, DSH folder, no install box (installs happen in the workbench), plugin list with uninstall; old hosts are told chats are not connected', async () => {
  const { reg, calls } = setup({ routes: {
    '/status': status({ runtime: { installed: true, installedVersions: ['0.2.2-rc.3'], previous: null }, fusion: { ...status().fusion, resident: false } }),
    '/plugins': { plugins: [{ name: 'dsh-genui', version: '0.3.3', enabled: true }] }, '/logs': { lines: ['a'], sidecar: ['dsh web: http://127.0.0.1:1/?token=<redacted>'] },
    'POST /plugins/remove': { status: 'removed', name: 'dsh-genui' } } })
  const el = document.createElement('div')
  const dispose = reg.settings.manage.mount(el)
  await until(() => el.textContent.includes('dsh-genui'))
  assert.match(el.textContent, /\/home\/u\/\.dsh/)
  assert.match(el.textContent, /这个插件版本验过 0\.2\.2-rc\.3/)
  assert.match(el.textContent, /还不能让 DSH 的对话连这个常驻的 DSH/)
  assert.equal(el.querySelector('input'), null)
  const back = [...el.querySelectorAll('button')].find(b => b.textContent === '先退回上一版 DSH')
  assert.equal(back.disabled, true)
  ;[...el.querySelectorAll('button')].find(b => b.textContent === '卸载').click()
  await until(() => calls.some(c => c.path === '/plugins/remove' && c.body?.name === 'dsh-genui'))
  dispose()
})

await it('English UI: workbench card and harness labels switch with the host language', async () => {
  const { reg } = setup({ locale: 'en', routes: { '/status': status({ runtime: { installed: false }, sidecar: { state: 'stopped' } }), '/plugins': { plugins: [] } } })
  const el = document.createElement('div')
  const dispose = reg.views.workbench.mount(el)
  await until(() => el.textContent.includes('Download and start'))
  assert.ok(!/[㐀-鿿]/.test(el.textContent.replace(/<[^>]+>/g, '')))
  const rows = await reg.harness.rows({ agentSlug: 'a' })
  assert.equal(rows[0].text.en, 'Not downloaded yet')
  dispose()
})

console.log(`check-renderer: ${n} passed`)
