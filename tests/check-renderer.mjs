// 渲染半身检查：照宿主的方式（new Function('ctx', source)）在 happy-dom 里加载 plugin/main.js，
// 用假 ctx 驱动 DSH Space 视图与管理面板的各条路径。
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Window } from 'happy-dom'

const repo = join(dirname(fileURLToPath(import.meta.url)), '..')
const source = await readFile(join(repo, 'plugin/main.js'), 'utf8')
const manifest = JSON.parse(await readFile(join(repo, 'plugin/manifest.json'), 'utf8'))
const space = JSON.parse(await readFile(join(repo, 'plugin/spaces/dsh/space.json'), 'utf8'))

let n = 0
const it = async (name, fn) => { await fn(); n++; console.log(`ok ${n} ${name}`) }
const tick = (ms = 0) => new Promise(r => setTimeout(r, ms))
const until = async (fn, ms = 3000) => {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await tick(10) }
  throw new Error('timed out waiting')
}

function setup({ locale = 'zh', routes = {}, withSurface = false } = {}) {
  const window = new Window({ url: 'http://localhost/' })
  globalThis.window = window
  globalThis.document = window.document
  globalThis.Node = window.Node
  globalThis.MutationObserver = window.MutationObserver
  document.documentElement.setAttribute('data-mode', 'dark')
  const calls = []
  const reg = { views: {}, settings: {}, commands: {} }
  let loc = locale
  const localeSubs = new Set()
  const ctx = {
    getLocale: () => loc,
    subscribeLocale: cb => { localeSubs.add(cb); return () => localeSubs.delete(cb) },
    registerView: v => { reg.views[v.id] = v },
    registerSettingsView: v => { reg.settings[v.id] = v },
    registerCommand: c => { reg.commands[c.id] = c },
    openView: id => calls.push({ openView: id }),
    app: { openSettings: target => calls.push({ openSettings: target }) },
    tangu: {
      request: async (engine, path, opts = {}) => {
        assert.equal(engine, 'dsh2forsion')
        calls.push({ path, method: opts.method ?? 'GET', body: opts.body })
        const handler = routes[`${opts.method ?? 'GET'} ${path}`] ?? routes[path]
        if (!handler) throw new Error(`no route ${path}`)
        return typeof handler === 'function' ? handler(opts.body) : handler
      },
    },
  }
  if (withSurface) ctx.ui = { mountWebSurface: (el, o) => { const d = document.createElement('div'); d.className = 'surface'; d.dataset.url = o.url; d.dataset.partition = o.partition; el.append(d); return () => d.remove() } }
  new Function('ctx', source)(ctx)
  const setLocale = l => { loc = l; for (const cb of localeSubs) cb(l) }
  return { window, ctx, reg, calls, setLocale }
}

const status = (over = {}) => ({
  dshVersion: '0.2.1-rc.2', nodeVersion: 'v24.22.0',
  runtime: { installed: true }, job: { running: false, lines: [] },
  sidecar: { state: 'running' }, tools: [], promptSections: [], pluginJob: null, settings: {}, ...over,
})

