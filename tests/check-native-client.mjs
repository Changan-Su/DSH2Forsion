import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { mkdtemp, mkdir, readFile, writeFile, link, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { NativeTaskBoardRunner, executionRef } from '../src/native-client/runner.mjs'
import { installNativeAdapters } from '../src/native-client/host.mjs'
import { patchHost, patchClient, patchLayout, sha256, SPEC } from '../src/native-client/patches.mjs'
import { prepareNativeCompatibility } from '../src/native-client/install.mjs'
import { PANEL_PATCHES, patchPanel } from '../src/native-client/panels.mjs'

let passed = 0
async function test(name, fn) { await fn(); passed++; console.log(`  ok ${name}`) }
const task = { id: 'task-1', title: 'Real work', prompt: 'Run this.', workspaceId: 'project-1' }
const context = { cwd: '/project', workspaces: [{ id: 'project-1', path: '/project', name: 'Project' }], models: [] }
const options = { executionId: 'execution-1' }

await test('launch binds a durable external reference before dispatch, preserving prompt and cwd', async () => {
  const order = []
  const runner = new NativeTaskBoardRunner(async (op, payload) => {
    if (op === 'context') return context
    assert.equal(op, 'launch'); order.push('launch')
    assert.equal(payload.executionId, 'execution-1'); assert.equal(payload.cwd, '/project')
    assert.equal(payload.prompt, 'source wrapped: Run this.'); assert.equal(payload.mode, 'tangu')
    return { sessionId: 'native-session', runId: 'native-run' }
  }, { promptText: task => 'source wrapped: ' + task.prompt })
  assert.equal(await runner.launch(task, { ...options, onSession: ref => { assert.equal(ref, executionRef(options.executionId)); order.push('bind') } }), executionRef(options.executionId))
  assert.deepEqual(order, ['bind', 'launch'])
})
await test('lost launch responses retain the correlation handle; incompatible presets/resumes fail closed', async () => {
  let bound
  const runner = new NativeTaskBoardRunner(async op => { if (op === 'context') return context; throw new Error('response lost') }, { promptText: t => t.prompt })
  await assert.rejects(runner.launch(task, { ...options, onSession: ref => { bound = ref } }), /response lost/)
  assert.equal(bound, executionRef(options.executionId))
  await assert.rejects(runner.launch({ ...task, mode: 'dsh-preset' }, options), /preset/)
  await assert.rejects(runner.launch(task, { ...options, reuseSessionId: 'dsh-native-session' }), /not a native/)
})
await test('settlement uses positive Tangu outcomes; unknown stays unreadable rather than successful', async () => {
  let state = 'unknown'
  const runner = new NativeTaskBoardRunner(async () => ({ state }), { promptText: t => t.prompt })
  assert.deepEqual(await runner.inspect(executionRef('execution-1')), { outcome: 'pending', unreadable: true, reason: 'Native execution state is unknown' })
  for (const expected of ['succeeded', 'failed', 'cancelled']) { state = expected; assert.equal((await runner.inspect(executionRef('execution-1'))).outcome, expected) }
})
await test('roster exposes only external execution handles and counts waiting/queued as active', async () => {
  const runner = new NativeTaskBoardRunner(async () => ({ known: true, items: [{ executionId: 'one', state: 'waiting' }, { executionId: 'two', state: 'succeeded' }] }), { promptText: t => t.prompt })
  const value = await runner.listRunning()
  assert.equal(value.count, 1); assert.equal(value.items[0].sessionId, executionRef('one'))
})
await test('legacy DSH workspace pins resolve only through an approved native directory alias', async () => {
  let launched
  const runner = new NativeTaskBoardRunner(async (op, payload) => op === 'context' ? { ...context, workspaces: [{ ...context.workspaces[0], dshWorkspaceId: 'old-dsh-workspace' }] } : (launched = payload, { sessionId: 's', runId: 'r' }), { promptText: t => t.prompt })
  await runner.launch({ ...task, workspaceId: 'old-dsh-workspace' }, options)
  assert.equal(launched.workspaceId, 'project-1'); assert.equal(launched.cwd, '/project')
  await assert.rejects(runner.launch({ ...task, workspaceId: 'unapproved-dsh-workspace' }, options), /not registered/)
})
await test('native context registers approved directories through the public DSH workspace service, never a session', async () => {
  let route
  const registered = []
  const registry = { list: () => registered, async create(path, title) { const entry = { id: 'dsh-workspace-id', path, title }; registered.push(entry); return entry } }
  const ctx = { provide() {}, effect() {}, get(name) { assert.equal(name, 'workspaceRegistry'); return registry }, webServer: { register(row) { route = row; return () => {} } } }
  const api = installNativeAdapters(ctx, { invoke: async () => context })
  const ticket = api.openView().path.split('/')[3]
  const req = Readable.from([Buffer.from('{}')]); req.method = 'POST'; req.url = '/forsion-native/api/context'; req.headers = { host: 'localhost', 'x-forsion-native-view': ticket }
  const res = { writeHead() {}, end(body) { this.value = JSON.parse(body) } }
  await route.handler(req, res)
  assert.equal(registered.length, 1); assert.equal(res.value.workspaces[0].dshWorkspaceId, 'dsh-workspace-id')
  assert.equal(context.workspaces[0].dshWorkspaceId, undefined, 'caller context stays untouched')
  api.dispose()
})
await test('dedicated views reject arbitrary modules, missing credentials and browser launch injection', async () => {
  let route
  const services = new Map(), callbacks = []
  const ctx = { provide: (key, value) => services.set(key, value), effect: fn => callbacks.push(fn()), webServer: { register: row => { route = row; return () => {} } } }
  const invoke = async (op, payload) => { assert.equal(op, 'openSession'); assert.deepEqual(payload, { sessionId: 'forsion-task:one' }); return { opened: true } }
  const api = installNativeAdapters(ctx, { invoke })
  assert.throws(() => api.openView({ panelKey: 'arbitrary-module' }), /verified/)
  const view = api.openView({ panelKey: 'task-board' }), ticket = view.path.split('/')[3]
  const request = async (op, auth) => {
    const req = Readable.from([Buffer.from(JSON.stringify({ sessionId: 'forsion-task:one' }))]); req.method = 'POST'; req.url = '/forsion-native/api/' + op; req.headers = { host: '127.0.0.1:1234', 'x-forsion-native-view': auth }
    const res = { headersSent: false, writeHead(status) { this.status = status; this.headersSent = true }, end(body) { this.body = JSON.parse(body) } }
    await route.handler(req, res); return res
  }
  assert.equal((await request('openSession', '')).status, 403)
  assert.equal((await request('launch', ticket)).status, 404)
  assert.deepEqual((await request('openSession', ticket)).body, { opened: true })
  api.dispose(); assert.equal((await request('openSession', ticket)).status, 403)
})

const originalPackage = process.env.DSH2FORSION_TASKBOARD_PACKAGE
const runtime = process.env.DSH2FORSION_ROOT
if (originalPackage && runtime) {
  await test('dedicated carrier boots the official entry and patches only its owned layout registration', async () => {
    const fixture = await mkdtemp(join(tmpdir(), 'd2f-native-html-'))
    const clientFile = join(fixture, 'lib/client.js')
    await mkdir(join(fixture, 'lib')); await mkdir(join(fixture, '.forsion-native-original'))
    const sourceClient = await readFile(join(originalPackage, 'lib/client.js'), 'utf8')
    await writeFile(clientFile, patchClient(sourceClient)); await writeFile(join(fixture, '.forsion-native-original/client.js'), sourceClient)
    await writeFile(join(fixture, 'package.json'), JSON.stringify({ name: SPEC.package, version: SPEC.version }))
    const layoutFile = join(runtime, 'node_modules/@deepseek-ai/dsh-client-ui-layout/lib/client.js')
    const original = await readFile(layoutFile, 'utf8')
    // Actual rc.2 clientModules combo serialization consumes the preceding newline.
    const normalized = original.replace(/(?:\r?\n)?\/\/# sourceURL=([^\r\n]+)(?:\r?\n)?$/, '').replace(/(?:\r?\n)?\/\/# sourceMappingURL=[^\r\n]*(?:\r?\n)?$/, '')
    const url = '/plugins/layout-test?rev=one'
    const graph = { entries: [{ id: SPEC.package, url: '/plugins/task-board?rev=one' }, { id: '@deepseek-ai/dsh-client-ui-layout', url }], batches: [] }
    const modules = { graph: () => graph, clientPath: id => id === SPEC.package ? clientFile : layoutFile, fetchBundle: async () => new Response(normalized.endsWith('\n') ? normalized : normalized + '\n') }
    let route
    const connection = { authenticatedUrl: origin => origin + '?token=DSH_SERVER_ONLY', authorizeIndex: (req, res) => { assert.match(req.url, /DSH_SERVER_ONLY/); res.writeHead(303, { 'set-cookie': 'signed=opaque; HttpOnly; SameSite=Strict' }); res.end(); return false } }
    const ctx = { provide() {}, effect() {}, get: name => name === 'connection' ? connection : modules, webServer: { register: row => { route = row; return () => {} }, renderIndex: html => html.replace('<head>', `<head><script src="${url}"></script>`) } }
    const api = installNativeAdapters(ctx, { invoke: async () => context })
    const view = api.openView(), ticket = view.path.split('/')[3]
    const get = async path => {
      const req = { method: 'GET', url: path, headers: { host: '127.0.0.1' } }
      const res = { headersSent: false, writeHead(status, headers) { this.status = status; this.headers = headers; this.headersSent = true }, end(body) { this.body = body } }
      await route.handler(req, res); return res
    }
    const page = await get(view.path)
    assert.equal(page.status, 200); assert.match(page.body, /<base href="\/">/)
    assert.match(page.body, /<script type="module" crossorigin src="\/assets\/index-[^"]+\.js"><\/script>/)
    assert.match(page.body, /__DSH_TRANSPORT__/); assert.match(page.body, /forsion-native\/bundle\?ticket=/)
    assert.match(page.headers['set-cookie'], /HttpOnly/); assert.equal(page.body.includes('DSH_SERVER_ONLY'), false)
    assert.doesNotMatch(page.body, /<iframe|display:\s*none|visibility:\s*hidden/)
    const bundle = await get(`/forsion-native/bundle?ticket=${ticket}&src=${encodeURIComponent(url)}`)
    assert.equal(bundle.status, 200); assert.match(bundle.body, /function ForsionNativeRoot/)
    assert.match(bundle.body, /props\.renderSlot\(view\.slot/)
    assert.equal((await get(`/forsion-native/bundle?ticket=${ticket}&src=${encodeURIComponent('/private/arbitrary.js')}`)).status, 403)
    await writeFile(clientFile, 'unverified replacement')
    assert.equal((await get(view.path)).status, 500, 'late same-version replacement fails closed')
    api.dispose()
    await rm(fixture, { recursive: true, force: true })
  })
  await test('exact published artifacts patch and parse; tampering is refused', async () => {
    const base = await mkdtemp(join(tmpdir(), 'd2f-native-artifact-'))
    try {
      const sources = [await readFile(join(originalPackage, 'lib/index.js'), 'utf8'), await readFile(join(originalPackage, 'lib/client.js'), 'utf8'), await readFile(join(runtime, 'node_modules/@deepseek-ai/dsh-client-ui-layout/lib/client.js'), 'utf8')]
      for (const [i, patch] of [patchHost, patchClient, patchLayout].entries()) {
        const output = patch(sources[i]), file = join(base, `${i}.js`)
        await writeFile(file, output); execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' })
        assert.throws(() => patch(sources[i] + '\n/* unknown */'), /guard/)
      }
      const manifest = JSON.parse(await readFile(new URL('../compat/patches/task-board-0.4.7.json', import.meta.url), 'utf8'))
      assert.equal(manifest.files['lib/index.js'], SPEC.host); assert.equal(manifest.files['lib/client.js'], SPEC.client)
    } finally { await rm(base, { recursive: true, force: true }) }
  })
  await test('installer is idempotent and preserves pnpm shared inodes, source and license', async () => {
    const base = await mkdtemp(join(tmpdir(), 'd2f-native-install-')), profile = join(base, 'profile'), root = join(profile, 'node_modules/@linxin666/dsh-client-ui-task-board')
    try {
      await mkdir(join(root, 'lib'), { recursive: true }); await mkdir(join(base, 'store'))
      for (const file of ['index.js', 'client.js']) {
        const source = await readFile(join(originalPackage, 'lib', file)), store = join(base, 'store', file)
        await writeFile(store, source); await link(store, join(root, 'lib', file))
      }
      const pkg = await readFile(join(originalPackage, 'package.json')); await writeFile(join(root, 'package.json'), pkg)
      const license = await readFile(join(originalPackage, 'LICENSE')); await writeFile(join(root, 'LICENSE'), license)
      await prepareNativeCompatibility({ profileDir: profile }); const once = await readFile(join(root, 'lib/index.js'))
      await prepareNativeCompatibility({ profileDir: profile }); assert.deepEqual(await readFile(join(root, 'lib/index.js')), once)
      assert.equal(sha256(await readFile(join(base, 'store/index.js'))), SPEC.host)
      assert.equal(sha256(await readFile(join(base, 'store/client.js'))), SPEC.client)
      assert.deepEqual(await readFile(join(root, 'LICENSE')), license)
      assert.match(await readFile(join(root, 'NOTICE'), 'utf8'), /Apache-2.0/)
      await writeFile(join(root, 'lib/client.js'), 'unknown edits')
      await assert.rejects(prepareNativeCompatibility({ profileDir: profile }), /unknown modifications/)
    } finally { await rm(base, { recursive: true, force: true }) }
  })
} else console.log('  artifact checks require DSH2FORSION_TASKBOARD_PACKAGE + DSH2FORSION_ROOT; not counted')
const panelPackages = { 'skills-manager': process.env.DSH2FORSION_SKILLS_PACKAGE, 'git-graph': process.env.DSH2FORSION_GITGRAPH_PACKAGE }
for (const [panel, pkgRoot] of Object.entries(panelPackages)) if (pkgRoot) {
  await test(`${panel}: published client compiles, no private registry access, isolated patch is repeatable`, async () => {
    const base = await mkdtemp(join(tmpdir(), `d2f-panel-${panel}-`)), profile = join(base, 'profile'), spec = PANEL_PATCHES[panel], target = join(profile, 'node_modules', ...spec.package.split('/'))
    try {
      let original = await readFile(join(pkgRoot, 'lib/client.js'), 'utf8')
      if (sha256(original) !== spec.sha256) original = await readFile(join(pkgRoot, '.forsion-native-original/client.js'), 'utf8')
      const patched = patchPanel(panel, original), file = join(base, 'client.js')
      await writeFile(file, patched); execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' })
      assert.match(patched, /nativeExecutionClient/); assert.throws(() => patchPanel(panel, original + '/* unknown */'), /guard/)
      assert.equal(patched.includes('slots._core'), false)
      if (panel === 'git-graph') { assert.match(patched, /createElement\(GraphDialog/); assert.match(patched, /nativeGit\.graph\(void 0,limit\)/) }
      await mkdir(join(target, 'lib'), { recursive: true })
      await writeFile(join(target, 'lib/client.js'), original)
      await writeFile(join(target, 'package.json'), await readFile(join(pkgRoot, 'package.json')))
      const license = await readFile(join(pkgRoot, 'LICENSE')); await writeFile(join(target, 'LICENSE'), license)
      await prepareNativeCompatibility({ profileDir: profile }); const once = await readFile(join(target, 'lib/client.js'))
      await prepareNativeCompatibility({ profileDir: profile }); assert.deepEqual(await readFile(join(target, 'lib/client.js')), once)
      assert.deepEqual(await readFile(join(target, 'LICENSE')), license); assert.match(await readFile(join(target, 'NOTICE'), 'utf8'), /Apache-2.0/)
      assert.ok(JSON.parse(await readFile(join(target, 'package.json'), 'utf8')).dsh.client.inject.includes('dsh2forsion-bridge'))
    } finally { await rm(base, { recursive: true, force: true }) }
  })
}
console.log(`check-native-client: ${passed} checks passed`)
