/**
 * Original Task Board in real Forsion Electron, using its real managed engine.
 * Requires built FORSION_DESKTOP and FORSION_AGENT. Optional existing isolated
 * DSH2FORSION_GUI_HOME avoids reinstalling the runtime and third-party packages.
 * Otherwise DSH2FORSION_ROOT supplies a preinstalled node/runtime tree. The
 * Skills Manager read scenario requires an existing skill in the isolated
 * DSH home (the popular live GUI seed already contains one); this is checked
 * before any model task is scheduled.
 * The existing desktop build is staged in the isolated home; its sibling engine
 * junction selects FORSION_AGENT without modifying either source checkout.
 * Run under the repository's devlock.cjs run --vehicle=e2e wrapper. Explicit
 * DSH2FORSION_ENGINE_MODE=external is a negative test of the local capability gate.
 * Three GPT 6 Luna tasks maximum: approve, reject, cancel during a slow tool.
 * Product writes go through original UI/public APIs; ledgers are read-only.
 */
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const assert = require('node:assert/strict')
const { spawn, execFileSync } = require('node:child_process')
const { createServer } = require('node:net')
const { randomUUID } = require('node:crypto')

const REPO = path.resolve(__dirname, '../..')
const DESKTOP = process.env.FORSION_DESKTOP
const AGENT = process.env.FORSION_AGENT
assert(DESKTOP && fs.existsSync(path.join(DESKTOP, 'out/main')), 'FORSION_DESKTOP must contain built out/main')
assert(AGENT && fs.existsSync(path.join(AGENT, 'dist/standalone/main.js')), 'FORSION_AGENT must contain built standalone engine')
const electron = require(path.join(DESKTOP, 'scripts/lib/launch-electron.cjs'))
const managed = process.env.DSH2FORSION_ENGINE_MODE !== 'external'
let launchDesktop = DESKTOP
const MODEL = 'codex/gpt-6-luna'
const TOOL = 'dsh__acceptance_probe'
const panelsOnly = process.env.DSH2FORSION_NATIVE_PANELS_ONLY === '1'
const cases = panelsOnly ? [] : (process.env.DSH2FORSION_NATIVE_CASES || 'approve,reject,cancel').split(',')
const reuseApprove = process.env.DSH2FORSION_NATIVE_REUSE_APPROVE
assert.ok(!reuseApprove || (!cases.includes('approve') && /^[\w-]+$/.test(reuseApprove)), 'reuse an approved execution without invoking the approve model again')
const reuseResult = process.env.DSH2FORSION_NATIVE_REUSE_RESULT
const reusedCases = reuseResult ? JSON.parse(fs.readFileSync(reuseResult, 'utf8')).executions : reuseApprove ? [{ executionId: reuseApprove, kind: 'approve' }] : []
assert.ok(reusedCases.length <= 3 && reusedCases.every(item => /^[\w-]+$/.test(item.executionId) && ['approve', 'reject', 'cancel'].includes(item.kind) && !cases.includes(item.kind)), 'reuse terminal cases without scheduling the same model case again')
assert.ok((panelsOnly || cases.length > 0) && cases.length <= 3 && new Set(cases).size === cases.length && cases.every(name => ['approve', 'reject', 'cancel'].includes(name)), 'select one to three distinct native acceptance cases')
const PREFIX = '/extensions/dsh2forsion/dsh2forsion'
const stamp = new Date().toISOString().replaceAll(':', '-')
const OUT = path.resolve(process.env.DSH2FORSION_SHOTS || path.join(REPO, '.tmp/native-electron', stamp))
const home = path.resolve(process.env.DSH2FORSION_GUI_HOME || fs.mkdtempSync(path.join(os.tmpdir(), 'd2f-native-')))
const workspace = path.resolve(process.env.DSH2FORSION_WORKSPACE || `${home}-native-workspace`)
const data = path.join(home, 'tangu/plugin-data/dsh2forsion')
const userData = path.join(home, `native-electron-${stamp}`)
const authLink = path.join(home, 'provider-auth.json')
let token = randomUUID()
const checks = [], executions = [], approvalRequests = []
const viewRequests = []
let app, page, engine, base, linkedAuth = false, contextSession, runFailure
fs.mkdirSync(OUT, { recursive: true })
fs.mkdirSync(workspace, { recursive: true })
fs.mkdirSync(data, { recursive: true })
const safe = value => String(value).replaceAll(token, '[local-auth]')
  .replace(/([?&](?:token|ticket)=)[^\s"'&]+/g, '$1[redacted]')
  .replace(/(\/forsion-native\/view\/)[a-f0-9]{48}/g, '$1[redacted]')
const save = (name, value) => fs.writeFileSync(path.join(OUT, name), safe(JSON.stringify(value, null, 2)))
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until(fn, label, ms = 60000) {
  const end = Date.now() + ms
  let last
  do {
    try { const value = await fn(); if (value) return value } catch (error) { last = error }
    await pause(250)
  } while (Date.now() < end)
  throw new Error(`Timed out: ${label}${last ? ` (${last.message})` : ''}`)
}
function check(name, value, evidence) {
  checks.push({ name, ok: !!value, ...(evidence === undefined ? {} : { evidence }) })
  console.log(`${value ? 'PASS' : 'FAIL'} ${name}`)
  assert.ok(value, name)
}
async function api(route, body, method = body === undefined ? 'GET' : 'POST') {
  const response = await fetch(base + route, {
    method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(180000),
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`${method} ${route}: ${response.status} ${text.slice(0, 800)}`)
  return text ? JSON.parse(text) : null
}
const ledger = () => JSON.parse(fs.readFileSync(path.join(data, 'native-executions.json'), 'utf8'))
const originalRecord = record => {
  const tasks = JSON.parse(fs.readFileSync(path.join(data, 'home/task-board/ledger-v2.json'), 'utf8')).tasks
  const task = tasks.find(task => task.id === record.taskId)
  return task && { taskId: task.id, title: task.title, status: task.status, execution: task.executions.find(item => item.id === record.executionId) }
}
const probe = marker => {
  const file = path.join(workspace, 'dsh-probe.jsonl')
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse).filter(row => row.marker === marker) : []
}
const run = async record => (await api(`/agent/runs?session_id=${record.sessionId}`)).runs.find(item => item.id === record.runId)
const guest = (fn, arg) => page.evaluate(({ source, arg }) => {
  const view = document.querySelector('.d2f-space webview')
  if (!view) throw new Error('Native panel webview is not mounted')
  return view.executeJavaScript(`(${source})(${JSON.stringify(arg)})`)
}, { source: fn.toString(), arg })
const guestClick = labels => guest(labels => {
  const button = [...document.querySelectorAll('button')].find(el => labels.includes(el.textContent.trim()) && !el.disabled)
  if (!button) return false
  button.scrollIntoView({ block: 'center' }); button.click(); return true
}, labels)
const nativeAction = (action, fallback) => guest(({ action, fallback }) => {
  const button = document.querySelector(`[data-forsion-native-action="${action}"]`) || [...document.querySelectorAll('[data-forsion-native-execution] button')].find(button => button.textContent.trim() === fallback)
  if (!button || button.disabled) return false
  button.scrollIntoView({ block: 'center' }); button.click(); return true
}, { action, fallback })
const card = title => guest(title => {
  const el = [...document.querySelectorAll('article[data-dsh-part="card"]')].find(el => el.querySelector('[data-dsh-part="card-title"]')?.textContent.trim() === title)
  return el && { status: el.dataset.status, result: el.querySelector('[data-dsh-part="card-run"]')?.dataset.result, text: el.innerText }
}, title)
async function shot(name) {
  await page.bringToFront()
  await pause(350)
  const geometry = await page.evaluate(async () => {
    const view = document.querySelector('.d2f-space webview')
    const rect = view?.getBoundingClientRect()
    return { host: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio }, carrier: rect && { width: rect.width, height: rect.height }, guest: view && await view.executeJavaScript('({width:innerWidth,height:innerHeight,dpr:devicePixelRatio})').catch(() => null) }
  })
  save(`${name}-geometry.json`, geometry)
  await page.screenshot({ path: path.join(OUT, `${name}.png`) })
  console.log(`SHOT ${name}.png`)
}
async function stopEngine() {
  if (!engine) return
  await api(PREFIX + '/sidecar/stop', {}).catch(() => {})
  engine.kill('SIGTERM')
  await until(() => engine.exitCode !== null || engine.signalCode !== null, 'own engine exits', 8000).catch(() => engine.kill('SIGKILL'))
  engine = null
}
async function stopDesktop() {
  if (!app) return
  if (managed && page && !page.isClosed()) {
    const logs = await page.evaluate(() => window.tangu.backendLogs?.()).catch(() => null)
    if (logs) fs.appendFileSync(path.join(OUT, 'engine.log'), safe(Array.isArray(logs) ? logs.join('\n') : JSON.stringify(logs)) + '\n')
  }
  const process = app.process()
  await Promise.race([app.close().catch(() => {}), pause(8000)])
  if (process.exitCode === null && process.signalCode === null) process.kill('SIGKILL')
  app = null
}
async function startEngine() {
  if (managed) {
    await startDesktop()
    await until(async () => (await api(PREFIX + '/status')).sidecar.state === 'running', 'managed DSH sidecar', 120000)
    const catalog = await api('/agent/models')
    assert.ok((catalog.models || catalog).some(model => model.id === MODEL), 'designated live model available')
    return
  }
  console.log('STEP start external engine')
  const socket = createServer()
  await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve))
  const port = socket.address().port
  await new Promise(resolve => socket.close(resolve))
  base = `http://127.0.0.1:${port}`
  const env = { ...process.env, TANGU_HOME: path.join(home, 'tangu'), TANGU_DEFAULT_WORKSPACE: workspace,
    TANGU_PLUGINS: 'on', TANGU_BROWSER_CDP: 'off', TANGU_BROWSER_EXTENSION: '0' }
  for (const key of ['TANGU_BACKEND_URL', 'TANGU_PLUGINS_DIR', 'TANGU_BUNDLE_DIRS']) delete env[key]
  engine = spawn(process.execPath, [path.join(AGENT, 'dist/standalone/main.js'), '--host', '127.0.0.1', '--port', String(port),
    '--data-dir', path.join(home, 'tangu/state.db'), '--sandbox', 'off', '--cloud-url', 'http://127.0.0.1:9', '--token', token],
  { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  for (const stream of [engine.stdout, engine.stderr]) stream.on('data', value => fs.appendFileSync(path.join(OUT, 'engine.log'), safe(value)))
  await until(() => api('/health'), 'external engine health', 90000)
  const catalog = await api('/agent/models')
  assert.ok((catalog.models || catalog).some(model => model.id === MODEL), 'designated live model available')
  await until(async () => (await api(PREFIX + '/status')).sidecar.state === 'running', 'DSH sidecar', 120000)
  console.log('STEP external engine and sidecar ready')
}
async function startDesktop() {
  for (const dir of [userData, `${userData}-dev`]) {
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'tangu-desktop-config.json'), JSON.stringify(managed
      ? { mode: 'managed', cloudUrl: 'http://127.0.0.1:9', unitHostEnabled: false }
      : { mode: 'external', backendUrl: base, token, unitHostEnabled: false }))
  }
  const env = { ...process.env, TANGU_HOME: home, TANGU_BACKEND_URL: base, FORSION_WORKSPACE_DIR: workspace,
    TANGU_PLUGINS: 'on', TANGU_CLOUD_URL: 'http://127.0.0.1:9' }
  for (const key of ['TANGU_PLUGINS_DIR', 'TANGU_BUNDLE_DIRS']) delete env[key]
  if (managed) delete env.TANGU_BACKEND_URL
  app = await electron.launch({ args: [`--user-data-dir=${userData}`, '--lang=zh-CN', launchDesktop], cwd: launchDesktop, env, timeout: 90000 })
  page = await app.firstWindow()
  page.setDefaultTimeout(20000)
  page.on('pageerror', error => fs.appendFileSync(path.join(OUT, 'page-errors.log'), safe(error.stack) + '\n'))
  page.on('request', request => {
    if (/\/approvals\//.test(request.url()) && request.method() === 'POST') approvalRequests.push({ path: new URL(request.url()).pathname, body: request.postDataJSON() })
    if (request.url().endsWith('/native/view') && request.method() === 'POST') {
      const body = request.postDataJSON()
      viewRequests.push({ panelKey: body?.panelKey, sessionId: body?.sessionId ?? null })
      save('native-view-requests.json', viewRequests)
    }
  })
  await (await app.browserWindow(page)).evaluate(window => window.setContentSize(1360, 860))
  await until(async () => {
    for (const label of ['跳过引导', 'Skip onboarding', 'Skip']) {
      const button = page.getByRole('button', { name: label, exact: true })
      if (await button.isVisible()) await button.click()
    }
    return page.locator('.rb').isVisible()
  }, 'onboarding and ribbon')
  await until(async () => {
    for (const label of ['跳过引导', 'Skip onboarding', 'Skip']) {
      const button = page.getByRole('button', { name: label, exact: true })
      if (await button.isVisible()) { await button.click(); return false }
    }
    if (managed) {
      const status = await page.evaluate(() => window.tangu.backendStatus())
      if (status.state !== 'ready') return false
      const config = await page.evaluate(() => window.tangu.getConfig())
      base = config.backendUrl; token = config.token
      save('desktop-backend-status.json', { mode: 'managed', backendUrl: base, state: status.state })
      return config.mode === 'managed' && !!base && !!token
    }
    // backendStatus describes the managed child only; external mode correctly
    // leaves it stopped. Verify the renderer's actual configured connection.
    const status = await page.evaluate(async () => {
      const config = await window.tangu.getConfig()
      const response = await fetch(config.backendUrl + '/health', { headers: { authorization: `Bearer ${config.token}` } })
      return { mode: config.mode, backendUrl: config.backendUrl, health: response.status }
    })
    save('desktop-backend-status.json', status)
    return status.mode === 'external' && status.backendUrl === base && status.health === 200
  }, 'external backend ready')
  console.log(`STEP ${managed ? 'managed' : 'external'} Electron ready`)
}
async function openContext() {
  const loaded = page.waitForResponse(response => /\/agent\/sessions(?:\?|$)/.test(response.url()) && response.request().method() === 'GET', { timeout: 60000 })
  await page.reload()
  await loaded
  await page.waitForSelector('.rb')
  // A deep link opens a pinned leaf; it deliberately does not select the
  // global active session exposed by the public agentStatus SDK. Choose the
  // actual sidebar row, exactly as a user selects the native project context.
  await page.locator('[data-space-id="tangu"]:visible').first().click()
  if (!(await page.locator('.t2s-side:visible').count())) await page.keyboard.press(process.platform === 'darwin' ? 'Meta+/' : 'Control+/')
  const work = page.locator('.t2s-mode [data-mode="work"]:visible')
  if (await work.count()) await work.click()
  const row = await until(async () => {
    const row = page.locator(`.t2s-srow[data-sel-id="${contextSession.id}"]:visible`)
    if (await row.count()) return row
    await page.evaluate(() => {
      for (const button of document.querySelectorAll('.t2s-group-toggle')) {
        if (button.querySelector('.t2s-chev:not(.open)')) button.click()
      }
    })
    return null
  }, 'native project session in the original sidebar')
  await row.click()
  await page.locator(`.t2-chat-view[data-session-id="${contextSession.id}"]:visible`).waitFor()
  save('selected-native-session.json', { expected: contextSession.id, visible: await page.locator('.t2-chat-view:visible').getAttribute('data-session-id'), sidebarSelected: /\bactive\b/.test(await row.getAttribute('class') || '') })
  await shot('native-project-selected')
}
async function openBoard() {
  const button = await until(async () => {
    let target = page.locator('[data-space-id="dsh2forsion-dsh"]:visible').first()
    if (await target.count()) return target
    await page.locator('.rb-more[data-rb-more="top"]:visible').first().click().catch(() => {})
    return null
  }, 'native plugin Space')
  await button.click()
  const mounted = await until(async () => {
    const errors = page.locator('.d2f-space .d2f-error')
    const error = await errors.count() ? await errors.first().textContent() : null
    if (error?.trim()) return { error: error.trim() }
    return await guest(() => !!document.querySelector('main[data-forsion-native-panel="task-board"] [data-dsh-taskboard-view]')) && { ready: true }
  }, 'original native Task Board', 90000)
  assert.ok(mounted.ready, `native panel mounts: ${mounted.error || ''}`)
}
async function openTask(title) {
  await until(() => guest(title => {
    if ([...document.querySelectorAll('[role="dialog"]')].some(dialog => dialog.innerText.includes(title))) return true
    const el = [...document.querySelectorAll('article[data-dsh-part="card"]')].find(el => el.querySelector('[data-dsh-part="card-title"]')?.textContent.trim() === title)
    if (!el) return false
    el.querySelector('button[data-dsh-part="card-open"]').click(); return true
  }, title), `open task ${title}`)
  await until(() => guest(() => !!document.querySelector('[data-forsion-native-execution]')), 'native execution actions')
}
async function closeTask() {
  await guest(() => document.querySelector('[role="dialog"] button[aria-label="关闭"], [role="dialog"] button[aria-label="Close"]')?.click())
  await until(() => guest(() => !document.querySelector('[role="dialog"]')), 'task dialog closes')
}
async function createAndRun(kind, waitMs = 0) {
  assert.ok(executions.length < 3, 'live run budget: at most three tasks')
  await openBoard()
  const title = `D2F-native-${kind}-${stamp}`
  await until(() => guestClick(['新建任务', 'New Task']), 'original New Task button')
  await until(() => guest(() => !!document.querySelector('[role="dialog"] input[placeholder]')), 'new task form')
  const prompt = `Call ${TOOL} exactly once with marker "${title}" and waitMs ${waitMs}. Report its returned marker. Do not use any other tools, delegate, verify, or retry. If approval is rejected, stop without retrying.`
  await guest(({ title, prompt, model }) => {
    const dialog = document.querySelector('[role="dialog"]')
    const set = (el, value) => {
      if (!el) throw new Error('Original task form field missing')
      const prototype = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype
      Object.getOwnPropertyDescriptor(prototype, 'value').set.call(el, value)
      el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }))
    }
    set(dialog.querySelector('input[placeholder]'), title)
    const textareas = dialog.querySelectorAll('textarea')
    set(textareas[0], 'Native Tangu execution acceptance; temporary workspace only.')
    set(textareas[1], prompt)
    // Open the original execution/run sections, then choose its native model.
    for (const section of dialog.querySelectorAll('[data-dsh-part="form-section"]')) {
      if (!section.dataset.open) section.querySelector('button')?.click()
    }
  }, { title, prompt, model: MODEL })
  await until(() => guest(model => {
    const dialog = document.querySelector('[role="dialog"]')
    const select = [...dialog.querySelectorAll('select')].find(el => ['模型', 'Model'].includes(el.closest('label')?.querySelector('span')?.textContent.trim()) && [...el.options].some(option => option.value === model))
    if (!select) return false
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, model)
    select.dispatchEvent(new Event('change', { bubbles: true }))
    const skip = [...dialog.querySelectorAll('label')].find(el => /跳过本任务的验收|Skip acceptance for this task/.test(el.textContent))?.querySelector('input[type="checkbox"]')
    if (skip && !skip.checked) skip.click()
    return true
  }, MODEL), 'original model selector exposes Tangu GPT 6 Luna')
  await until(() => guestClick(['创建并执行', 'Create and run']), 'original Create and run')
  const record = await until(() => Object.values(ledger().executions).find(record => record.intent.title === title), 'native execution persisted', 60000)
  executions.push({ ...record, title, kind })
  check(`${kind}: original UI starts the designated native model`, record.intent.modelId === MODEL && path.resolve(record.intent.cwd) === workspace, { sessionId: record.sessionId, runId: record.runId, model: record.intent.modelId })
  await openTask(title)
  await until(() => nativeAction('open-session', 'Open in Tangu'), 'original panel opens native session')
  const approval = page.locator('.approval-card:not(.resolved)').filter({ hasText: TOOL }).last()
  await approval.waitFor({ timeout: 180000 })
  check(`${kind}: native approval visible before tool side effect`, probe(title).length === 0)
  await shot(`${kind}-native-approval`)
  return { ...record, title, kind, approval }
}
async function approve(record) {
  await record.approval.locator('.approval-actions button.primary').click()
  await until(() => approvalRequests.some(item => item.path.includes(record.runId) && item.body.action === 'approve'), 'native approval delivered')
}
async function settled(record, expected) {
  const value = await until(async () => { const value = await run(record); return ['done', 'error', 'aborted'].includes(value?.status) && value }, 'native terminal run', 180000)
  check(`${record.kind}: native run ${expected}`, value.status === expected, { status: value.status })
  const history = await api(`/agent/sessions/${record.sessionId}/messages?limit=100`)
  save(`${record.kind}-history.json`, history)
  await openBoard()
  // The task detail can remain mounted across Space switching.
  await closeTask()
  // Upstream's compact completed cards intentionally omit the card-run badge.
  // Check their real column state, correlated with the read-only original ledger.
  const actual = await until(async () => {
    const value = await card(record.title), original = originalRecord(record)
    return value && original?.execution?.result && value.status !== 'running' && value.status === original.status && { ...value, original }
  }, 'original panel reconciles terminal result', 90000)
  check(`${record.kind}: original panel reports real terminal result`, actual.original.execution.result === (expected === 'aborted' ? 'cancelled' : 'succeeded'), actual)
  await shot(`${record.kind}-panel-result`)
  const { approval: _approval, ...execution } = record
  save(`${record.kind}-evidence.json`, { execution, run: value, panel: actual, probe: probe(record.title) })
  return actual
}
async function captureNativeHistory(record) {
  await openTask(record.title)
  await until(() => nativeAction('open-session', 'Open in Tangu'), 'open successful native history')
  await page.locator(`.t2-chat-view[data-session-id="${record.sessionId}"]:visible`).waitFor()
  for (const group of await page.locator('.tool-group-head[aria-expanded="false"]').all()) await group.click()
  const toolRow = page.locator('.tool-row').filter({ hasText: TOOL }).first()
  if (await toolRow.count()) await toolRow.locator('.tool-row-head').click()
  await until(() => page.locator('.t2-chat-view:visible').innerText().then(text => text.includes(record.title) && /completed|成功|完成|true/.test(text)), 'native history and tool result visible')
  await shot(`${record.kind}-native-history`)
  await openBoard(); await closeTask()
}
async function inspectBoardScroll() {
  const geometry = await guest(() => {
    const button = [...document.querySelectorAll('button')].find(button => /^(新建任务|New Task)$/.test(button.textContent.trim()))
    const before = button?.getBoundingClientRect()
    const scrollers = [...document.querySelectorAll('*')].filter(el => el.scrollWidth > el.clientWidth + 2 && /auto|scroll/.test(getComputedStyle(el).overflowX))
    for (const el of scrollers) el.scrollLeft = el.scrollWidth
    const after = button?.getBoundingClientRect()
    return { viewport: innerWidth, before: before && { left: before.left, right: before.right }, after: after && { left: after.left, right: after.right }, scrollers: scrollers.map(el => ({ tag: el.tagName, width: el.clientWidth, scrollWidth: el.scrollWidth, scrollLeft: el.scrollLeft })) }
  })
  save('board-scroll.json', geometry)
  check('original wide board has a reachable full New Task button', !!geometry.after && geometry.after.left >= 0 && geometry.after.right <= geometry.viewport + 2, geometry)
  await shot('original-panel-scrolled')
}
async function inspectOtherPanels() {
  const picker = page.locator('.d2f-native-toolbar select')
  await picker.selectOption('skills-manager')
  await until(() => guest(() => !!document.querySelector('main[data-forsion-native-panel="skills-manager"] .dssm-section')), 'original Skills Manager panel', 90000)
  await guest(() => {
    document.querySelector('#dssm-tab-user')?.click()
  })
  await until(() => guest(() => {
    const toggle = document.querySelector('section[data-source-key="dsh"] button.dssm-source-toggle')
    if (!toggle) return false
    if (toggle.getAttribute('aria-expanded') !== 'true') toggle.click()
    return true
  }), 'expand the original DSH skill source after it loads')
  const skills = await until(() => guest(() => {
    const names = [...document.querySelectorAll('section[data-source-key="dsh"] .dssm-skill-row .dssm-name')].map(el => el.textContent.trim())
    return names.length && { names, text: document.querySelector('.dssm-section').innerText }
  }), 'original Skills Manager lists installed skills')
  check('original Skills Manager displays real installed skill entries in its dedicated panel', skills.names.length > 0, { names: skills.names })
  save('skills-panel.json', skills)
  await shot('05-original-skills-manager')
  await picker.selectOption('git-graph')
  await until(() => guest(() => !!document.querySelector('[data-forsion-git-graph]') && !!document.querySelector('[role="dialog"]')), 'original Git Graph dialog', 90000)
  const graph = await until(() => guest(() => {
    const text = document.querySelector('[role="dialog"]')?.innerText || ''
    return text.includes('D2F native acceptance fixture') && text
  }), 'current native project commit in original GraphDialog')
  check('original Git Graph shows the current Tangu project real commit', graph.includes('D2F native acceptance fixture'))
  save('git-panel.json', { workspace, head: execFileSync('git', ['-C', workspace, 'rev-parse', 'HEAD'], { encoding: 'utf8', windowsHide: true }).trim(), text: graph })
  await shot('06-original-git-graph')
  await picker.selectOption('task-board')
  await until(() => guest(() => !!document.querySelector('[data-dsh-taskboard-view]')), 'return to original Task Board')
}
async function main() {
  console.log(`OUT ${OUT}\nHOME ${home}`)
  save('metadata.json', { startedAt: new Date().toISOString(), home, workspace, desktop: DESKTOP, agent: AGENT, engineMode: managed ? 'managed' : 'external', model: MODEL, cases, reusedCases, reuseResult, maximumLiveTasks: 3 })
  if (managed) {
    // Reuse the real built desktop without modifying its checkout or replacing
    // its engine dist. A copied entry keeps __dirname in this isolated stage;
    // the sibling engine junction selects the requested worktree naturally.
    // Keep the copied application outside the evidence directory; archives
    // should contain screenshots/results, never a bundled app or junctions.
    const stage = path.join(home, `native-desktop-stage-${stamp}`)
    launchDesktop = path.join(stage, 'desktop')
    fs.mkdirSync(launchDesktop, { recursive: true })
    fs.cpSync(path.join(DESKTOP, 'out'), path.join(launchDesktop, 'out'), { recursive: true })
    fs.copyFileSync(path.join(DESKTOP, 'package.json'), path.join(launchDesktop, 'package.json'))
    for (const name of ['node_modules', 'build', 'resources']) if (fs.existsSync(path.join(DESKTOP, name))) {
      fs.symlinkSync(path.join(DESKTOP, name), path.join(launchDesktop, name), process.platform === 'win32' ? 'junction' : 'dir')
    }
    fs.symlinkSync(AGENT, path.join(stage, 'tangu-agent'), process.platform === 'win32' ? 'junction' : 'dir')
  }
  // Fixture preparation only: a real isolated Git repository for the original
  // Git Graph to inspect; no application database is written by the harness.
  if (!fs.existsSync(path.join(workspace, '.git'))) {
    fs.writeFileSync(path.join(workspace, 'README.md'), '# D2F native acceptance fixture\nTemporary workspace for native plugin acceptance.\n')
    execFileSync('git', ['init', workspace], { windowsHide: true, stdio: 'pipe' })
    execFileSync('git', ['-C', workspace, 'add', 'README.md'], { windowsHide: true, stdio: 'pipe' })
    execFileSync('git', ['-C', workspace, '-c', 'user.name=D2F Acceptance', '-c', 'user.email=acceptance@example.invalid', 'commit', '-m', 'D2F native acceptance fixture'], { windowsHide: true, stdio: 'pipe' })
  }
  fs.cpSync(path.join(REPO, 'plugin'), path.join(home, 'plugins/dsh2forsion'), { recursive: true })
  if (process.env.DSH2FORSION_ROOT) for (const sub of ['node', 'runtime']) {
    if (!fs.existsSync(path.join(data, sub))) fs.symlinkSync(path.join(process.env.DSH2FORSION_ROOT, sub), path.join(data, sub), process.platform === 'win32' ? 'junction' : 'dir')
  }
  const skillRoot = path.join(data, 'home/skills')
  assert.ok(fs.existsSync(skillRoot) && fs.readdirSync(skillRoot).some(name => fs.existsSync(path.join(skillRoot, name, 'SKILL.md'))), 'Use an isolated GUI seed with an existing DSH skill for the original Skills Manager read scenario')
  if (!fs.existsSync(authLink)) { fs.symlinkSync(process.env.DSH2FORSION_AUTH || path.join(os.homedir(), '.forsion-dev/provider-auth.json'), authLink); linkedAuth = true }
  await startEngine()
  const installed = await api(PREFIX + '/plugins')
  console.log('STEP required DSH packages')
  for (const [name, spec] of [
    ['dsh-client-ui-task-board', '@linxin666/dsh-client-ui-task-board@0.4.7'],
    ['dsh-skills-manager', '@michengai/dsh-skills-manager@1.2.24'],
    ['dsh-client-ui-git-graph', '@linxin666/dsh-client-ui-git-graph@0.4.7'],
    ['dsh2forsion-live-probe', `file:${path.join(REPO, 'tests/fixtures/live-probe')}`],
  ]) {
    if (!JSON.stringify(installed.plugins).includes(name)) {
      const result = await api(PREFIX + '/plugins/install', { spec })
      assert.equal(result.status, 'installed', `${name} installs`)
    }
  }
  contextSession = (await api('/agent/sessions', { title: `Native panel context ${stamp}`, model_id: MODEL, project_path: workspace,
    agent_config: { execMode: 'host', cwd: workspace, approvalMode: 'auto-edit', thinkingLevel: 'low' } })).session
  if (!managed) await startDesktop()
  await openContext(); await openBoard()
  check('real Electron mounts original Task Board in a dedicated native panel', await guest(() => !!document.querySelector('main[data-forsion-native-panel="task-board"] [data-dsh-taskboard-view]')))
  check('native panel binds the currently selected project before any model invocation', ledger().context.sessionId === contextSession.id && path.resolve(ledger().context.cwd) === workspace, { expected: contextSession.id, actual: ledger().context.sessionId, cwd: ledger().context.cwd, viewRequests })
  await shot('00-original-native-panel')
  for (const reuse of reusedCases) {
    const saved = ledger().executions[reuse.executionId]
    assert.ok(saved && saved.intent.modelId === MODEL && path.resolve(saved.intent.cwd) === workspace, 'reused approval belongs to this native project/model')
    const record = { ...saved, title: saved.intent.title, kind: reuse.kind, reused: true }
    executions.push(record)
    await settled(record, record.kind === 'cancel' ? 'aborted' : 'done')
    const expected = { approve: ['started', 'finished'], reject: [], cancel: ['started', 'cancelled'] }[record.kind]
    check(`${record.kind}: previous execution is verified without another model call`, JSON.stringify(probe(record.title).map(row => row.phase)) === JSON.stringify(expected))
    if (record.kind === 'approve') await captureNativeHistory(record)
  }
  if (cases.includes('approve')) {
    const approved = await createAndRun('approve')
    await approve(approved)
    await settled(approved, 'done')
    check('approved tool executes once in the selected temporary project', JSON.stringify(probe(approved.title).map(row => row.phase)) === JSON.stringify(['started', 'finished']) && probe(approved.title).every(row => path.resolve(row.cwd) === workspace))
    await captureNativeHistory(approved)
  }
  if (cases.includes('reject')) {
    const rejected = await createAndRun('reject')
    const rejectButton = rejected.approval.locator('.approval-actions button.danger')
    await rejectButton.click()
    await until(() => approvalRequests.some(item => item.path.includes(rejected.runId) && item.body.action === 'reject'), 'native rejection delivered')
    await settled(rejected, 'done')
    check('rejected approval has no tool side effect', probe(rejected.title).length === 0)
  }
  if (cases.includes('cancel')) {
    const cancelled = await createAndRun('cancel', 30000)
    await approve(cancelled)
    await until(() => probe(cancelled.title).some(row => row.phase === 'started'), 'slow tool started')
    await openBoard(); await openTask(cancelled.title)
    await until(() => nativeAction('cancel', 'Cancel Tangu task'), 'original panel cancellation button')
    await settled(cancelled, 'aborted')
    await until(() => probe(cancelled.title).some(row => row.phase === 'cancelled'), 'tool abort signal reached DSH')
    check('cancel propagates to the running DSH tool', !probe(cancelled.title).some(row => row.phase === 'finished'))
  }
  const before = executions.map(record => ({ executionId: record.executionId, runId: record.runId, sessionId: record.sessionId }))
  await stopDesktop(); await stopEngine(); await startEngine()
  if (!managed) await startDesktop()
  await openContext(); await openBoard()
  for (const record of executions) {
    const value = await until(async () => { const value = await card(record.title); return value?.status && value }, 'restored original task')
    const saved = ledger().executions[record.executionId]
    const original = originalRecord(record)
    check(`${record.kind}: full engine/Desktop restart preserves native identity and panel result`, saved.runId === record.runId && saved.sessionId === record.sessionId && value.status === original.status && original.execution.result === (record.kind === 'cancel' ? 'cancelled' : 'succeeded'))
  }
  await shot('04-restart-recovered')
  await inspectBoardScroll()
  await inspectOtherPanels()
  const beforeDisable = await api(PREFIX + '/status')
  const disabled = await api('/agent/plugins/dsh2forsion/enabled', { enabled: false }, 'PUT')
  check('disabling plugin deactivates its engine scope', disabled.enabled === false && disabled.active === false)
  const disabledRoute = await fetch(base + PREFIX + '/status', { headers: { authorization: `Bearer ${token}` } })
  check('disable revokes the native plugin routes', disabledRoute.status === 404, { status: disabledRoute.status })
  const sidecarPid = beforeDisable.sidecar?.pid
  assert.ok(Number.isSafeInteger(sidecarPid), 'the sidecar under test has a real process id')
  await until(() => { try { process.kill(sidecarPid, 0); return false } catch { return true } }, 'disabled owned sidecar exits', 15000)
  check('disable stops the actual DSH sidecar process', true, { pid: sidecarPid })
  for (const record of executions) check(`${record.kind}: native history survives plugin disable`, (await run(record))?.id === record.runId)
  save('lifecycle.json', { before, after: executions.map(record => ledger().executions[record.executionId]), disabled, disabledRouteStatus: disabledRoute.status, stoppedSidecarPid: sidecarPid })
  // Re-enable the isolated fixture so targeted reruns start in a known state.
  await api('/agent/plugins/dsh2forsion/enabled', { enabled: true }, 'PUT')
  check('live task budget respected', executions.filter(record => !record.reused).length === cases.length && executions.length <= 3)
}
main().catch(async error => {
  runFailure = safe(error.stack || error)
  checks.push({ name: 'uncaught acceptance failure', ok: false, error: runFailure })
  console.error(runFailure)
  if (page && !page.isClosed()) {
    await shot('failure').catch(() => {})
    save('failure-shell.txt', await page.locator('body').innerText().catch(() => ''))
    save('failure-guest.txt', await guest(() => document.body.innerText).catch(error => String(error)))
  }
  process.exitCode = 1
}).finally(async () => {
  for (const record of executions) {
    const current = await run(record).catch(() => null)
    if (current && !['done', 'error', 'aborted'].includes(current.status)) await api(`/agent/runs/${record.runId}/abort`, {}).catch(() => {})
  }
  await stopDesktop(); await stopEngine()
  if (linkedAuth) fs.unlinkSync(authLink)
  save('result.json', { ok: !runFailure && checks.every(item => item.ok), finishedAt: new Date().toISOString(), model: MODEL, liveTasks: executions.filter(record => !record.reused).length, reusedTasks: executions.filter(record => record.reused).length,
    checks, executions: executions.map(({ executionId, sessionId, runId, title, kind, reused }) => ({ executionId, sessionId, runId, title, kind, reused: !!reused })), approvals: approvalRequests })
  console.log(`RESULT ${path.join(OUT, 'result.json')}`)
})
