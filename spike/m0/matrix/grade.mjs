// M0 矩阵判级：只看装载层面的证据，不推断功能。
//   red     装不上（含豁免后仍拒）/ sidecar 起不来 / 把 DSH 自己的条目拖成未激活（整个界面坏掉）
//   yellow  能起，但它自己的宿主条目或浏览器条目没激活，或者页面抛错
//   load-ok 以上都没有：装载通过（功能是否可用要到 M1 逐个做操作验收）
// 用法：node grade.mjs <results.json> [<results.json> …]
import { readFileSync } from 'node:fs'

const CORE_ENTRY = /^@deepseek-ai\/dsh-[\w-]+: (pending|import failed)/

export function grade(rec) {
  const st = rec.install?.status ?? ''
  const exemption = st === 'installed-with-exemption'
  if (!st.startsWith('installed')) return { grade: 'red', reason: `install:${st}`, exemption }
  const pr = rec.probe ?? {}
  if (pr.boot !== 'ready') {
    const why = (pr.logIssues ?? []).find(l => /SyntaxError|failed to import|startup failed/.test(l)) ?? 'no ready line'
    return { grade: 'red', reason: `boot:${why.trim().slice(0, 160)}`, exemption }
  }
  const ui = (pr.uiErrors ?? []).join('\n')
  // 只认「行首就是 DSH 核心包名」的未激活行；合包脚本 URL 里顺带出现的核心包名不算
  const pendingCore = ui.split('\n').map(l => l.trim()).filter(l => CORE_ENTRY.test(l))
  if (pendingCore.length > 0) return { grade: 'red', reason: `ui-break:${pendingCore.length} core client entries not activated`, exemption }
  const hostMiss = (pr.logIssues ?? []).filter(l => /did not activate|failed to import|has no create\(\) factory|Cannot find package/.test(l))
  const uiMiss = (pr.uiErrors ?? []).filter(l => /did not activate|pageerror|import failed/.test(l))
  if (hostMiss.length || uiMiss.length) {
    return { grade: 'yellow', reason: [...hostMiss, ...uiMiss].map(l => l.split('\n').slice(0, 2).join(' | ')).join(' ; ').slice(0, 240), exemption }
  }
  return { grade: 'load-ok', reason: '', exemption }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const file of process.argv.slice(2)) {
    const results = JSON.parse(readFileSync(file, 'utf8'))
    const rows = Object.values(results).sort((a, b) => a.rank - b.rank).map(r => ({ ...r, ...grade(r) }))
    const count = g => rows.filter(r => r.grade === g).length
    console.log(`## ${file}`)
    console.log(`n=${rows.length} load-ok=${count('load-ok')} yellow=${count('yellow')} red=${count('red')} exemption=${rows.filter(r => r.exemption).length}`)
    for (const r of rows) {
      const tools = (r.probe?.tools ?? []).length
      console.log(`| ${r.rank} | ${r.name}@${r.version} | ${r.category ?? '-'} | ${r.grade}${r.exemption ? ' (豁免)' : ''} | ${tools} | ${r.reason.replace(/\|/g, '/')} |`)
    }
  }
}
