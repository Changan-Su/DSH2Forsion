/**
 * DSH2Forsion 真桌面验收：真 Electron × 托管模式真引擎（tangu-agent standalone）× 从磁盘装的整包 plugin/。
 * 走用户第一次用的那条路：Ribbon 出现 DSH → 打开看到下载说明 → 点「下载并启动」真下载运行时 →
 * DSH 自己的界面嵌进 Space → 设置里的管理页装一个插件 → 工具出现在列表里 → 切英文、切深色跟着变。
 * 截图写进 DSH2FORSION_SHOTS（缺省 tests/gui/shots/），交付前人看。
 *
 *   FORSION_DESKTOP=<Forsion 检出>/desktop node tests/gui/dsh2forsion.e2e.cjs
 *   （desktop 先 npm run build；Linux 无显示时套 xvfb-run -a）
 *   DSH2FORSION_ROOT=<已装好运行时的根目录>：软链进插件数据目录，跳过下载（只验界面时省 1.5 分钟）
 */
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const assert = require('node:assert/strict')

const REPO = path.join(__dirname, '..', '..')
const DESKTOP = process.env.FORSION_DESKTOP
assert(DESKTOP && fs.existsSync(path.join(DESKTOP, 'out/main')), 'FORSION_DESKTOP 要指向已 npm run build 的 Forsion desktop 目录')
const electron = require(path.join(DESKTOP, 'scripts/lib/launch-electron.cjs'))
const SHOTS = process.env.DSH2FORSION_SHOTS || path.join(__dirname, 'shots')
const FIXTURE = path.join(REPO, 'tests/fixtures/fixture-tool')

