// 纯函数单测：工具改名、结果渲染、提示词挑选与截断、试启动判定、包名解析、环境白名单、平台映射。
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { DSH_VERSION, NODE_VERSION, PNPM_VERSION } from '../src/engine/constants.mjs'
import { childEnv } from '../src/engine/env.mjs'
import { layout, nodePlatform } from '../src/engine/layout.mjs'
import { judgeTrial, specName } from '../src/engine/plugins.mjs'
import { installRuntime, runtimeInstalled, sources } from '../src/engine/runtime.mjs'
import { Sidecar } from '../src/engine/sidecar.mjs'
import { promptText, renderResult, tanguToolName, thirdPartySections } from '../src/engine/tools.mjs'

let n = 0
const it = async (name, fn) => { await fn(); n++; console.log(`ok ${n} ${name}`) }

await it('tool names get the dsh__ prefix, are sanitized, capped and deduplicated', () => {
  assert.equal(tanguToolName('fixture_echo'), 'dsh__fixture_echo')
  assert.equal(tanguToolName('a.b/c'), 'dsh__a_b_c')
  assert.equal(tanguToolName('x'.repeat(100)).length, 64)
  const taken = new Set(['dsh__dup'])
  assert.equal(tanguToolName('dup', taken), 'dsh__dup_2')
})

await it('results: text joined, errors prefixed once', () => {
  assert.equal(renderResult({ isError: false, content: [{ type: 'text', text: 'a' }, { type: 'image' }, { type: 'text', text: 'b' }] }), 'a\nb')
  assert.equal(renderResult({ isError: false, content: [] }), '(no text output)')
  assert.equal(renderResult({ isError: true, content: [{ type: 'text', text: 'Error: bad' }] }), 'Error: bad')
  assert.equal(renderResult({ isError: true, content: [{ type: 'text', text: 'bad' }] }), 'Error: bad')
  assert.equal(renderResult({ isError: true, error: { message: 'boom' } }), 'Error: boom')
})

await it('prompt sections: baseline dropped, empty dropped, ordered, capped', () => {
  const baseline = { sections: ['harness:identity'] }
  const picked = thirdPartySections([
    { name: 'harness:identity', order: 0, text: 'You are…' },
    { name: 'b', order: 20, text: 'second' },
    { name: 'a', order: 10, text: 'first' },
    { name: 'empty', order: 5, text: '  ' },
  ], baseline)
  assert.deepEqual(picked.map(s => s.name), ['a', 'b'])
  assert.match(promptText(picked), /^Instructions from DeepSeek Harness plugins[\s\S]*first\n\nsecond$/)
  assert.equal(promptText([]), '')
  const long = promptText([{ name: 'x', order: 0, text: 'y'.repeat(9000) }])
  assert.match(long, /\[truncated by DSH2Forsion\]$/)
  assert.ok(long.length < 4200)
})

await it('trial judgement: shadowed core or no start blocks; inactive entries ask; clean passes', () => {
  const shadowed = [{ name: '@deepseek-ai/dsh-tools', version: '0.1.0-rc.6', runtime: '0.2.1-rc.2' }]
  assert.equal(judgeTrial({ ready: true, lines: [], shadowed, pluginName: 'p' }).verdict, 'blocked')
  const noStart = judgeTrial({ ready: false, lines: ['dsh: startup failed: 1 required plugin did not activate', 'noise'], shadowed: [], pluginName: 'p' })
  assert.equal(noStart.verdict, 'blocked')
  assert.deepEqual(noStart.reasons, ['dsh: startup failed: 1 required plugin did not activate'])
  const partial = judgeTrial({ ready: true, lines: ['dsh: warning: 1 entry did not activate', 'p (p): TypeError: settings.register is not a function', 'other (q): waiting for service x'], shadowed: [], pluginName: 'p' })
  assert.equal(partial.verdict, 'partial')
  assert.deepEqual(partial.reasons, ['p (p): TypeError: settings.register is not a function'])
  assert.equal(judgeTrial({ ready: true, lines: ['dsh web: http://127.0.0.1:1/?token=x'], shadowed: [], pluginName: 'p' }).verdict, 'ok')
})

await it('trial judgement: a red matrix grade blocks a clean start, yellow asks, unknown changes nothing', () => {
  const clean = { ready: true, lines: [], shadowed: [], pluginName: 'p' }
  const red = judgeTrial({ ...clean, graded: { grade: 'red', reason: 'ui-break:3 core client entries not activated', checked: '2026-10-18' } })
  assert.equal(red.verdict, 'blocked')
  assert.deepEqual(red.reasons, ['compatibility matrix (2026-10-18): ui-break:3 core client entries not activated'])
  assert.equal(judgeTrial({ ...clean, graded: { grade: 'yellow' } }).verdict, 'partial')
  assert.equal(judgeTrial({ ...clean, graded: { grade: 'load-ok' } }).verdict, 'ok')
  // 试启动本身更重的结论不被矩阵冲淡
  assert.equal(judgeTrial({ ...clean, ready: false, graded: { grade: 'yellow' } }).verdict, 'blocked')
})

await it('spec names: versions and scopes stripped, junk refused', async () => {
  assert.equal(await specName('dsh-free-search@0.9.5'), 'dsh-free-search')
  assert.equal(await specName('@scope/pkg@^1.2.0'), '@scope/pkg')
  assert.equal(await specName('@scope/pkg'), '@scope/pkg')
  assert.equal(await specName('plain'), 'plain')
  await assert.rejects(() => specName('rm -rf /'))
  await assert.rejects(() => specName(''))
})

