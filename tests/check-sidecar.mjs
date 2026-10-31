// 端到端：真运行时 + 真 DSH sidecar，把构建好的引擎半身（plugin/…/dist/index.js）像 tangu-agent 那样激活，
// 经作用域路由走一遍用户路径：起 sidecar → 装插件（试启动）→ Tangu 调工具 → 拦下夹带核心包的插件 →
// 卸载 → 回滚 → 外观同步 → 停用。
//
//   DSH2FORSION_ROOT=<已装好运行时的根目录> node tests/check-sidecar.mjs
//     数据目录里软链 node/ 和 runtime/，home、试装目录、快照全新。
//   DSH2FORSION_FRESH=1 node tests/check-sidecar.mjs
//     从网上真装一遍运行时（约 1.1 GB），走界面上「下载并启动」那条路由。
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readdir, rm, symlink } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { DSH_VERSION, NODE_VERSION } from '../src/engine/constants.mjs'

const repo = join(dirname(fileURLToPath(import.meta.url)), '..')
const pluginDir = join(repo, 'plugin/tangu-plugins/dsh2forsion')
const fresh = process.env.DSH2FORSION_FRESH === '1'
const sourceRoot = process.env.DSH2FORSION_ROOT
if (!fresh && !sourceRoot) { console.error('set DSH2FORSION_ROOT (or DSH2FORSION_FRESH=1)'); process.exit(2) }

let n = 0
const it = async (name, fn) => { const t0 = Date.now(); await fn(); n++; console.log(`ok ${n} ${name} (${((Date.now() - t0) / 1000).toFixed(1)}s)`) }
const sleep = ms => new Promise(r => setTimeout(r, ms))

const scratch = await mkdtemp(join(tmpdir(), 'dsh2forsion-e2e-'))
const dataDir = join(scratch, 'plugin-data')
console.log(`test data: ${dataDir}`)
await mkdir(dataDir, { recursive: true })
if (!fresh) {
  for (const sub of ['node', 'runtime']) await symlink(join(sourceRoot, sub), join(dataDir, sub), process.platform === 'win32' ? 'junction' : 'dir')
}

