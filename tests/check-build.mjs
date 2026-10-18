// 包结构检查：plugin/ 是 src/ 的最新构建、各处版本一致、引擎半身只依赖 Node 内置模块、
// 兼容数据和钉死的 DSH 版本对得上、清单文案双语。
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { builtinModules } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BRIDGE_PACKAGE, DSH_VERSION, PLUGIN_ID } from '../src/engine/constants.mjs'

const repo = join(dirname(fileURLToPath(import.meta.url)), '..')
const plugin = join(repo, 'plugin')
const engine = join(plugin, 'tangu-plugins', PLUGIN_ID)
const json = async p => JSON.parse(await readFile(p, 'utf8'))

let n = 0
const it = async (name, fn) => { await fn(); n++; console.log(`ok ${n} ${name}`) }

async function files(dir) {
  const out = []
  for (const e of await readdir(dir, { withFileTypes: true, recursive: true })) {
    if (e.isFile()) out.push(relative(dir, join(e.parentPath ?? e.path, e.name)))
  }
  return out.sort()
}

await it('plugin/ is the current build of src/', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'dsh2forsion-build-'))
  try {
    execFileSync(process.execPath, [join(repo, 'build.mjs'), tmp], { stdio: 'pipe' })
    const want = await files(tmp)
    assert.deepEqual(await files(plugin), want, 'file list differs; run npm run build')
    for (const f of want) {
      const [a, b] = await Promise.all([readFile(join(plugin, f)), readFile(join(tmp, f))])
      assert.ok(a.equals(b), `${f} is stale; run npm run build`)
    }
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
})

await it('versions agree across package.json, manifest, engine and space; bridge name matches', async () => {
  const pkg = await json(join(repo, 'package.json'))
  const manifest = await json(join(plugin, 'manifest.json'))
  const tp = await json(join(engine, 'tangu-plugin.json'))
  const enginePkg = await json(join(engine, 'package.json'))
  const space = await json(join(plugin, 'spaces/dsh/space.json'))
  for (const [label, v] of [['manifest', manifest.version], ['tangu-plugin.json', tp.version], ['engine package.json', enginePkg.version], ['space.json', space.version]]) {
    assert.equal(v, pkg.version, label)
  }
  assert.equal(manifest.id, PLUGIN_ID)
  assert.equal(tp.id, PLUGIN_ID)
  assert.equal(enginePkg.type, 'module')
  const bridge = await json(join(engine, 'dsh-bridge/package.json'))
  assert.equal(bridge.name, BRIDGE_PACKAGE)
  assert.equal(bridge.dsh?.bundle?.patch, './cordis.patch.yml')
})

await it('the engine bundle imports only Node built-ins', async () => {
  // JSDoc 里的 import('./x.mjs') 类型注解不算
  const src = (await readFile(join(engine, 'dist/index.js'), 'utf8')).replace(/\/\*[\s\S]*?\*\//g, '')
  const specs = [...src.matchAll(/(?:^|\n)\s*import\s[^'"]*?from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|require\(\s*['"]([^'"]+)['"]\s*\)/g)].map(m => m[1] ?? m[2] ?? m[3])
  assert.ok(specs.length > 0)
  const builtins = new Set(builtinModules)
  for (const s of specs) assert.ok(s.startsWith('node:') || builtins.has(s), `non-builtin import ${s}`)
  assert.ok(src.includes('export'), 'dist must be an ES module with exports')
})

await it('compat data is for the pinned DSH version', async () => {
  const baseline = await json(join(engine, `compat/baseline-${DSH_VERSION}.json`))
  assert.ok(Array.isArray(baseline.tools) && Array.isArray(baseline.sections))
  const known = await json(join(engine, 'compat/known.json'))
  assert.equal(known.dsh, DSH_VERSION)
  for (const e of known.exemptions) assert.equal(known.plugins[e]?.exemption, true, `exemption ${e} is not a graded plugin`)
})

await it('manifest text is bilingual and says it is not made by DeepSeek', async () => {
  const m = await json(join(plugin, 'manifest.json'))
  const han = /[㐀-鿿]/
  assert.ok(han.test(m.description) && !han.test(m.descriptionEn))
  assert.match(m.descriptionEn, /not made or endorsed by DeepSeek/)
  assert.equal(m.onboarding.steps.length, m.onboarding.en.steps.length)
  for (const s of m.onboarding.en.steps) assert.ok(!han.test(s.title + s.description))
  assert.ok(!han.test(m.onboarding.en.intro))
  assert.equal(m.isDesktopOnly, true)
})

console.log(`check-build: ${n} passed`)