await it('registers the space view, the settings page and two commands; the Space only needs the registered view', () => {
  const { reg } = setup()
  assert.deepEqual(Object.keys(reg.views), ['space'])
  assert.deepEqual(Object.keys(reg.settings), ['manage'])
  assert.deepEqual(Object.keys(reg.commands).sort(), ['dsh2forsion-manage', 'dsh2forsion-open-space'])
  for (const v of space.requires.views) assert.ok(v.startsWith(`plugin:${manifest.id}:`) && reg.views[v.split(':')[2]], v)
  assert.equal(typeof reg.commands['dsh2forsion-open-space'].title, 'function')
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

await it('first open: onboarding explains download size, source and trust; install polls until running, then embeds a webview', async () => {
  let polls = 0
  const { reg, calls } = setup({
    routes: {
      '/status': () => {
        if (!calls.some(c => c.path === '/runtime/install')) return status({ runtime: { installed: false }, sidecar: { state: 'stopped' } })
        polls++
        return polls < 2 ? status({ runtime: { installed: false }, job: { running: true, lines: ['download node'] }, sidecar: { state: 'stopped' } }) : status()
      },
      'POST /runtime/install': { started: true },
      'POST /space': { url: 'http://127.0.0.1:4100/?token=abc' },
      'POST /appearance': { ok: true },
    },
  })
  const el = document.createElement('div')
  document.body.append(el)
  const dispose = reg.views.space.mount(el)
  const button = await until(() => [...el.querySelectorAll('button')].find(b => b.textContent === '下载并启动'))
  const text = el.textContent
  assert.match(text, /v24\.22\.0/)
  assert.match(text, /0\.2\.1-rc\.2/)
  assert.match(text, /1\.1 GB/)
  assert.match(text, /不是沙箱/)
  button.click()
  const wv = await until(() => el.querySelector('webview'), 6000)
  assert.equal(wv.getAttribute('partition'), 'persist:dsh2forsion')
  assert.equal(wv.getAttribute('src'), 'http://127.0.0.1:4100/?token=abc')
  const appearance = await until(() => calls.find(c => c.path === '/appearance'))
  assert.deepEqual(appearance.body, { theme: 'dark', locale: 'zh' })
  dispose()
  assert.equal(el.children.length, 0)
})

await it('English onboarding and a host-provided web surface instead of a raw webview', async () => {
  const { reg } = setup({ locale: 'en', withSurface: true, routes: { '/status': status(), 'POST /space': { url: 'http://127.0.0.1:1/?token=t' }, 'POST /appearance': { ok: true } } })
  const el = document.createElement('div')
  document.body.append(el)
  reg.views.space.mount(el)
  const s = await until(() => el.querySelector('.surface'))
  assert.equal(s.dataset.partition, 'persist:dsh2forsion')
  assert.equal(el.querySelector('webview'), null)
})

await it('after DSH restarts on a new port the Space re-embeds the new address; a stop shows a start button', async () => {
  let sidecar = { state: 'running', base: 'http://127.0.0.1:4100' }
  let n = 0
  const { reg } = setup({
    routes: {
      '/status': () => status({ sidecar }),
      'POST /space': () => ({ url: `${sidecar.base}/?token=t${++n}` }),
      'POST /appearance': { ok: true },
    },
  })
  const el = document.createElement('div')
  document.body.append(el)
  reg.views.space.mount(el)
  await until(() => el.querySelector('webview')?.getAttribute('src') === 'http://127.0.0.1:4100/?token=t1')
  sidecar = { state: 'starting', base: null }
  await until(() => el.textContent.includes('DSH 正在重启'), 5000)
  assert.equal(el.querySelector('webview'), null)
  sidecar = { state: 'running', base: 'http://127.0.0.1:4200' }
  await until(() => el.querySelector('webview')?.getAttribute('src') === 'http://127.0.0.1:4200/?token=t2', 5000)
  sidecar = { state: 'stopped', base: null }
  const start = await until(() => [...el.querySelectorAll('button')].find(b => b.textContent === '启动'), 5000)
  sidecar = { state: 'running', base: 'http://127.0.0.1:4300' }
  start.click()
  await until(() => el.querySelector('webview')?.getAttribute('src') === 'http://127.0.0.1:4300/?token=t3', 5000)
})

await it('start failure shows the error with retry, restore-last-good and logs', async () => {
  const { reg, calls } = setup({
    routes: {
      '/status': () => status({ sidecar: { state: 'failed', error: 'dsh: startup failed: 1 required plugin did not activate' } }),
      'POST /space': () => { throw new Error('DSH did not start') },
      'POST /plugins/restore-last-good': { status: 'restored' },
    },
  })
  const el = document.createElement('div')
  document.body.append(el)
  reg.views.space.mount(el)
  await until(() => el.textContent.includes('startup failed'))
  const labels = [...el.querySelectorAll('button')].map(b => b.textContent)
  assert.deepEqual(labels, ['重试', '恢复到上次能启动的状态', '查看日志与管理'])
  ;[...el.querySelectorAll('button')][2].click()
  assert.ok(calls.some(c => c.openSettings === 'fplugin:dsh2forsion'))
  ;[...el.querySelectorAll('button')][1].click()
  await until(() => calls.some(c => c.path === '/plugins/restore-last-good'))
})

await it('manage panel: lists tools and plugins; a partial trial asks before installing', async () => {
  const installs = []
  const { reg } = setup({
    routes: {
      '/status': status({ tools: ['fixture_echo'], promptSections: ['dsh2forsion-fixture'] }),
      '/plugins': { plugins: [{ name: 'dsh-x', version: '1.0.0', title: { en: 'X', zh: '叉' }, enabled: true, known: { grade: 'load-ok' } }], known: {} },
      '/logs': { lines: ['hello'], sidecar: ['dsh web: …'] },
      'POST /plugins/install': body => {
        installs.push(body)
        return body.confirm ? { status: 'installed', name: 'dsh-y', verdict: 'partial', reasons: ['dsh-y (dsh-y): TypeError'] } : { status: 'needs-confirm', name: 'dsh-y', reasons: ['dsh-y (dsh-y): TypeError'] }
      },
    },
  })
  const el = document.createElement('div')
  document.body.append(el)
  reg.settings.manage.mount(el)
  await until(() => el.textContent.includes('叉 1.0.0'))
  assert.match(el.textContent, /fixture_echo/)
  assert.match(el.textContent, /兼容矩阵：装载通过/)
  const input = el.querySelector('input')
  input.value = 'dsh-y@1.0.0'
  ;[...el.querySelectorAll('button')].find(b => b.textContent === '安装').click()
  const confirm = await until(() => [...el.querySelectorAll('button')].find(b => b.textContent === '仍然安装'))
  assert.match(el.textContent, /TypeError/)
  confirm.click()
  await until(() => el.textContent.includes('已安装 dsh-y，但有部分没激活'))
  assert.deepEqual(installs, [{ spec: 'dsh-y@1.0.0' }, { spec: 'dsh-y@1.0.0', confirm: true }])
})

console.log(`check-renderer: ${n} passed`)
process.exit(0)
