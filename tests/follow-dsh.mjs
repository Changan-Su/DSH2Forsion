// 跟版通道（CI 每天跑，.github/workflows/follow-dsh.yml）：看上游发布标签 → 给那一版生成运行时锁 → 全新装一遍 →
// 起融合组合自检 → 出带校验值的运行时清单（runtime-manifest.json）。客户端只装清单里自检过的版本（src/engine/channel.mjs）。
//
//   node tests/follow-dsh.mjs pick                 打印 version=<上游最新> 与 newer=<true|false>（给 $GITHUB_OUTPUT）
//   node tests/follow-dsh.mjs check <版本> <输出目录>  生成锁、装、自检、写清单；自检不过退出码 1，清单照写（selfCheck.ok=false）
//
// 自检全部在输出目录下的全新目录里：HOME、DSH_HOME、XDG、TMPDIR 都指进去。启动令牌只在内存里，日志都先抹掉。
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = join(dirname(fileURLToPath(import.meta.url)), '..')
const [mode, versionArg, outArg] = process.argv.slice(2)
const { DSH_VERSION, NODE_VERSION, PNPM_VERSION } = await import('../src/engine/constants.mjs')
const { compareVersions, PLUGIN_VERSION } = await import('../src/engine/channel.mjs')
const sha = text => createHash('sha256').update(text).digest('hex')
// Tangu 的对话要用到的基础工具：融合组合里这些必须在（网页界面那份接线把它们关了，组合要重新打开）
const CORE_TOOLS = ['read', 'write', 'edit', 'glob', 'grep', 'bash', 'skill', 'todo_write', 'subagent']

if (mode === 'pick') {
  const tags = JSON.parse(execFileSync('npm', ['view', '@deepseek-ai/dsh', 'dist-tags', '--json', '--registry=https://registry.npmjs.org/'], { encoding: 'utf8' }))
  const newest = Object.values(tags).filter(v => /^\d+\.\d+\.\d+/.test(v)).sort(compareVersions).at(-1)
  console.log(`version=${newest}`)
  console.log(`newer=${compareVersions(newest, DSH_VERSION) > 0}`)
  process.exit(0)
}
if (mode !== 'check' || !versionArg || !outArg) { console.error('usage: follow-dsh.mjs pick | check <version> <out-dir>'); process.exit(2) }

const version = versionArg
const out = resolve(outArg)
const work = join(out, 'work')
for (const d of ['lock', 'data', 'home', 'dsh', 'xc', 'xd', 'xs', 'tmp', 'ws']) await mkdir(join(work, d), { recursive: true })
Object.assign(process.env, {
  HOME: join(work, 'home'), DSH_HOME: join(work, 'dsh'), XDG_CACHE_HOME: join(work, 'xc'), XDG_DATA_HOME: join(work, 'xd'),
  XDG_STATE_HOME: join(work, 'xs'), TMPDIR: join(work, 'tmp'), DSH_TELEMETRY_DISABLED: '1', USERPROFILE: join(work, 'home'),
})
const { layout, resolveDshHome } = await import('../src/engine/layout.mjs')
assert.ok(resolveDshHome(process.env).startsWith(work), 'DSH_HOME must point into the work folder')
const { installRuntime } = await import('../src/engine/runtime.mjs')
const { ensureFusedProfile } = await import('../src/engine/fusion.mjs')
const { ensureBridge } = await import('../src/engine/profile.mjs')
const { Sidecar } = await import('../src/engine/sidecar.mjs')

const step = (s) => console.log(`[follow-dsh] ${s}`)
const self = { ok: false, at: new Date().toISOString(), plugin: PLUGIN_VERSION, steps: [] }
const note = (name, ok, detail = '') => { self.steps.push({ name, ok, detail: String(detail).slice(0, 400) }); step(`${ok ? 'ok ' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`) }

