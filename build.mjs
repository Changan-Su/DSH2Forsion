// 产出可安装的 Forsion 插件包 plugin/（提交进仓库；CI 重建后 git diff 必须为空）。
// `node build.mjs <dir>` 输出到别处（check-build 用它比对 plugin/ 是不是最新）。
//   plugin/manifest.json · main.js · icon.svg · spaces/dsh/
//   plugin/tangu-plugins/dsh2forsion/{tangu-plugin.json, package.json, dist/index.js, dsh-bridge/, compat/}
import { build } from 'esbuild'
import { cp, mkdir, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const out = process.argv[2] ? resolve(process.argv[2]) : join(root, 'plugin')
const engineOut = join(out, 'tangu-plugins', 'dsh2forsion')

await rm(out, { recursive: true, force: true })
await mkdir(engineOut, { recursive: true })
for (const f of ['manifest.json', 'icon.svg']) await cp(join(root, 'src/static', f), join(out, f))
await cp(join(root, 'src/static/spaces'), join(out, 'spaces'), { recursive: true })
await cp(join(root, 'src/static/icon.svg'), join(out, 'spaces/dsh/icon.svg'))
await cp(join(root, 'src/renderer/main.js'), join(out, 'main.js'))
await cp(join(root, 'src/static/tangu-plugin'), engineOut, { recursive: true })
await cp(join(root, 'src/dsh-bridge'), join(engineOut, 'dsh-bridge'), { recursive: true })
await mkdir(join(engineOut, 'runtime'), { recursive: true })
for (const f of ['package.json', 'package-lock.json']) await cp(join(root, 'src/runtime', f), join(engineOut, 'runtime', f))
await cp(join(root, 'compat'), join(engineOut, 'compat'), { recursive: true, filter: src => !src.endsWith('.md') })
await build({
  entryPoints: [join(root, 'src/engine/index.mjs')],
  outfile: join(engineOut, 'dist/index.js'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  legalComments: 'none',
  banner: { js: '// DSH2Forsion engine half (built from src/engine by build.mjs; do not edit)' },
  logLevel: 'warning',
})
console.log(`built ${out}`)