// tangu-agent 给引擎插件的那部分上下文
const settings = { autoStart: true, exposeTools: true, downloadSource: 'auto' }
const routes = new Map()
const router = {
  get: (p, h) => routes.set(`GET ${p}`, h),
  post: (p, h) => routes.set(`POST ${p}`, h),
}
let meta = null
const ctx = {
  paths: { pluginDir, dataDir },
  sdk: { pluginStore: { getScopeSettings: () => settings, isPluginEnabledSync: () => true } },
  registerPlugin: m => { meta = m },
  registerScopedRoutes: fn => fn(router),
  log: line => console.log(`  [engine] ${line}`),
}
const call = (method, path, body) => new Promise((resolve, reject) => {
  const h = routes.get(`${method} ${path}`)
  if (!h) return reject(new Error(`no route ${method} ${path}`))
  const res = {
    code: 200,
    status(c) { this.code = c; return this },
    json(v) { if (this.code >= 400) reject(new Error(`${path} → ${this.code}: ${v.error}`)); else resolve(v) },
  }
  h({ body: body ?? {} }, res)
})
const waitFor = async (what, fn, ms) => {
  const t0 = Date.now()
  for (;;) {
    const v = await fn()
    if (v) return v
    if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`)
    await sleep(500)
  }
}
const tool = name => meta.toolProvider.tools().find(t => t.name === name)

const { default: engine, createPlugin } = await import(pathToFileURL(join(pluginDir, 'dist/index.js')).href)
const fixture = join(repo, 'tests/fixtures/fixture-tool')
const badShadow = join(repo, 'tests/fixtures/bad-shadow')
const failsToStart = join(repo, 'tests/fixtures/fails-to-start')

try {
  await it('activates within the time limit and registers routes, settings, tools and prompt hooks', async () => {
    const t0 = Date.now()
    await engine.activate(ctx)
    assert.ok(Date.now() - t0 < 30_000)
    assert.equal(meta.id, 'dsh2forsion')
    assert.deepEqual(meta.settings.fields.map(f => f.key), ['autoStart', 'exposeTools', 'downloadSource'])
    assert.equal(meta.toolProvider.id, 'plugin:dsh2forsion')
    for (const r of ['GET /status', 'POST /runtime/install', 'POST /space', 'POST /plugins/install', 'POST /plugins/rollback']) assert.ok(routes.has(r), r)
    const s = await call('GET', '/status')
    assert.equal(s.dshVersion, DSH_VERSION)
    assert.equal(s.nodeVersion, NODE_VERSION)
  })

  if (fresh) {
    await it('downloads the runtime from the install route and starts DSH', async () => {
      assert.equal((await call('GET', '/status')).runtime.installed, false)
      assert.deepEqual(await call('POST', '/runtime/install'), { started: true })
      const s = await waitFor('runtime install', async () => { const v = await call('GET', '/status'); return !v.job.running && v }, 1_800_000)
      assert.equal(s.job.error, null, s.job.error)
      assert.equal(s.runtime.installed, true)
      const markerFile = join(dataDir, 'runtime', DSH_VERSION, '.dsh2forsion-ready')
      const marker = await readFile(markerFile, 'utf8')
      const shippedLock = await readFile(join(pluginDir, 'runtime/package-lock.json'))
      assert.equal(JSON.parse(marker).lockSha256, createHash('sha256').update(shippedLock).digest('hex'))
      assert.deepEqual(await readFile(join(dataDir, 'runtime', DSH_VERSION, 'package-lock.json')), shippedLock)
      // Repeating the install must leave the running runtime and its marker intact.
      await call('POST', '/runtime/install')
      const again = await waitFor('repeat install', async () => { const v = await call('GET', '/status'); return !v.job.running && v }, 120_000)
      assert.equal(again.job.error, null)
      assert.equal(await readFile(markerFile, 'utf8'), marker)
    })
  }

  await it('starts the sidecar on its own and offers no tools while only built-ins are installed', async () => {
    const s = await waitFor('sidecar running', async () => { const v = await call('GET', '/status'); return v.sidecar.state === 'running' && v }, 120_000)
    console.log(`  sidecar ready in ${s.sidecar.readyMs} ms`)
    assert.deepEqual(s.tools, [])
    assert.deepEqual(s.promptSections, [])
    assert.deepEqual(meta.toolProvider.tools(), [])
    assert.equal(meta.promptSection(), '')
    const space = await call('POST', '/space')
    assert.match(space.url, /^http:\/\/127\.0\.0\.1:\d+\/\?token=\S+$/)
  })

  await it('installs a plugin after a clean trial start; its tool and prompt section reach Tangu', async () => {
    const r = await call('POST', '/plugins/install', { spec: `file:${fixture}` })
    assert.equal(r.status, 'installed', JSON.stringify(r))
    assert.equal(r.verdict, 'ok')
    const s = await call('GET', '/status')
    assert.equal(s.sidecar.state, 'running')
    assert.deepEqual(s.tools, ['fixture_echo'])
    assert.deepEqual(s.promptSections, ['dsh2forsion-fixture'])
    const t = tool('dsh__fixture_echo')
    assert.ok(t, 'tool offered to Tangu')
    assert.equal(t.capabilities.approval, 'always')
    assert.equal(t.capabilities.automationSafe, false)
    assert.deepEqual(t.definition.function.parameters.required, ['text'])
    assert.match(meta.promptSection(), /fixture ping/)
    const { plugins } = await call('GET', '/plugins')
    assert.deepEqual(plugins.map(p => p.name), ['dsh2forsion-fixture-tool'])
  })

  await it('a Tangu call runs in the conversation working directory', async () => {
    const proj = join(scratch, 'project-a')
    await mkdir(proj)
    const out = await tool('dsh__fixture_echo').execute({ text: 'hi' }, { sessionId: 's1', cwd: proj, signal: new AbortController().signal })
    assert.equal(out, `echo: hi (cwd ${proj})`)
    const bad = await tool('dsh__fixture_echo').execute({}, { sessionId: 's1', cwd: proj, signal: new AbortController().signal })
    assert.match(bad, /^Error: /)
    assert.doesNotMatch(bad, /^Error: Error:/)
  })

  await it('after a sidecar restart the same working directory resumes its persisted agent', async () => {
    const proj = join(scratch, 'project-a')
    await call('POST', '/sidecar/restart')
    await waitFor('restarted sidecar', async () => (await call('GET', '/status')).sidecar.state === 'running', 60_000)
    const out = await tool('dsh__fixture_echo').execute({ text: 'after restart' }, { sessionId: 's1', cwd: proj, signal: new AbortController().signal })
    assert.equal(out, `echo: after restart (cwd ${proj})`)
  })

  await it('a plugin that bundles its own copy of a DSH core package is stopped before it touches the profile', async () => {
    const r = await call('POST', '/plugins/install', { spec: `file:${badShadow}` })
    assert.equal(r.status, 'blocked', JSON.stringify(r))
    assert.ok(r.reasons.some(x => x.includes('@deepseek-ai/dsh-tools@0.1.0-rc.6')), r.reasons.join('\n'))
    const { plugins } = await call('GET', '/plugins')
    assert.deepEqual(plugins.map(p => p.name), ['dsh2forsion-fixture-tool'])
    assert.equal((await call('GET', '/status')).sidecar.state, 'running')
  })

  await it('a plugin that starts with errors is installed only after the user confirms', async () => {
    const spec = `file:${failsToStart}`
    const r = await call('POST', '/plugins/install', { spec })
    assert.equal(r.status, 'needs-confirm', JSON.stringify(r))
    assert.ok(r.reasons.some(x => x.includes('fixture refuses to start')), r.reasons.join('\n'))
    assert.deepEqual((await call('GET', '/plugins')).plugins.map(p => p.name), ['dsh2forsion-fixture-tool'])
    const ok = await call('POST', '/plugins/install', { spec, confirm: true })
    assert.equal(ok.status, 'installed', JSON.stringify(ok))
    assert.equal(ok.verdict, 'partial')
    assert.equal((await call('GET', '/status')).sidecar.state, 'running')
    assert.deepEqual((await call('GET', '/plugins')).plugins.map(p => p.name).sort(), ['dsh2forsion-fixture-fails-to-start', 'dsh2forsion-fixture-tool'])
    assert.equal((await call('POST', '/plugins/remove', { name: 'dsh2forsion-fixture-fails-to-start' })).status, 'removed')
  })

  await it('remove takes the tool away; rollback brings the plugin back', async () => {
    const r = await call('POST', '/plugins/remove', { name: 'dsh2forsion-fixture-tool' })
    assert.equal(r.status, 'removed', JSON.stringify(r))
    assert.deepEqual((await call('GET', '/status')).tools, [])
    assert.equal(tool('dsh__fixture_echo'), undefined)
    const back = await call('POST', '/plugins/rollback')
    assert.equal(back.status, 'rolled-back', JSON.stringify(back))
    // 换下来的那份留着（不参与下一次回滚）
    assert.ok(back.kept && (await readdir(join(dataDir, 'backups'))).some(d => d.startsWith('undone-')), JSON.stringify(back))
    assert.equal((await call('POST', '/plugins/remove', { name: '--help' })).status, 'failed')
    const s = await call('GET', '/status')
    assert.equal(s.sidecar.state, 'running')
    assert.deepEqual(s.tools, ['fixture_echo'])
  })

  await it('appearance follows Forsion', async () => {
    const r = await call('POST', '/appearance', { theme: 'dark', locale: 'en' })
    assert.equal(r.ok, true, JSON.stringify(r))
  })

  await it('turning tools off hides them from Tangu without stopping DSH', async () => {
    settings.exposeTools = false
    assert.deepEqual(meta.toolProvider.tools(), [])
    assert.equal(meta.promptSection(), '')
    settings.exposeTools = true
    assert.ok(tool('dsh__fixture_echo'))
  })

  await it('if the engine process dies without stopping it, DSH exits on its own', async () => {
    const home = join(scratch, 'orphan-home')
    const helper = spawn(process.execPath, [join(repo, 'tests/helpers/orphan-parent.mjs'), dataDir, home, join(pluginDir, 'dsh-bridge')], { stdio: ['ignore', 'pipe', 'inherit'] })
    let out = ''
    helper.stdout.on('data', d => { out += d })
    const pid = Number(await waitFor('helper sidecar', async () => out.match(/DSH_PID=(\d+)/)?.[1], 120_000))
    assert.doesNotThrow(() => process.kill(pid, 0))
    helper.kill('SIGKILL')
    await waitFor('orphaned DSH to exit', async () => { try { process.kill(pid, 0); return false } catch { return true } }, 15_000)
  })

  await it('turning the plugin off while DSH is still starting leaves nothing running', async () => {
    const data2 = join(scratch, 'plugin-data-2')
    await mkdir(data2, { recursive: true })
    for (const sub of ['node', 'runtime']) await symlink(join(dataDir, sub), join(data2, sub), process.platform === 'win32' ? 'junction' : 'dir')
    const routes2 = new Map()
    const ctx2 = { ...ctx, paths: { pluginDir, dataDir: data2 }, registerPlugin: () => {}, log: () => {},
      registerScopedRoutes: fn => fn({ get: (p, h) => routes2.set(`GET ${p}`, h), post: (p, h) => routes2.set(`POST ${p}`, h) }) }
    const status2 = () => new Promise(resolve => routes2.get('GET /status')({}, { status() { return this }, json: resolve }))
    const second = createPlugin()
    await second.activate(ctx2) // 开着自动启动：后台开始建 profile、装桥、起 DSH
    await sleep(300)
    const t0 = Date.now()
    await second.deactivate()
    assert.ok(Date.now() - t0 < 5000, `deactivate took ${Date.now() - t0} ms`)
    await sleep(8000) // 要是 start() 没看 disposed，DSH 会在这段时间里起来
    const s = await status2()
    assert.notEqual(s.sidecar.state, 'running', JSON.stringify(s.sidecar))
    assert.equal(s.sidecar.pid, null)
  })

  await it('deactivate stops the sidecar within the limit', async () => {
    const { sidecar } = await call('GET', '/status')
    const t0 = Date.now()
    await engine.deactivate()
    assert.ok(Date.now() - t0 < 5000)
    assert.throws(() => process.kill(sidecar.pid, 0))
  })
} finally {
  await engine.deactivate().catch(() => {})
  // CI 的机器用完即弃；Windows 上删 1.4 GB 的运行时树要好几分钟，就不删了
  if (!process.env.CI) await rm(scratch, { recursive: true, force: true })
}

console.log(`check-sidecar: ${n} passed`)
process.exit(0)