const results = []
function check(name, ok, detail) {
  results.push({ name, ok: !!ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  | ' + detail : ''}`)
}
async function until(fn, label, ms = 60_000) {
  const end = Date.now() + ms
  for (;;) {
    const v = await Promise.resolve().then(fn).catch(() => null)
    if (v) return v
    if (Date.now() > end) throw new Error(`Timed out: ${label}`)
    await new Promise(r => setTimeout(r, 250))
  }
}

async function closeApp(app) {
  const proc = app.process()
  await Promise.race([app.close().catch(() => {}), new Promise(r => setTimeout(r, 8000))])
  if (proc.exitCode === null && proc.signalCode === null) proc.kill('SIGKILL')
  await until(async () => proc.exitCode !== null || proc.signalCode !== null, 'test Electron exits', 10_000)
}

async function main() {
  fs.mkdirSync(SHOTS, { recursive: true })
  const seed = process.env.DSH2FORSION_GUI_SEED ? JSON.parse(fs.readFileSync(process.env.DSH2FORSION_GUI_SEED, 'utf8')) : null
  const home = seed?.shared || process.env.DSH2FORSION_GUI_HOME || fs.mkdtempSync(path.join(os.tmpdir(), 'forsion-dsh2forsion-'))
  console.log(`GUI test home: ${home}`)
  fs.writeFileSync(path.join(SHOTS, 'test-home.txt'), home)
  // Retry with fresh shell preferences; the DSH data stays in the seeded home.
  // The in-test restart deliberately reuses this same userData directory.
  const userData = path.join(home, `userdata-${Date.now()}`)
  const authLink = path.join(home, 'provider-auth.json')
  const liveAuth = process.env.DSH2FORSION_GUI_LIVE === '1'
  let createdAuthLink = false
  fs.cpSync(path.join(REPO, 'plugin'), path.join(home, 'plugins', 'dsh2forsion'), { recursive: true })
  const prelinked = Boolean(process.env.DSH2FORSION_ROOT) || fs.existsSync(path.join(home, 'tangu/plugin-data/dsh2forsion/runtime/0.2.1-rc.2/.dsh2forsion-ready'))
  if (process.env.DSH2FORSION_ROOT) {
    const data = path.join(home, 'tangu', 'plugin-data', 'dsh2forsion')
    fs.mkdirSync(data, { recursive: true })
    for (const sub of ['node', 'runtime']) if (!fs.existsSync(path.join(data, sub))) fs.symlinkSync(path.join(process.env.DSH2FORSION_ROOT, sub), path.join(data, sub), process.platform === 'win32' ? 'junction' : 'dir')
  }
  for (const ud of [userData, `${userData}-dev`]) {
    fs.mkdirSync(ud, { recursive: true })
    fs.writeFileSync(path.join(ud, 'tangu-desktop-config.json'), JSON.stringify({ mode: 'managed', cloudUrl: 'http://127.0.0.1:9', unitHostEnabled: false }))
  }
  const env = { ...process.env, TANGU_HOME: home, TANGU_CLOUD_URL: 'http://127.0.0.1:9' }
  delete env.TANGU_BACKEND_URL
  delete env.TANGU_PLUGINS_DIR
  delete env.TANGU_BUNDLE_DIRS
  env.TANGU_PLUGINS = 'on'
  const shot = async (page, name) => {
    await page.bringToFront()
    await page.waitForTimeout(400)
    const geometry = await page.evaluate(async () => {
      const wv = document.querySelector('.d2f-space webview')
      const rect = wv?.getBoundingClientRect()
      return { host: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio }, webview: rect && { width: rect.width, height: rect.height }, guest: wv && await wv.executeJavaScript('({width:innerWidth,height:innerHeight,dpr:devicePixelRatio})').catch(() => null) }
    })
    fs.writeFileSync(path.join(SHOTS, `${name}-geometry.json`), JSON.stringify(geometry))
    if (geometry.webview?.width > 0 && geometry.guest?.width > 0) {
      assert.ok(Math.abs(geometry.webview.width - geometry.guest.width) <= 2 && Math.abs(geometry.webview.height - geometry.guest.height) <= 2, 'DSH guest fills its host at native Windows DPI')
    }
    await page.screenshot({ path: path.join(SHOTS, `${name}.png`) })
    console.log(`      shot ${name}.png`)
  }

  let app
  try {
    if (liveAuth && !fs.existsSync(authLink)) {
      fs.symlinkSync(process.env.DSH2FORSION_AUTH || path.join(os.homedir(), '.forsion-dev/provider-auth.json'), authLink)
      createdAuthLink = true
    }
    app = await electron.launch({ args: [`--user-data-dir=${userData}`, '--lang=zh-CN', DESKTOP], cwd: DESKTOP, env, timeout: 90_000 })
    const win = await app.firstWindow()
    win.on('pageerror', error => fs.appendFileSync(path.join(SHOTS, 'page-errors.log'), `${error.stack || error}\n`))
    win.setDefaultTimeout(30_000)
    // 界面半身发给引擎的请求（作用域路由）：外观同步那一环断在哪，靠它分清是没发、发错还是 DSH 没跟
    const engineCalls = []
    win.on('request', r => { if (r.url().includes('/extensions/')) engineCalls.push({ at: Date.now(), method: r.method(), path: new URL(r.url()).pathname, body: r.postData() }) })
    win.on('requestfinished', async r => { if (r.url().includes('/appearance')) { const res = await r.response(); console.log(`      appearance → ${res?.status()} ${(await res?.text().catch(() => ''))?.slice(0, 160)}`) } })
    // Resize the native window. Chromium viewport emulation does not resize
    // Electron's embedded guest consistently on Windows at 125% DPI.
    const nativeWindow = await app.browserWindow(win)
    await nativeWindow.evaluate(window => window.setContentSize(1360, 860))
    await win.waitForSelector('#root')
    await win.waitForTimeout(1000)
    for (const label of ['跳过引导', 'Skip onboarding', 'Skip']) {
      const b = win.getByRole('button', { name: label, exact: true })
      if (await b.count()) { await b.click(); break }
    }
    await win.waitForSelector('.rb')
    await until(async () => (await win.evaluate(() => window.tangu.backendStatus())).state === 'ready', 'managed engine', 120_000)

    // ① Ribbon 上有 DSH（Space 多了宿主会收进「更多」），点开是下载说明（或已链好运行时时直接起）
    const visible = '.rb [data-space-id="dsh2forsion-dsh"]:visible'
    const dsh = await until(async () => {
      if (!(await win.locator(visible).count())) {
        await win.locator('.rb-more[data-rb-more="top"]:visible').first().click().catch(() => {})
        await win.waitForTimeout(600)
      }
      const b = win.locator('[data-space-id="dsh2forsion-dsh"]:visible').first()
      return (await b.count()) ? b : null
    }, 'DSH Space in the Ribbon', 60_000)
    check('Ribbon 出现 DSH Space', (await dsh.getAttribute('aria-label')) === 'DSH')
    await shot(win, '00-ribbon')
    await dsh.click()
    const view = win.locator('.d2f-space').first()
    await view.waitFor({ timeout: 30_000 })
    if (!prelinked) {
      const start = view.getByRole('button', { name: '下载并启动', exact: true })
      await start.waitFor({ timeout: 30_000 })
      const text = await view.innerText()
      check('首次打开先说明下载什么、从哪下、要多大、不是沙箱', /v24\.22\.0/.test(text) && /0\.2\.1-rc\.2/.test(text) && /1\.1 GB/.test(text) && /npmmirror/.test(text) && /不是沙箱/.test(text), text.replace(/\s+/g, ' ').slice(0, 160))
      await shot(win, '01-onboarding-zh')
      await start.click()
      await view.locator('.d2f-log').waitFor({ timeout: 30_000 })
      await win.waitForTimeout(3000)
      await shot(win, '02-downloading')
    }

    // ② 运行时就绪后 DSH 自己的界面嵌进来
    const webview = win.locator('.d2f-space webview')
    await webview.waitFor({ timeout: 600_000 })
    const src = await webview.getAttribute('src')
    // 打开的是带一次性 token 的登录地址，DSH 换完 cookie 会跳到 /，src 跟着变：只认本机地址
    check('DSH 界面以 webview 嵌入，只连本机', /^http:\/\/127\.0\.0\.1:\d+\//.test(src || ''), src?.split('?')[0])
    const title = await until(() => win.evaluate(() => new Promise(resolve => {
      const wv = document.querySelector('.d2f-space webview')
      wv.executeJavaScript('document.readyState === "complete" && document.body.innerText.length > 20 ? document.body.innerText.slice(0, 400) : ""').then(resolve, () => resolve(''))
    })), 'DSH web client rendered', 90_000)
    check('DSH 网页在 webview 里真的渲染出来了', title.length > 20, title.replace(/\s+/g, ' ').slice(0, 120))
    check('DSH 网页跟随 Forsion 用中文', /[一-鿿]/.test(title))
    await win.waitForTimeout(2500)
    await shot(win, '03-dsh-space-zh')

    const originBefore = new URL(src).origin
    // ③ 管理页：装一个插件，工具出现在列表里
    await win.evaluate(() => window.dispatchEvent(new CustomEvent('forsion:open-settings', { detail: 'fplugin:dsh2forsion' })))
    const settings = await until(async () => {
      for (const p of app.windows()) {
        if (p.isClosed()) continue
        if (await p.locator('.d2f-manage').count().catch(() => 0)) return p
      }
      return null
    }, 'DSH2Forsion settings page', 30_000)
    const manage = settings.locator('.d2f-manage')
    await manage.getByText('运行中', { exact: false }).first().waitFor({ timeout: 60_000 })
    check('管理页显示运行状态', /运行中/.test(await manage.innerText()))
    await shot(settings, '04-manage-empty')
    await manage.locator('input').fill(`file:${FIXTURE}`)
    await manage.getByRole('button', { name: '安装', exact: true }).click()
    await manage.getByText('已安装 dsh2forsion-fixture-tool', { exact: false }).waitFor({ timeout: 180_000 })
    await until(async () => /fixture_echo/.test(await manage.innerText()), 'tool listed', 30_000)
    const after = await manage.innerText()
    check('装好的插件出现在列表里，工具交给 Tangu', /dsh2forsion-fixture-tool/.test(after) && /fixture_echo/.test(after))
    await shot(settings, '05-manage-installed')

    // 装完插件 DSH 会换端口重启：Space 要跟到新地址，而不是留着一张死页面
    const originAfter = await until(async () => {
      const s2 = await win.locator('.d2f-space webview').getAttribute('src').catch(() => null)
      return s2 && new URL(s2).origin !== originBefore && new URL(s2).origin
    }, 'Space re-embeds the restarted DSH', 60_000).catch(() => null)
    const alive = originAfter && await until(() => win.evaluate(() => new Promise(resolve => {
      document.querySelector('.d2f-space webview').executeJavaScript('document.readyState === "complete" && document.body.innerText.length > 20').then(resolve, () => resolve(false))
    })), 'restarted DSH page rendered', 60_000).catch(() => false)
    check('装完插件 DSH 重启后，Space 跟到新地址并重新渲染', alive, `${originBefore} → ${originAfter}`)

    // ④ 用 Ribbon 上真的明暗按钮切深色：DSH 网页跟着变（DSH 把配色写在根元素的 color-scheme 上）
    const dshScheme = () => win.evaluate(() => new Promise(resolve => {
      document.querySelector('.d2f-space webview').executeJavaScript('document.documentElement.style.colorScheme || getComputedStyle(document.documentElement).colorScheme').then(resolve, e => resolve(String(e)))
    }))
    const before = await dshScheme()
    // 前面为找 DSH 展开过顶部的「更多」，展开着会把底部按钮挤出窗口：先收起
    const collapse = win.locator('.rb [aria-label="收起"]:visible').first()
    if (await collapse.count()) { await collapse.click(); await win.waitForTimeout(600) }
    // 窗口矮、Space 多时它会被收进 Ribbon 底部的「更多」
    const toggle = await until(async () => {
      const b = win.locator('[aria-label="切换明暗模式"]:visible').first()
      if (await b.count()) return b
      await win.locator('.rb-more[data-rb-more="bottom"]:visible').first().click().catch(() => {})
      await win.waitForTimeout(600)
      return null
    }, 'dark mode toggle', 20_000)
    if (await win.evaluate(() => document.documentElement.getAttribute('data-mode') === 'dark')) {
      await toggle.click()
      await until(() => win.evaluate(() => document.documentElement.getAttribute('data-mode') === 'light'), 'reset theme before dark toggle')
    }
    const sentBefore = engineCalls.length
    await toggle.click()
    const mode = await until(async () => { const m = await win.evaluate(() => document.documentElement.getAttribute('data-mode')); return m === 'dark' && m }, 'Forsion dark mode', 10_000)
    const darkScheme = await until(async () => { const v = await dshScheme(); return /dark/.test(v) && v }, 'DSH dark color-scheme', 20_000).catch(async () => dshScheme())
    if (!/dark/.test(darkScheme)) {
      // 诊断：webview 是不是在后台（被设置窗挡住），前台化以后跟不跟；重载以后跟不跟
      const wvState = () => win.evaluate(() => new Promise(resolve => {
        document.querySelector('.d2f-space webview').executeJavaScript('JSON.stringify({ vis: document.visibilityState, focus: document.hasFocus(), scheme: document.documentElement.style.colorScheme, src: document.documentElement.dataset.dsThemeSource })').then(resolve, e => resolve(String(e)))
      }))
      console.log(`      diag before front: ${await wvState()}`)
      await win.bringToFront()
      await win.waitForTimeout(3000)
      console.log(`      diag after front: ${await wvState()}`)
      await win.evaluate(() => document.querySelector('.d2f-space webview').reload())
      await win.waitForTimeout(6000)
      console.log(`      diag after reload: ${await wvState()}`)
    }
    const sent = engineCalls.slice(sentBefore).filter(c => c.path.endsWith('/appearance'))
    console.log(`      appearance calls after toggle: ${JSON.stringify(sent.map(c => c.body))}`)
    check('切深色后界面半身把深色发给了引擎', sent.some(c => /"theme":"dark"/.test(c.body || '')), JSON.stringify(sent.map(c => c.body)))
    check("Forsion 切深色后 DSH 网页也是深色", /dark/.test(darkScheme), `forsion=${mode} dsh ${before} → ${darkScheme}`)
    await win.waitForTimeout(1500)
    await shot(win, '06-dsh-space-dark')
    if (process.env.DSH2FORSION_FULL === '1' || process.env.DSH2FORSION_POPULAR === '1') {
      await require(process.env.DSH2FORSION_POPULAR === '1' ? './popular-loop.cjs' : './full-loop.cjs')({ app, win, settings, home, seed, check, until, shot, shots: SHOTS,
        restart: async () => {
          await closeApp(app)
          app = await electron.launch({ args: [`--user-data-dir=${userData}`, '--lang=zh-CN', DESKTOP], cwd: DESKTOP, env, timeout: 90_000 })
          const page = await app.firstWindow()
          await page.waitForSelector('.rb', { timeout: 60_000 })
          await until(async () => (await page.evaluate(() => window.tangu.backendStatus())).state === 'ready', 'restarted managed engine', 120_000)
          return { app, page }
        },
      })
    }
  } catch (error) {
    check('GUI acceptance completes', false, error.message)
    // 失败现场：每个窗口一张截图 + Ribbon 与插件清单，先看现场再猜原因
    for (const [i, page] of (app?.windows() ?? []).entries()) {
      await page.screenshot({ path: path.join(SHOTS, `failure-${i}.png`) }).catch(() => {})
      const dump = await page.evaluate(() => ({
        ribbon: [...document.querySelectorAll('.rb button')].map(b => b.getAttribute('aria-label') || b.textContent.trim()).filter(Boolean),
        body: document.body.innerText.slice(0, 1500),
      })).catch(e => String(e))
      fs.writeFileSync(path.join(SHOTS, `failure-${i}.json`), JSON.stringify(dump, null, 1))
      const guest = await page.evaluate(async () => {
        const view = document.querySelector('.d2f-space webview')
        return view && await view.executeJavaScript('document.body.innerText')
      }).catch(() => null)
      if (guest) fs.writeFileSync(path.join(SHOTS, `failure-${i}-guest.txt`), guest)
    }
    fs.writeFileSync(path.join(SHOTS, 'failure-home.txt'), `${home}\n`)
    throw error
  } finally {
    fs.writeFileSync(path.join(SHOTS, 'results.json'), JSON.stringify(results, null, 2))
    // app.close() 在这台无显示的机器上会挂住：限时关，到点强杀（sidecar 有父进程看门狗，不会留孤儿）
    try { if (app) await closeApp(app) }
    finally { if (createdAuthLink && fs.lstatSync(authLink, { throwIfNoEntry: false })) fs.unlinkSync(authLink) }
  }
  const failed = results.filter(r => !r.ok)
  fs.writeFileSync(path.join(SHOTS, 'results.json'), JSON.stringify(results, null, 2))
  console.log(`\n${results.length - failed.length} passed / ${failed.length} failed`)
  process.exitCode = failed.length ? 1 : 0
}

// Playwright's transport can retain handles after a forced Electron shutdown.
// main's finally has already closed the app and removed our authentication link.
main().then(() => process.exit(process.exitCode || 0), error => { console.error(error); process.exit(1) })
