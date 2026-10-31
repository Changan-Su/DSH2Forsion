// Local acceptance report: evidence-driven counts and separate screenshot files.
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs'
import { dirname, resolve, relative, extname, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const day = resolve(repo, '../harness-runs/2026-10-31')
const output = resolve(process.argv[2] || `${day}/DSH2Forsion-测试报告.html`)
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const json = file => JSON.parse(readFileSync(file, 'utf8'))
const deliveryFile = resolve(day, 'DSH2Forsion-delivery.json')
const delivery = existsSync(deliveryFile) ? json(deliveryFile) : {}
if (delivery.version !== undefined && delivery.version !== 1) throw Error('Unsupported delivery snapshot version')
const stateNames = { unknown: '未记录', draft: 'Draft', open: '开放', merged: '已合入', closed: '已关闭', passed: '通过', failed: '失败', pending: '待完成', running: '运行中', development: '开发构建 · 未发布', released: '已发布' }
const stateName = value => stateNames[value] || '未记录'
const remote = (url, title) => typeof url === 'string' && /^https:\/\//.test(url) ? `<a href="${esc(url)}">${esc(title)}</a>` : `${esc(title)}（链接未记录）`
const commit = value => value ? `<code>${esc(value)}</code>` : '未记录'
const ci = value => value ? `${remote(value.url, 'CI')}：${esc(stateName(value.state))}${value.jobs?.length ? `（${value.jobs.map(j => `${esc(j.name)} ${esc(stateName(j.state))}`).join('；')}）` : ''}` : 'CI：未记录'
const publication = stateName(delivery.publication?.state)
const codeStatus = `<p>${remote(delivery.host?.prUrl, 'Tangu 宿主 PR')} · ${esc(stateName(delivery.host?.prState))} · 提交 ${commit(delivery.host?.commit)}</p><p>${remote(delivery.dsh?.prUrl, 'DSH2Forsion PR')} · ${esc(stateName(delivery.dsh?.prState))} · 源码提交 ${commit(delivery.dsh?.sourceCommit)} · 当前提交 ${commit(delivery.dsh?.commit)}</p><p>${ci(delivery.dsh?.ci)}</p><p>Windows sidecar：${esc(stateName(delivery.checks?.windowsSidecar?.state))}${Number.isInteger(delivery.checks?.windowsSidecar?.passed) ? `，已通过 ${delivery.checks.windowsSidecar.passed} 项` : ''}${delivery.checks?.windowsSidecar?.note ? `；${esc(delivery.checks.windowsSidecar.note)}` : ''}</p><p>发布状态：${esc(publication)}${delivery.publication?.note ? `；${esc(delivery.publication.note)}` : ''}。快照时间：${esc(delivery.updatedAt || '未记录')}。${existsSync(deliveryFile) ? aDelivery() : '本地交付状态文件缺省，未知字段不会推断为通过。'}</p>`
function aDelivery() { return `<a href="${encodeURI(relative(dirname(output), deliveryFile).replaceAll('\\', '/'))}">交付状态原始 JSON</a>` }
const link = file => encodeURI(relative(dirname(output), resolve(day, file)).replaceAll('\\', '/')).replaceAll('#', '%23').replaceAll('?', '%3F')
const a = (file, title) => `<a href="${link(file)}">${esc(title)}</a>`
const runs = readdirSync(day).flatMap(id => {
  if (!existsSync(resolve(day, id, 'raw/results.json')) || !existsSync(resolve(day, id, 'meta.json'))) return []
  const data = json(resolve(day, id, 'raw/results.json')), meta = json(resolve(day, id, 'meta.json')), rows = data.results || []
  return [{ id, data, meta, rows, passed: rows.filter(r => r.ok === true && !r.skipped).length, total: rows.filter(r => !r.skipped).length }]
}).sort((x, y) => String(x.meta.startedAt).localeCompare(String(y.meta.startedAt)))
const get = id => { const r = runs.find(r => r.id === id); if (!r) throw Error(`Missing archive: ${id}`); return r }
const latest = category => runs.filter(r => r.data.evidenceCategory === category).at(-1)
const skills = get('172958-dshnative'), runtime = get('172220-dshsidecar'), baseline = get('165233-dshfull'), failed = get('171911-dshnative')
const models = latest('native-models'), scopes = latest('session-scope'), browser = latest('native-webui-browser')
const electron = latest('native-electron'), billion = latest('billion-context')
const prechecks = latest('native-electron-prechecks')
const mcp = latest('mcp-stdio')
const currentRuntime = latest('current-runtime')
const billionDiagnostics = runs.filter(r => r.data.evidenceCategory === 'billion-context-diagnostic')
const electronDiagnostics = runs.filter(r => r.data.evidenceCategory === 'native-electron-diagnostics')
const audited = [electron, skills, models, scopes, mcp, billion, currentRuntime || runtime].filter(Boolean)
const score = r => r ? `${r.passed} / ${r.total}` : '等待证据'
const passed = r => r && r.total > 0 && r.passed === r.total && !r.rows.some(x => x.skipped)
const docs = r => `${a(`${r.id}/报告.md`, '逐项报告')} · ${a(`${r.id}/raw/results.json`, '结构化结果')} · ${a(`${r.id}/meta.json`, '版本与边界')}${existsSync(resolve(day, r.id, 'raw/run-evidence/original-results.json')) ? ` · ${a(`${r.id}/raw/run-evidence/original-results.json`, '未归一化原始结果')}` : ''}`
const tags = { 'real-model': '真实模型', 'deterministic-protocol': '确定性协议', 'real-runtime': '真实 DSH / 无模型', 'real-browser': '真实浏览器 / 无模型', 'real-electron': '真实 Electron' }
function figure(run, shot) {
  if (!shot || typeof shot.file !== 'string' || !['.png', '.jpg', '.jpeg', '.webp'].includes(extname(shot.file).toLowerCase())) throw Error('Invalid screenshot descriptor')
  const base = resolve(day, run.id, 'raw'), source = resolve(base, shot.file)
  if (!source.startsWith(base + sep) || !existsSync(source)) throw Error(`Screenshot missing or outside archive: ${shot.file}`)
  const path = relative(day, source)
  return `<figure><a href="${link(path)}" target="_blank" rel="noopener"><img src="${link(path)}" alt="${esc(shot.title || shot.file)}" loading="lazy"></a><figcaption><strong>${esc(shot.title || shot.file)}</strong><span>${esc(shot.caption)}</span><small>${esc(run.meta.startedAt)} · ${esc(shot.file)}</small></figcaption></figure>`
}
const nativeImages = electron?.data.screenshots || [], browserImages = browser?.data.screenshots || []
const historicalImages = [
  ['popular-01-task-review.png', '历史基线：任务详情', '上轮 DSH 整页嵌入载具，不计为原生 Forsion 面板验收。'],
  ['popular-02-skill-checklist.png', '历史基线：技能正文', '第三方原始页面与落盘内容；Tangu 原生消费另有独立模型证据。'],
  ['popular-03-git-history.png', '历史基线：Git 项目提交', '保留原始 Git 页面；不以旧图替代新增能力的验收。'],
  ['popular-04-git-branch.png', '历史基线：检查分支', '真实 Electron 的旧整页嵌入载具。'],
].map(([file, title, caption]) => figure(baseline, { file: `gui-evidence/${file}`, title, caption })).join('')
const cards = [
  ['原生 Electron', score(electron), electron ? '以本轮真实操作、断言与截图为准' : '等待三面板、审批、历史与取消证据'],
  ['Tangu 原生技能', score(skills), '保留当时宿主 SHA，不冒充最新构建'],
  ['DSH 模型源', models ? `${models.data.realModelScenarios} 个真实场景` : '等待证据', models ? `${models.data.liveModelCalls} 次真实 Luna 推理；确定性协议另计` : '模型与协议分开计数'],
].map(([title, value, note]) => `<article class="card"><h3>${esc(title)}</h3><div class="score">${esc(value)}</div><small>${esc(note)}</small></article>`).join('')
const row = (title, result, boundary, run) => `<tr><td>${esc(title)}</td><td>${esc(result)}</td><td>${esc(boundary)}${run ? `<br>${docs(run)}` : ''}</td></tr>`
const ledger = [
  row('原生 Electron · Task Board / Skills Manager / Git Graph', score(electron), electron ? '逐项区分模型、界面操作与生命周期检查。' : '尚未归档；浏览器启动截图不能替代 Electron 操作验收。', electron),
  row('原生技能真模型', score(skills), '此前宿主 2a1c09b02 上四项通过：创建、原生 use_skill、同名隔离与来源生命周期。', skills),
  row('DSH 模型源 · 真实 Luna', models ? `${models.data.realModelScenarios} 场景 / ${models.data.liveModelCalls} calls` : '等待证据', '模型提出工具调用 → Tangu 审批与执行 → 模型完成回答，一场景两次真实推理。', models),
  row('DSH 模型源 · 确定性协议', models ? `${models.rows.filter(r => r.verificationKind === 'deterministic-protocol' && r.ok).length} / ${models.rows.filter(r => r.verificationKind === 'deterministic-protocol').length}` : '等待证据', '会话归属、取消和来源停用使用协议夹具；不计真实模型场景或调用。', models),
  row('会话归属 · 真实 DSH', score(scopes), '首次、重载、跨进程恢复与停用；消费者是确定性夹具，0 次模型调用。', scopes),
  row('官方 MCP stdio client', mcp ? '1 个集成组通过' : '等待日志', '真实 stdio 子进程与官方 client，自有夹具；无外部账号和模型调用，不虚构内部断言数量。', mcp),
  row('Billion Context', billion ? `${score(billion)} · ${billion.data.liveModelCalls} calls` : score(billion), billion?.data.boundary || '等待专用证据；标准 single inference 不证明完整上下文压缩兼容。', billion),
  row('原 Task Board · 浏览器 slot 启动', score(browser), '真实浏览器与 Tangu / DSH；仅验原看板与专用 root，无任务执行或模型调用。', browser),
  row('Windows 当前真实运行时', score(currentRuntime), '当前产品完整 sidecar 验证，含启动中停用、孤儿退出、最终清理；旧断言假设日志仅作诊断，不列为产品失败。', currentRuntime),
  row('Windows 运行时历史基线', score(runtime), '既有进程与磁盘验证，独立于新增原生面板验收。', runtime),
  row('Ubuntu 全新安装 CI', '16 / 16（既有记录）', '从零下载安装；不计入本轮真模型或 GUI 场景。'),
  row('热门插件 Electron 历史基线', score(baseline), '旧 DSH 整页嵌入载具，仅作历史对照。', baseline),
].join('')
const details = audited.map(run => `<details><summary>${esc(run.meta.label)} · ${score(run)}</summary><p>${esc(run.meta.notes)}</p><p>${docs(run)}</p><div class="scroll"><table><thead><tr><th>场景</th><th>结果 / 类型</th><th>实际判据</th></tr></thead><tbody>${run.rows.map(r => `<tr><td>${esc(r.name || r.key)}</td><td>${r.skipped ? '未执行' : r.ok === true ? '通过' : '失败'}<br><small>${esc(tags[r.verificationKind] || '见原始报告边界')}</small></td><td>${esc(r.detail || '')}</td></tr>`).join('')}</tbody></table></div></details>`).join('')
const trace = json(resolve(day, skills.id, 'raw/native-use-evidence.json'))
const diagnostics = [prechecks, ...electronDiagnostics, ...billionDiagnostics].filter(Boolean).map(r => `<details><summary>${esc(r.meta.label)} · ${score(r)}</summary><p>${esc(r.meta.notes)}</p><p>${docs(r)}</p>${r.data.screenshots?.length ? `<div class="gallery">${r.data.screenshots.map(s => figure(r, s)).join('')}</div>` : ''}</details>`).join('')
const compression = billion?.data.compressionEvidence
const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>DSH2Forsion · 原生兼容验收报告</title>
<style>
:root{color-scheme:light;--ink:#172439;--muted:#607084;--line:#dce3eb;--blue:#255cc4;--paper:#f3f5f8}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:15px/1.7 system-ui,"Microsoft YaHei",sans-serif}a{color:var(--blue);text-underline-offset:3px}main{max-width:1280px;margin:auto;padding:48px 28px 80px}header{padding:24px 0 30px;border-bottom:1px solid var(--line)}.eyebrow{font-size:12px;letter-spacing:.16em;color:var(--muted)}h1{font-size:clamp(30px,5vw,49px);line-height:1.2;margin:12px 0 18px;letter-spacing:-.03em}h2{font-size:25px;margin:36px 0 15px}h3{font-size:17px;margin:0 0 8px}.lead{max-width:950px;font-size:18px}.muted,small{color:var(--muted)}.pill{display:inline-block;padding:3px 10px;border-radius:20px;font-size:12px;background:#e5edf9;color:var(--blue)}.cards{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin:26px 0}.card,.panel{background:white;border:1px solid var(--line);border-radius:14px;padding:22px}.score{font-size:32px;line-height:1.3;font-weight:700;color:#176d52}.card small{display:block}table{border-collapse:collapse;width:100%;background:white}th,td{text-align:left;padding:12px 16px;border-bottom:1px solid var(--line);vertical-align:top}th{background:#eaf0f7;font-size:13px}td:nth-child(2){min-width:100px}code{font-size:13px;overflow-wrap:anywhere}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#edf2f8;padding:18px;border-radius:10px}.gallery{display:grid;grid-template-columns:1fr 1fr;gap:22px}figure{margin:0;background:white;border:1px solid var(--line);border-radius:14px;overflow:hidden}figure img{display:block;width:100%;height:auto;border-bottom:1px solid var(--line)}figcaption{padding:18px}figcaption span,figcaption small{display:block;margin-top:7px}details{margin:16px 0;background:white;border:1px solid var(--line);border-radius:12px;padding:16px 20px}summary{cursor:pointer;font-weight:650}li{margin:8px 0}.chain{font-size:18px;line-height:2;color:var(--blue)}footer{margin-top:36px;padding-top:20px;border-top:1px solid var(--line);color:var(--muted);font-size:13px}.scroll{overflow:auto}@media(max-width:760px){main{padding:24px 16px}.cards,.gallery{grid-template-columns:1fr}td,th{padding:10px}.lead{font-size:16px}}@media print{body{background:white}main{padding:0}.gallery{grid-template-columns:1fr}figure,.card{break-inside:avoid}a{color:inherit}}
</style><main><header><div class="eyebrow">ENGINEERING ACCEPTANCE · 2026 / 10 / 31</div><h1>DSH Agent 内容供 Tangu 使用<br>原始插件界面进入 Forsion</h1><p class="lead">原生技能、工具与模型来源消费 DSH Agent 能力；第三方原始 WebUI 经公开 slot 挂入独立 Forsion View，看板任务交给 Tangu 执行、审批并保留历史。每项结论都链接到对应运行，模型、协议和界面检查分别计数。</p><span class="pill">${esc(publication)}</span> <span class="pill">${passed(electron) ? '原生 Electron 已归档' : '原生 Electron 验收进行中'}</span></header>
<div class="cards">${cards}</div>
<section><h2>本轮真实原生桌面截图</h2><p class="muted">点击查看独立原图。主图区为真实 Electron 截图，旧基线另行保留。${electron ? electron.data.composite ? esc(electron.data.taskEvidenceNote) : `最终轮新建 ${esc(electron.data.liveTasks ?? '未记录')} 个任务，复核 ${esc(electron.data.reusedTasks ?? '未记录')} 个既有成功任务；任务数不等同模型调用次数。` : ''}</p>${nativeImages.length ? `<div class="gallery">${nativeImages.map(s => figure(electron, s)).join('')}</div>` : '<div class="panel">真实 Electron 台架仍在运行，三面板 / 审批 / 历史截图尚未归档。不以旧的整页嵌入截图替代。</div>'}</section>
<section><h2>验收账本：按证据类型分开</h2><div class="scroll"><table><thead><tr><th>验证范围</th><th>结果</th><th>边界与原始证据</th></tr></thead><tbody>${ledger}</tbody></table></div></section>
<section><h2>原生技能如何被 Tangu 真正使用</h2><div class="panel"><div class="chain">Skills Manager 创建 → Tangu 原生技能列表 → 新会话 use_skill → 来源停用与恢复</div><p>此前新会话提示词只有技能 ID，没有正文中的随机标记；测试只允许原生 <code>use_skill</code>。模型实际读取后返回：</p><pre>${esc(trace.content)}</pre><p>${a(`${skills.id}/raw/native-use-evidence.json`, '完整事件与工具结果')} · ${a(`${skills.id}/raw/native-skill-evidence.json`, '技能正文与来源归属')}</p><p class="muted">本组证据来自宿主 2a1c09b02 开发构建，与后续合入提交分开标记。</p></div></section>
${browser ? `<details><summary>浏览器载具先行证据 · 非 Electron 操作验收</summary><p>${docs(browser)}</p><div class="gallery">${browserImages.map(s => figure(browser, s)).join('')}</div></details>` : ''}
<section><h2>逐场景原始证据</h2>${details}</section>
${compression ? `<section><h2>Billion Context：限定范围内的真实压缩</h2><div class="panel"><p>原 <code>billion-context@0.1.201</code> 自动 preflight 压缩 1 个 range，启用 <code>${esc(compression.activeBlock)}</code> / tier ${esc(compression.tier)}。本地估算 ${esc(compression.localEstimatedBefore)} → ${esc(compression.localEstimatedAfter)} tokens；最终有效请求 ${esc(compression.finalBodyCharacters)} 字符，已去掉 ${esc(compression.discardedBriefingCharacters)} 字符的原 briefing。真实 Luna 仍召回：</p><pre>${esc(compression.answer)}</pre><p>最终场景两次真实上游请求（summary + recall），回答 usage ${esc(compression.usage.prompt_tokens)} in / ${esc(compression.usage.completion_tokens)} out。本轮连同原始基线与预算失败总计 ${esc(billion.data.campaignActualModelCalls)} 次，失败另列。</p><p class="muted">${esc(billion.data.boundary)} 总结请求包含独立提示词，不以其 17744 字符与最终请求相除来声称压缩率。</p></div></section>` : ''}
<section><h2>兼容边界</h2><div class="panel"><ul><li>仅对描述器明确钉定并通过版本 / 哈希守卫的第三方面板作出结论，不泛化到所有 npm 插件。</li><li>Task Board 保留第三方原始 UI 与存储；执行、取消、会话导航和恢复通过已登记的 Tangu 映射完成。DSH 会话不能冒充可恢复的 Tangu 会话。</li><li>标准模型桥只做一次推理，工具由 Tangu 循环执行。缺少 usage 时失败，不伪造 token 数；未声明思考档位时保留模型来源默认值。</li><li>标准会话归属不等于复制 Tangu 完整历史。Billion Context 压缩能力以专用验证为准。</li><li>只归档显式选定文件，不复制隔离 home、配置或凭据。图片是本机独立文件，无 base64 内嵌。</li></ul></div></section>
<section><h2>历史基线与失败均保留</h2>${diagnostics}<details><summary>热门插件旧 Electron 基线 · ${score(baseline)} · 整页嵌入载具</summary><p>${docs(baseline)}</p><div class="gallery">${historicalImages}</div></details><details><summary>技能发现修复前 · ${score(failed)}，后续未执行</summary><p>DSH Web 模式未挂全局文件技能来源，模型创建成功但技能未进入原生列表。后续桥接仅限隔离目录的官方文件来源，保留失败与中间诊断。</p><p>${docs(failed)} · ${a('170850-dshnative_discovery-base/报告.md', '五次中间诊断')}</p></details></section>
<section><h2>代码状态与复跑</h2><div class="panel">${codeStatus}<p>合入 / 发布状态与测试产物分别记录：每组实际被测代码见 <code>meta.json</code> 和原始结果，不把后来提交倒推为旧运行的 SHA。</p><p>历史桥 <code>e1228f1</code> 的 <a href="https://github.com/Changan-Su/DSH2Forsion/pull/3">PR #3</a> 与 <a href="https://github.com/Changan-Su/DSH2Forsion/actions/runs/41224467167">CI 记录</a> 保留。复跑：<code>node tests/report-html.mjs</code>。</p><p>${a('DSH2Forsion-原生技能兼容与测试汇总.md', '旧原生技能汇总')} · ${a('DSH2Forsion-热门插件与愿景校正.md', '热门插件版本与历史测试')}</p></div></section>
<p>${a('DSH2Forsion-报告复现.md', '本地报告与真机台架复现要求')}</p><footer>生成器：DSH2Forsion/tests/report-html.mjs · ${esc(new Date().toISOString())} · 不把不同层级检查数相加为“真模型通过数”。</footer></main></html>`
mkdirSync(dirname(output), { recursive: true })
writeFileSync(output, html)
console.log(JSON.stringify({ output, archives: audited.map(r => r.id), nativeScreenshots: nativeImages.length, browserScreenshots: browserImages.length, realModelCalls: models?.data.liveModelCalls ?? null }))
