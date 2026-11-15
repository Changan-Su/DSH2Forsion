// 第 1 档融合的纯逻辑：融合组合的写盘纪律、日志抹令牌、跟版通道的清单规则与「先退回上一版」、桥的工具批量接口与装插件闸。
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ensureFusedProfile, fusionPatch, ForeignProfileError } from '../src/engine/fusion.mjs'
import { redact, Sidecar } from '../src/engine/sidecar.mjs'
import { PluginManager } from '../src/engine/plugins.mjs'
import { activeVersion, compareVersions, previousVersion, setActiveVersion, validateManifest, verifiedVersions } from '../src/engine/channel.mjs'
import { DSH_VERSION, FUSION_MARKER, NODE_VERSION, PNPM_VERSION } from '../src/engine/constants.mjs'
import { layout, resolveDshHome } from '../src/engine/layout.mjs'
import { executeTool, installGate } from '../src/dsh-bridge/index.js'
import { relocateLock } from '../src/engine/profile.mjs'

let n = 0
const it = async (name, fn) => { await fn(); n++; console.log(`ok ${n} ${name}`) }
const scratch = await mkdtemp(join(tmpdir(), 'd2f-fusion-unit-'))
const sha = s => createHash('sha256').update(s).digest('hex')

try {
  await it('DSH folder: $DSH_HOME wins, else ~/.dsh of $HOME', () => {
    assert.equal(resolveDshHome({ DSH_HOME: '/x/dsh', HOME: '/h' }), '/x/dsh')
    assert.equal(resolveDshHome({ DSH_HOME: '  ', HOME: '/h' }), '/h/.dsh')
  })

  await it('fused profile: created with marker, bundles and patch; later runs keep the user\'s plugins and patch edits', async () => {
    const paths = layout(join(scratch, 'root'), process.platform, { dshHome: join(scratch, 'dsh') })
    const r = await ensureFusedProfile(paths)
    assert.equal(r.created, true)
    const dir = paths.profileDir
    assert.ok((await readFile(join(dir, FUSION_MARKER), 'utf8')).includes('dsh2forsion'))
    const pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'))
    assert.deepEqual(pkg.dsh.profile.bundles, ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@deepseek-ai/dsh-acp-app'])
    assert.equal(await readFile(join(dir, 'cordis.patch.yml'), 'utf8'), fusionPatch())
    // DSH 的插件页往组合里写了依赖、在 patch 里关了一行
    // `dsh plugin add` 也往 bundles 后面追加
    await writeFile(join(dir, 'package.json'), JSON.stringify({ ...pkg, dependencies: { 'dsh-genui': '0.3.3' }, dsh: { profile: { bundles: [...pkg.dsh.profile.bundles, 'dsh2forsion-bridge', 'dsh-genui'] } } }))
    await writeFile(join(dir, 'cordis.patch.yml'), fusionPatch() + '- id: tool-web\n  disabled: true\n')
    assert.equal((await ensureFusedProfile(paths)).created, false)
    const kept = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'))
    assert.deepEqual(kept.dependencies, { 'dsh-genui': '0.3.3' })
    assert.deepEqual(kept.dsh.profile.bundles.slice(3), ['dsh2forsion-bridge', 'dsh-genui'])
    // 有人把官方 bundle 删了一个：补回来，其余顺序不动
    await writeFile(join(dir, 'package.json'), JSON.stringify({ ...kept, dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', 'dsh2forsion-bridge', 'dsh-genui'] } } }))
    await ensureFusedProfile(paths)
    assert.deepEqual(JSON.parse(await readFile(join(dir, 'package.json'), 'utf8')).dsh.profile.bundles, ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@deepseek-ai/dsh-acp-app', 'dsh2forsion-bridge', 'dsh-genui'])
    assert.match(await readFile(join(dir, 'cordis.patch.yml'), 'utf8'), /- id: tool-web\n  disabled: true\n$/)
  })

  await it('fused profile: a same-named profile the user made is never adopted; a broken package.json is an error, not an empty file', async () => {
    const paths = layout(join(scratch, 'root2'), process.platform, { dshHome: join(scratch, 'dsh2') })
    await mkdir(paths.profileDir, { recursive: true })
    await writeFile(join(paths.profileDir, 'package.json'), '{"name":"mine"}')
    await assert.rejects(ensureFusedProfile(paths), ForeignProfileError)
    assert.equal(await readFile(join(paths.profileDir, 'package.json'), 'utf8'), '{"name":"mine"}')
    await writeFile(join(paths.profileDir, FUSION_MARKER), '{}')
    await writeFile(join(paths.profileDir, 'package.json'), '{"name":')
    await assert.rejects(ensureFusedProfile(paths), /Cannot read/)
    assert.equal(await readFile(join(paths.profileDir, 'package.json'), 'utf8'), '{"name":')
  })

  await it('trial copy: pnpm lock paths to the bundled bridge are re-based on the new folder', () => {
    const lock = "      dsh2forsion-bridge:\n        specifier: file:/abs/bridge\n        version: file:../../../../../plugin/x/dsh-bridge(@deepseek-ai/cordis@4.0.5)\n  'dsh2forsion-bridge@file:../../../../../plugin/x/dsh-bridge':\n    resolution: {directory: ../../../../../plugin/x/dsh-bridge, type: directory}\n"
    const out = relocateLock(lock, '/r/.tmp/f/dsh/profiles/forsion', '/r/.tmp/f/plugin-data/trial/profiles/forsion')
    assert.ok(out.includes('specifier: file:/abs/bridge'), 'absolute specifiers stay')
    assert.equal((out.match(/\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/plugin\/x\/dsh-bridge/g) ?? []).length, 3)
  })

  await it('logs: the launch token is redacted wherever it appears', () => {
    assert.equal(redact('dsh web: http://127.0.0.1:5/?token=abc.DEF-12'), 'dsh web: http://127.0.0.1:5/?token=<redacted>')
    assert.equal(redact('open http://x/?a=1&token=zz "q"'), 'open http://x/?a=1&token=<redacted> "q"')
  })

  await it('versions compare like semver, prereleases included', () => {
    assert.ok(compareVersions('0.2.2-rc.3', '0.2.2-rc.10') < 0)
    assert.ok(compareVersions('0.2.2-rc.3', '0.2.2') < 0)
    assert.ok(compareVersions('0.2.3-alpha.1', '0.2.2') > 0)
    assert.equal(compareVersions('0.2.2-rc.3', '0.2.2-rc.3'), 0)
  })

  const manifest = (over = {}) => {
    const packageJson = JSON.stringify({ name: 'dsh2forsion-runtime', private: true, dependencies: { '@deepseek-ai/dsh': '0.2.3', pnpm: PNPM_VERSION } })
    const lock = '{"lockfileVersion":3}'
    return { schema: 1, dsh: '0.2.3', node: NODE_VERSION, pnpm: PNPM_VERSION, plugin: { min: '0.2.0' }, files: { packageJson, lock }, sha256: { packageJson: sha(packageJson), lock: sha(lock) }, selfCheck: { ok: true }, ...over }
  }
  await it('runtime manifest: accepted only with matching checksums, Node / pnpm, plugin version and a passed self-check', () => {
    assert.equal(validateManifest(manifest()).dsh, '0.2.3')
    assert.throws(() => validateManifest({ ...manifest(), sha256: { ...manifest().sha256, lock: 'x' } }), /checksum/)
    assert.throws(() => validateManifest(manifest({ node: 'v22.0.0' })), /Node/)
    assert.throws(() => validateManifest(manifest({ plugin: { min: '9.0.0' } })), /needs DSH2Forsion 9\.0\.0/)
    assert.throws(() => validateManifest(manifest({ selfCheck: { ok: false } })), /self-check/)
    assert.throws(() => validateManifest(manifest({ dsh: '0.2.4' })), /do not pin/)
  })

  await it('active version: unknown or unreadable falls back to the shipped DSH; going back only to installed, verified, older versions', async () => {
    const root = join(scratch, 'chan')
    assert.equal(activeVersion(root), DSH_VERSION)
    await setActiveVersion(root, '9.9.9')
    assert.equal(activeVersion(root), DSH_VERSION, 'not verified for this plugin')
    await writeFile(join(root, 'active-runtime.json'), '{')
    assert.equal(activeVersion(root), DSH_VERSION, 'unreadable = unknown, not a version')
    // 盘上装着 0.2.1 和随包那一版；0.2.1 没有校验过的清单 → 不能退
    for (const v of ['0.2.1', DSH_VERSION]) {
      await mkdir(join(root, 'runtime', v), { recursive: true })
      await writeFile(join(root, 'runtime', v, '.dsh2forsion-ready'), JSON.stringify({ dsh: v, node: NODE_VERSION, pnpm: PNPM_VERSION }))
    }
    assert.equal(await previousVersion(root, DSH_VERSION), null)
    // 通道上校验过的 0.2.3 装好了、在用；随包那一版就是「上一版」
    const m = manifest()
    await mkdir(join(root, 'channel'), { recursive: true })
    await writeFile(join(root, 'channel', 'manifest-0.2.3.json'), JSON.stringify(m))
    await mkdir(join(root, 'runtime', '0.2.3'), { recursive: true })
    await writeFile(join(root, 'runtime', '0.2.3', '.dsh2forsion-ready'), JSON.stringify({ dsh: '0.2.3', node: NODE_VERSION, pnpm: PNPM_VERSION }))
    assert.ok(verifiedVersions(root).includes('0.2.3'))
    await setActiveVersion(root, '0.2.3')
    assert.equal(activeVersion(root), '0.2.3')
    assert.equal(await previousVersion(root, '0.2.3'), DSH_VERSION)
  })

  await it('bridge tool calls: DSH 0.2.2 batch input (arguments as JSON text) and the 0.2.1 single call', async () => {
    const seen = []
    const batch = { selectExecutor() {}, execute: async input => { seen.push(input); return { results: [{ callId: input.calls[0].id, result: { content: 'ok' } }] } } }
    assert.deepEqual(await executeTool(batch, { callId: 'c1', name: 'read', args: { path: 'a' } }), { content: 'ok' })
    assert.deepEqual(seen[0].calls, [{ type: 'tool-call', id: 'c1', name: 'read', arguments: '{"path":"a"}' }])
    const single = { execute: async input => ({ got: input }) }
    assert.deepEqual((await executeTool(single, { callId: 'c2', name: 'x', args: { a: 1 } })).got, { callId: 'c2', name: 'x', arguments: { a: 1 }, signal: undefined })
  })

  await it('install gate: holds only installs the plugin page starts, releases on allow, rejects on deny / dispose, restores on unload', async () => {
    class PluginManager {
      async installBundle(spec, options) { return { installed: spec, options } }
      async cancelInstall() { return { status: 'not-running' } }
      async waitForInstall() { return null }
    }
    const pm = new PluginManager()
    // cordis 给的是代理：往代理身上赋值无效
    const proxy = new Proxy(pm, { set: () => true })
    let unload
    const ctx = { inject: (deps, cb) => { assert.deepEqual(deps, ['pluginManager']); cb({ get: () => proxy, effect: f => { unload = f() } }) } }
    const log = { warn() {}, info() {} }
    const gate = installGate(ctx, log)
    assert.equal(gate.armed, true)
    assert.deepEqual(await proxy.installBundle('a', {}), { installed: 'a', options: {} }, 'internal install: not held')
    assert.equal((await proxy.installBundle('b', { requestId: 'r', expected: { name: 'b' } })).installed, 'b', 'update path: not held')
    const held = proxy.installBundle('dsh-genui@0.3.3', { requestId: 'r1' })
    await new Promise(r => setTimeout(r, 5))
    const [p] = gate.list()
    assert.equal(p.spec, 'dsh-genui@0.3.3')
    gate.decide(p.id, true)
    assert.equal((await held).installed, 'dsh-genui@0.3.3')
    const denied = proxy.installBundle('x', { requestId: 'r2' })
    gate.decide(gate.list()[0].id, false, 'Cancelled in Forsion')
    await assert.rejects(denied, /Cancelled in Forsion/)
    // DSH 里点取消：还在等 Forsion 回话的那次当作拒绝；重连后按 requestId 取结果拿到的是同一次
    const waiting = proxy.installBundle('w', { requestId: 'r5' })
    const recovered = proxy.waitForInstall('r5')
    assert.deepEqual(await proxy.cancelInstall('r5'), { status: 'cancelled' })
    await assert.rejects(waiting, /Cancelled in DSH/)
    assert.equal(await recovered, null, 'a refused install is no install')
    assert.equal(gate.list().length, 0)
    assert.deepEqual(await proxy.cancelInstall('other'), { status: 'not-running' }, 'unknown ids still go to DSH')
    const approved = proxy.installBundle('v', { requestId: 'r6' })
    const later = proxy.waitForInstall('r6')
    gate.decide(gate.list()[0].id, true)
    assert.equal((await later).installed, 'v')
    await approved
    const pending = proxy.installBundle('y', { requestId: 'r3' })
    gate.dispose()
    await assert.rejects(pending, /bridge stopped/)
    unload()
    assert.equal(gate.armed, false)
    assert.equal(PluginManager.prototype.installBundle.name, 'installBundle')
    assert.deepEqual(await proxy.cancelInstall('r7'), { status: 'not-running' }, 'unloaded: original cancel back')
    assert.deepEqual(await proxy.installBundle('z', { requestId: 'r4' }), { installed: 'z', options: { requestId: 'r4' } }, 'unloaded: original method back')
  })

  await it('restore / remove / roll back leave a profile alone that DSH2Forsion did not create, and snapshots only go back to their own DSH folder', async () => {
    const paths = layout(join(scratch, 'own-root'), process.platform, { dshHome: join(scratch, 'own-dsh') })
    let restarts = 0
    const mgr = new PluginManager(paths, { main: { state: 'stopped' }, bridgeDir: '', netHook: '', known: () => ({}), log: () => {}, restart: async () => { restarts++ } })
    await mkdir(paths.profileDir, { recursive: true })
    await writeFile(join(paths.profileDir, 'package.json'), '{"name":"mine"}\n') // 用户自己建的同名组合（没有标记文件）
    // 别处来的「上次能启动」快照
    await mkdir(join(paths.backups, 'last-good', 'profile'), { recursive: true })
    await writeFile(join(paths.backups, 'last-good', 'profile', 'package.json'), '{"name":"backup"}\n')
    for (const r of [await mgr.restoreLastGood(), await mgr.rollback(), await mgr.remove('dsh-genui')]) assert.equal(r.status, 'failed', JSON.stringify(r))
    assert.equal(await readFile(join(paths.profileDir, 'package.json'), 'utf8'), '{"name":"mine"}\n', 'the foreign profile is untouched')
    assert.equal(restarts, 0)
    // 是自己的组合，但快照来自另一份 DSH 目录（换过 DSH_HOME / v0.1 的私有目录）：不认
    await writeFile(join(paths.profileDir, FUSION_MARKER), '{}')
    assert.equal(await mgr.sameHome(join(paths.backups, 'last-good')), false)
    assert.equal((await mgr.restoreLastGood()).status, 'nothing-to-restore')
    assert.equal(await readFile(join(paths.profileDir, 'package.json'), 'utf8'), '{"name":"mine"}\n')
    const snap = await mgr.snapshot('test')
    assert.equal(await mgr.sameHome(snap), true, 'a snapshot taken here belongs here')
  })

  await it('trial probes do not start once the plugin is being turned off', async () => {
    const paths = layout(join(scratch, 'off-root'), process.platform, { dshHome: join(scratch, 'off-dsh') })
    const mgr = new PluginManager(paths, { main: { state: 'stopped' }, bridgeDir: '', netHook: '', known: () => ({}), log: () => {}, restart: async () => {} })
    await mgr.dispose()
    const m = await mgr.measure(join(scratch, 'off-trial'), 'before')
    assert.equal(m.ready, false)
    assert.equal(mgr.probe, null, 'no probe was created')
  })

  await it('Chinese text split across two stdout chunks reaches the chat intact', async () => {
    const dir = join(scratch, 'utf8')
    await mkdir(dir, { recursive: true })
    const fake = join(dir, 'fake-dsh.mjs')
    // 就绪行之后写一条 JSON：在「你」的三个字节中间断开，分两次写
    await writeFile(fake, `const line = Buffer.from(JSON.stringify({ jsonrpc: '2.0', method: 'x', params: { text: '你好' } }) + '\\n')
const cut = line.indexOf(Buffer.from('你')) + 1
process.stdout.write('dsh web: http://127.0.0.1:1/?token=abc\\n')
setTimeout(() => { process.stdout.write(line.subarray(0, cut)); setTimeout(() => process.stdout.write(line.subarray(cut)), 50) }, 50)
setInterval(() => {}, 1000)
`)
    const paths = { ...layout(join(scratch, 'utf8-root'), process.platform, { dshHome: join(scratch, 'utf8-dsh') }), nodeBin: process.execPath, dshBin: fake }
    const sc = new Sidecar(paths, { cwd: dir })
    try {
      await sc.start()
      const conn = sc.connection()
      let got = ''
      await new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('no JSON line')), 5000)
        conn.output.on('data', d => { got += d; if (got.includes('\n')) { clearTimeout(t); resolve() } })
      })
      assert.equal(JSON.parse(got.trim()).params.text, '你好')
    } finally { await sc.stop(1000) }
  })

  await it('install gate reports why it is not armed', () => {
    const g = installGate({ inject: (_d, cb) => cb({ get: () => ({}), effect: f => f() }) }, { warn() {}, info() {} })
    assert.equal(g.armed, false)
    assert.match(g.reason, /no installBundle/)
    assert.match(installGate({}, { warn() {} }).reason, /no ctx\.inject/)
  })
} finally {
  await rm(scratch, { recursive: true, force: true })
}
console.log(`check-fusion-unit: ${n} passed`)