// 1. 锁：只从官方源解析，和随包那份同样的形状
const packageJson = JSON.stringify({ name: 'dsh2forsion-runtime', private: true, dependencies: { '@deepseek-ai/dsh': version, pnpm: PNPM_VERSION } })
await writeFile(join(work, 'lock', 'package.json'), packageJson)
execFileSync('npm', ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund', '--registry=https://registry.npmjs.org/'], { cwd: join(work, 'lock'), stdio: 'inherit' })
const lock = await readFile(join(work, 'lock', 'package-lock.json'), 'utf8')
assert.ok(!/"resolved": "https?:\/\/(?!registry\.npmjs\.org\/)/.test(lock), 'every package resolves from the official registry')
note('lock', true, `${(lock.match(/"resolved"/g) ?? []).length} packages`)

let sidecar = null
try {
  // 2. 全新装一遍（和客户端走同一段代码：Node 校验和、npm ci 用锁、只给三个原生包跑构建）
  const paths = layout(join(work, 'data'), process.platform, { dshHome: join(work, 'dsh'), dshVersion: version })
  await installRuntime(paths, { source: 'official', log: () => {}, files: { packageJson, lock } })
  note('install', true)
  // 3. 融合组合 + 桥，起进程
  await ensureFusedProfile(paths)
  await ensureBridge(paths, paths.home, join(repo, 'plugin/tangu-plugins/dsh2forsion/dsh-bridge'))
  sidecar = new Sidecar(paths, { cwd: join(work, 'ws') })
  await sidecar.start()
  note('start', true, `ready in ${sidecar.readyMs} ms`)
  // 4. 桥在、装插件闸拦上了、基础工具都在
  const check = await sidecar.bridge('/fusion/check')
  note('bridge', check.ok === true, `bridge ${check.bridge}`)
  note('install review gate', check.gate === true, check.gateReason)
  const missing = CORE_TOOLS.filter(t => !check.tools.includes(t))
  note('core tools', missing.length === 0, missing.length ? `missing ${missing.join(', ')}` : `${check.tools.length} tools`)
  self.tools = check.tools
  // 审批接管的自检(依赖的 DSH 内部结构 1–3,清单见 MAPPING):只记不判 —— 对不上时插件整体退回「在工作台里等你批准」,
  // 不是不能用,不拦这一版上通道;清单里留着,升级时一眼看得出这一版接不接得了审批。4、5 两条要真跑一轮,在 npm run test:approvals
  self.approvals = check.approvals ? { mode: check.approvals.mode, reason: check.approvals.reason ?? null } : { mode: 'unknown', reason: 'bridge did not report approvals' }
  console.log(`approvals: ${self.approvals.mode}${self.approvals.reason ? ` (${self.approvals.reason})` : ''}`)
  // 5. 对话入口：ACP 握手 + 建会话；网页界面认得那场会话
  const conn = sidecar.connection()
  let buf = ''
  const waiters = new Map()
  conn.output.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1); if (m.id != null && waiters.has(m.id)) { waiters.get(m.id)(m); waiters.delete(m.id) } } })
  let id = 0
  const acp = (method, params) => new Promise((res, rej) => { const my = ++id; const t = setTimeout(() => rej(new Error(`${method} timed out`)), 60_000); waiters.set(my, m => { clearTimeout(t); m.error ? rej(new Error(m.error.message)) : res(m.result) }); conn.input.write(JSON.stringify({ jsonrpc: '2.0', id: my, method, params }) + '\n') })
  const init = await acp('initialize', { protocolVersion: 1, clientCapabilities: {} })
  note('acp initialize', init?.protocolVersion === 1)
  const { sessionId } = await acp('session/new', { cwd: join(work, 'ws'), mcpServers: [] })
  note('acp session', Boolean(sessionId))
  const state = await sidecar.rpc('session/state', { request: { sessionId } }).then(() => true, e => e.message)
  note('web interface sees the session', state === true, state === true ? '' : state)
  self.ok = self.steps.every(s => s.ok)
} catch (error) {
  note('self-check', false, error.message)
} finally {
  await sidecar?.stop(2000)
}

// 6. 清单（自检不过也写：ok=false 的清单客户端不认，留着看哪一步坏了）
const manifest = { schema: 1, dsh: version, node: NODE_VERSION, pnpm: PNPM_VERSION, plugin: { min: PLUGIN_VERSION }, files: { packageJson, lock }, sha256: { packageJson: sha(packageJson), lock: sha(lock) }, selfCheck: self }
await writeFile(join(out, 'runtime-manifest.json'), JSON.stringify(manifest) + '\n')
await writeFile(join(out, 'runtime-manifest.json.sha256'), `${sha(JSON.stringify(manifest) + '\n')}  runtime-manifest.json\n`)
step(`manifest for DSH ${version}: self-check ${self.ok ? 'passed' : 'FAILED'}`)
process.exitCode = self.ok ? 0 : 1