await it('child env: allowlist only, bin dir first on PATH', () => {
  const env = childEnv({ PATH: '/usr/bin', HOME: '/h', LC_ALL: 'C', OPENAI_API_KEY: 'sk', FORSION_TOKEN: 't', TANGU_X: '1', GITHUB_TOKEN: 'g', HTTPS_PROXY: 'p' }, { binDir: '/n/bin', extra: { DSH_HOME: '/d' } })
  assert.equal(env.PATH.split(process.platform === 'win32' ? ';' : ':')[0], '/n/bin')
  assert.equal(env.HOME, '/h')
  assert.equal(env.LC_ALL, 'C')
  assert.equal(env.HTTPS_PROXY, 'p')
  assert.equal(env.DSH_HOME, '/d')
  for (const k of ['OPENAI_API_KEY', 'FORSION_TOKEN', 'TANGU_X', 'GITHUB_TOKEN']) assert.equal(env[k], undefined, k)
})

await it('platforms and layout', () => {
  assert.deepEqual(nodePlatform('darwin', 'arm64'), { id: 'darwin-arm64', ext: 'tar.gz' })
  assert.deepEqual(nodePlatform('win32', 'x64'), { id: 'win-x64', ext: 'zip' })
  assert.equal(nodePlatform('linux', 'ia32'), null)
  const w = layout('C:/r', 'win32')
  assert.match(w.nodeBin, /node\.exe$/)
  assert.equal(layout('/r', 'linux').nodeBin, join('/r', 'node', NODE_VERSION, 'bin', 'node'))
  assert.deepEqual(sources('auto'), ['official', 'mirror'])
  assert.deepEqual(sources('mirror'), ['mirror'])
})

await it('runtime readiness rejects partial installs and preserves working legacy and locked runtimes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'd2f-runtime-'))
  const paths = layout(root)
  const marker = { dsh: DSH_VERSION, node: NODE_VERSION, pnpm: PNPM_VERSION }
  try {
    for (const file of [paths.nodeBin, paths.dshBin, paths.legacyPnpmBin]) {
      await mkdir(dirname(file), { recursive: true })
      await writeFile(file, 'placeholder')
    }
    assert.equal(runtimeInstalled(paths), false)
    await writeFile(paths.runtimeMarker, '{broken')
    assert.equal(runtimeInstalled(paths), false)
    await writeFile(paths.runtimeMarker, JSON.stringify({ ...marker, dsh: 'wrong-version' }))
    assert.equal(runtimeInstalled(paths), false)
    await writeFile(paths.runtimeMarker, JSON.stringify(marker))
    assert.equal(runtimeInstalled(paths), true)
    // These are not executables: any attempted reinstall would fail the test.
    await installRuntime(paths)
    assert.equal(await readFile(paths.dshBin, 'utf8'), 'placeholder')
    await writeFile(paths.runtimeMarker, JSON.stringify({ ...marker, lockSha256: 'locked' }))
    assert.equal(runtimeInstalled(paths), false, 'a locked runtime must have local pnpm')
    await mkdir(dirname(paths.pnpmBin), { recursive: true })
    await writeFile(paths.pnpmBin, 'placeholder')
    assert.equal(runtimeInstalled(paths), true)
    await installRuntime(paths)
    await rm(paths.dshBin)
    assert.equal(runtimeInstalled(paths), false)
    await assert.rejects(installRuntime(paths, { signal: AbortSignal.abort() }), { name: 'AbortError' })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

await it('failed npm ci retries the pinned tree without marking ready or touching profile data', async () => {
  const root = await mkdtemp(join(tmpdir(), 'd2f-install-fail-'))
  const paths = { ...layout(root), nodeBin: process.execPath, npmCli: join(root, 'fake-npm.cjs') }
  try {
    await mkdir(paths.runtimeDir, { recursive: true })
    await mkdir(paths.home, { recursive: true })
    await writeFile(join(paths.home, 'keep.txt'), 'user profile')
    await writeFile(paths.runtimeMarker, '{}')
    await writeFile(paths.npmCli, `
      const fs = require('node:fs');
      fs.appendFileSync('attempts.jsonl', JSON.stringify(process.argv.slice(2)) + '\\n');
      console.error('simulated integrity failure');
      process.exit(1);
    `)
    await assert.rejects(installRuntime(paths), /npm ci failed \(mirror\)/)
    const attempts = (await readFile(join(paths.runtimeDir, 'attempts.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse)
    assert.equal(attempts.length, 2)
    for (const args of attempts) assert.deepEqual(args, ['ci', '--ignore-scripts', '--no-audit', '--no-fund'])
    assert.deepEqual(await readFile(join(paths.runtimeDir, 'package-lock.json')), await readFile(new URL('../src/runtime/package-lock.json', import.meta.url)))
    await assert.rejects(readFile(paths.runtimeMarker), { code: 'ENOENT' })
    assert.equal(await readFile(join(paths.home, 'keep.txt'), 'utf8'), 'user profile')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

await it('a sidecar whose spawn fails asynchronously still stops at once (no hang)', async () => {
  if (process.platform === 'win32') return
  const root = await mkdtemp(join(tmpdir(), 'd2f-unit-'))
  try {
    const paths = layout(root)
    await mkdir(paths.nodeBinDir, { recursive: true })
    await writeFile(paths.nodeBin, '#!/bin/sh\n', { mode: 0o644 }) // 不可执行 → spawn 异步报 EACCES
    const sc = new Sidecar(paths, { home: join(root, 'home') })
    await assert.rejects(() => sc.start())
    assert.equal(sc.state, 'failed')
    const t0 = Date.now()
    await sc.stop()
    assert.ok(Date.now() - t0 < 500, `stop took ${Date.now() - t0} ms`)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

console.log(`check-unit: ${n} passed`)
