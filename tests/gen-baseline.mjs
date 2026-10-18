// 生成 compat/baseline-<DSH 版本>.json：干净 profile（只装桥）里 DSH 自带的全局工具与提示词分节名单。
// 工具桥据此把「第三方插件加的」挑出来交给 Tangu。升级 DSH 版本时重跑。
// 用法：DSH2FORSION_ROOT=<已装好运行时的根目录> node tests/gen-baseline.mjs
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DSH_VERSION } from '../src/engine/constants.mjs'
import { layout } from '../src/engine/layout.mjs'
import { ensureBridge, ensureProfile } from '../src/engine/profile.mjs'
import { runtimeInstalled } from '../src/engine/runtime.mjs'
import { Sidecar } from '../src/engine/sidecar.mjs'

const repo = join(dirname(fileURLToPath(import.meta.url)), '..')
const root = process.env.DSH2FORSION_ROOT
if (!root) { console.error('set DSH2FORSION_ROOT'); process.exit(2) }
const paths = layout(root)
if (!runtimeInstalled(paths)) { console.error(`runtime not installed under ${root}`); process.exit(2) }
const home = await mkdtemp(join(tmpdir(), 'dsh2forsion-baseline-'))
try {
  await ensureProfile(paths, home)
  await ensureBridge(paths, home, join(repo, 'src/dsh-bridge'))
  const sc = new Sidecar(paths, { home })
  await sc.start()
  const { tools } = await sc.bridge('/tools')
  const { sections } = await sc.bridge('/prompt')
  await sc.stop()
  const out = { dsh: DSH_VERSION, generatedAt: new Date().toISOString().slice(0, 10), tools: tools.map(t => t.name).sort(), sections: sections.map(s => s.name).sort() }
  await writeFile(join(repo, 'compat', `baseline-${DSH_VERSION}.json`), JSON.stringify(out, null, 1) + '\n')
  console.log(JSON.stringify(out))
} finally {
  await rm(home, { recursive: true, force: true })
}
