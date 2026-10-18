// 生成 compat/known.json：兼容矩阵实测过的「插件@版本」判级，以及「已验证豁免」清单
// （声明不支持当前 DSH、但实测装载通过的版本；用户装它们时自动套用 DSH 的精确豁免）。
// 来源：spike/m0/results/<日期>/*-results.json（以后的矩阵结果放同一形状即可）。
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DSH_VERSION } from '../src/engine/constants.mjs'
import { grade } from '../spike/m0/matrix/grade.mjs'

const repo = join(dirname(fileURLToPath(import.meta.url)), '..')
const resultsRoot = join(repo, 'spike/m0/results')
const plugins = {}
const exemptions = []
for (const day of (await readdir(resultsRoot)).sort()) {
  for (const f of (await readdir(join(resultsRoot, day))).filter(f => f.endsWith('-results.json'))) {
    const results = JSON.parse(await readFile(join(resultsRoot, day, f), 'utf8'))
    for (const r of Object.values(results)) {
      const g = grade(r)
      const key = `${r.name}@${r.version}`
      plugins[key] = { grade: g.grade, exemption: g.exemption, reason: g.reason || undefined, tools: (r.probe?.tools ?? []).length, checked: day }
      if (g.exemption && g.grade === 'load-ok' && !exemptions.includes(key)) exemptions.push(key)
    }
  }
}
const out = { dsh: DSH_VERSION, note: 'load-level evidence only (install + start + no activation errors); not a functional verification', plugins, exemptions: exemptions.sort() }
await writeFile(join(repo, 'compat', 'known.json'), JSON.stringify(out, null, 1) + '\n')
console.log(`${Object.keys(plugins).length} plugins, ${exemptions.length} verified exemptions: ${exemptions.join(', ')}`)
