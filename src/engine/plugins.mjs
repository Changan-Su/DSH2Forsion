// DSH 插件管理：装前体检、核心包夹带扫描、改前快照、一键回滚。
// 第 1 档起装插件的入口是工作台里 DSH 自己的插件页：桥把那次安装停住，这里在临时 DSH_HOME 里整套装一遍、起两次
// （装前 / 装后），报告给用户，用户点头才放行（M0 随机样本里 30 个有 2 个会拖垮整个 sidecar 或界面）。
// 只写自己那份组合；用户 DSH 目录顶层的 cordis.patch.yml 只读。
import { existsSync } from 'node:fs'
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { FUSION_MARKER, PROFILE } from './constants.mjs'
import { LAST_GOOD, copyProfileFiles, copyProfileTo, dsh, newestBackup, profileDir, shadowedCorePackages, userPlugins } from './profile.mjs'
import { tail } from './proc.mjs'
import { Sidecar } from './sidecar.mjs'

const NPM_NAME = /^(@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*$/i
const HOME_FILE = 'dsh-home.txt'
const NOT_OURS = `The DSH profile "${PROFILE}" was not created by DSH2Forsion, so DSH2Forsion leaves it alone.`
const UNDONE_PREFIX = 'undone-'
const UNDONE_KEEP = 5

/** 回滚换下来的那几份只留最近 UNDONE_KEEP 份。 */
async function pruneUndone(backupsDir) {
  let entries = []
  try { entries = (await readdir(backupsDir)).filter(e => e.startsWith(UNDONE_PREFIX)).sort() } catch { return }
  for (const e of entries.slice(0, Math.max(0, entries.length - UNDONE_KEEP))) await rm(join(backupsDir, e), { recursive: true, force: true })
}

/** `name@1.2.3` / `@scope/name@^1` / `name` → 包名；`file:` 规格读它的 package.json。 */
export async function specName(spec) {
  if (typeof spec !== 'string' || !spec.trim()) throw new Error('empty plugin spec')
  const s = spec.trim()
  if (s.startsWith('file:')) {
    const pkg = JSON.parse(await readFile(join(s.slice(5), 'package.json'), 'utf8'))
    return pkg.name
  }
  const at = s.lastIndexOf('@')
  const name = at > 0 ? s.slice(0, at) : s
  if (!NPM_NAME.test(name)) throw new Error(`not an npm package spec: ${spec}`)
  return name
}

const VERSION_REFUSED = /allow-version|Exact-version exemption/i
const BROKEN = /startup failed|failed to import|SyntaxError|Cannot find package|has no create\(\) factory/i
const INACTIVE = /did not activate|waiting for service/i

/**
 * 试启动判定（纯函数，单测覆盖）。
 * blocked：夹带核心包，或者 sidecar 起不来 —— 装上会让 DSH Space 整个打不开。
 * partial：能起，但有条目没激活 —— 多半是插件跟不上 DSH 接口，功能可能缺一块。
 * graded：兼容矩阵对这个确切版本的评级。试启动只看得到宿主侧，只坏浏览器侧的（M0 随机样本 #128，
 * 起得来但 DSH 网页停在「Failed to load plugins」）要靠矩阵记下的评级拦。
 */
export function judgeTrial({ ready, lines, shadowed, pluginName, graded = null }) {
  const judged = judgeStart({ ready, lines, shadowed, pluginName })
  const note = graded?.reason ? `compatibility matrix (${graded.checked ?? 'M0'}): ${graded.reason}` : null
  if (graded?.grade === 'red' && judged.verdict !== 'blocked') return { verdict: 'blocked', reasons: [note ?? 'compatibility matrix: does not work with this DSH version', ...judged.reasons] }
  if (graded?.grade === 'yellow' && judged.verdict === 'ok') return { verdict: 'partial', reasons: [note ?? 'compatibility matrix: partly works'] }
  return judged
}

function judgeStart({ ready, lines, shadowed, pluginName }) {
  const reasons = []
  if (shadowed.length) reasons.push(...shadowed.map(s => `bundles ${s.name}@${s.version}, which overrides the runtime's ${s.runtime}`))
  if (!ready) {
    const why = lines.filter(l => BROKEN.test(l)).slice(0, 6)
    reasons.push(...(why.length ? why : ['DSH did not start']))
    return { verdict: 'blocked', reasons }
  }
  if (shadowed.length) return { verdict: 'blocked', reasons }
  const inactive = lines.filter(l => INACTIVE.test(l) || BROKEN.test(l))
  // DSH 先打一行「N entries did not activate」，明细行是「<条目> (<包名>): <错误>」，不一定带上面的关键词
  const mine = lines.filter(l => l.includes(pluginName) && /error|fail|not a function|cannot|missing|pending|waiting|did not activate/i.test(l))
  if (inactive.length || mine.length) return { verdict: 'partial', reasons: (mine.length ? mine : inactive).slice(0, 6) }
  return { verdict: 'ok', reasons: [] }
}

/**
 * pnpm 在 node_modules/.modules.yaml（JSON 写法）里记的「装上了、构建脚本没跑」的包（`name@version`）。体检带 --ignore-scripts，
 * 要跑构建脚本的依赖都会记在这里。还没装过任何插件的组合没有这个文件 → 空；读不懂或读出错 → null（不知道，不当没有）。
 */
export async function pendingBuilds(home) {
  let text
  try { text = await readFile(join(profileDir(home), 'node_modules', '.modules.yaml'), 'utf8') }
  catch (error) { return error?.code === 'ENOENT' ? [] : null }
  try {
    const m = JSON.parse(text)
    return Array.isArray(m?.pendingBuilds) ? m.pendingBuilds.filter(x => typeof x === 'string') : []
  } catch { return null }
}

/**
 * 组合 pnpm-workspace.yaml 里 allowBuilds 已经定下的键 → true（跑）/ false（不跑）。DSH 替用户记下的「待定」占位不算定了。
 * 只认块写法的一层映射；没有这一节 → 空；有但读不懂（流式写法、带冒号的键……）→ null（不知道）。
 */
export function allowBuildsDecisions(text) {
  const out = new Map()
  const lines = String(text ?? '').split(/\r?\n/)
  const at = lines.findIndex(l => /^allowBuilds:/.test(l))
  if (at < 0) return out
  if (!/^allowBuilds:\s*(#.*)?$/.test(lines[at])) return null
  for (const l of lines.slice(at + 1)) {
    if (!l.trim() || /^\s*#/.test(l)) continue
    if (!/^\s/.test(l)) break
    const m = /^\s+(?:'([^']*)'|"([^"]*)"|([^\s:#'"][^:#]*?))\s*:\s*(true|false|'[^']*'|"[^"]*"|[^#:]*?)\s*(?:#.*)?$/.exec(l)
    if (!m) return null
    const key = m[1] ?? m[2] ?? m[3]
    if (m[4] === 'true') out.set(key, true)
    else if (m[4] === 'false') out.set(key, false)
  }
  return out
}

/** pnpm 记的依赖路径可能带同伴依赖后缀（`@swc/core@1.15.2(@swc/helpers@0.5.15)`）：去掉后缀，只留 `name@version`。 */
export function buildDepPath(entry) {
  const i = entry.indexOf('(')
  return i > 0 ? entry.slice(0, i) : entry
}

/** allowBuilds 的键（`name` / `name@1.2.3` / `name@1.2.3 || 1.2.4`）管不管得到 pnpm 记的那一个依赖。 */
export function buildKeyCovers(key, entry) {
  const dep = buildDepPath(entry)
  const at = dep.lastIndexOf('@')
  const name = at > 0 ? dep.slice(0, at) : dep
  const version = at > 0 ? dep.slice(at + 1) : ''
  if (key === dep || key === name) return true
  if (!key.startsWith(`${name}@`)) return false
  return key.slice(name.length + 1).split('||').map(v => v.trim()).includes(version)
}

/**
 * 这个插件带进来的、要跑构建脚本的包各自会怎样（纯函数，单测覆盖）。多条规则管到同一个包时照 pnpm：明写不跑的优先。
 * skipped —— 组合里有一条写了不跑（这次在 DSH 里允许了也一样）；
 * approved —— 这次安装是 DSH 插件页「允许这些脚本并重试」发起的，用户刚允许了；
 * allowed —— 组合里之前已经允许过；
 * needs —— 没人定过：DSH 不跑没允许过的构建脚本，真装的时候 pnpm 会报错，这次装不上；
 * unknown —— 组合设置读不懂，判断不了（读不懂时也不知道有没有写不跑的，所以这次允许的也算 unknown）。
 * 体检本身一律不跑构建脚本（--ignore-scripts）。
 */
export function classifyBuilds({ added, decisions, approved = [] }) {
  return [...new Set(added.map(buildDepPath))].map(key => {
    if (decisions === null) return { key, state: 'unknown' }
    const hits = [...decisions].filter(([k]) => buildKeyCovers(k, key)).map(([, v]) => v)
    if (hits.includes(false)) return { key, state: 'skipped' }
    if (approved.some(a => buildKeyCovers(a, key))) return { key, state: 'approved' }
    return { key, state: hits.includes(true) ? 'allowed' : 'needs' }
  })
}

export class PluginManager {
  /**
   * @param {ReturnType<import('./layout.mjs').layout>} paths
   * @param {{ main: Sidecar, bridgeDir: string, netHook: string, known: () => any, log: (l: string) => void, restart: () => Promise<void> }} deps
   */
  constructor(paths, deps) {
    this.paths = paths
    this.deps = deps
    this.queue = Promise.resolve()
    this.busy = null
    this.disposed = false
    this.probe = null
  }

  /** 插件被停用：不再接新活，正在试启动的那个 DSH 收掉；跑到一半的那件不会再去重启 sidecar。 */
  async dispose() {
    this.disposed = true
    await this.probe?.stop(1000).catch(() => {})
  }

  /** 改真实组合之前核对：组合是本插件建的（有标记文件）。用户自己建的同名组合一个字都不动。 */
  owned() { return existsSync(join(profileDir(this.paths.home), FUSION_MARKER)) }

  /** 插件操作一次只做一件。停用以后不再接新活。 */
  exclusive(label, fn) {
    if (this.disposed) return Promise.reject(new Error('DSH2Forsion is being turned off'))
    const job = this.queue.then(async () => {
      if (this.disposed) throw new Error('DSH2Forsion is being turned off')
      this.busy = label
      try { return await fn() } finally { this.busy = null }
    })
    this.queue = job.catch(() => {})
    return job
  }

  async list() {
    const installed = await userPlugins(this.paths.home)
    let live = []
    if (this.deps.main.state === 'running') {
      try { live = await this.deps.main.rpc('pluginManager/listBundles') } catch { live = [] }
    }
    const known = this.deps.known()
    return installed.map(p => {
      const b = live.find(x => x.name === p.name)
      const k = known.plugins?.[`${p.name}@${p.version}`] ?? null
      return {
        name: p.name, version: p.version, spec: p.spec,
        title: b?.meta?.title ?? null, description: b?.meta?.description ?? b?.description ?? null,
        enabled: b?.enabled ?? null, error: b?.error ?? null,
        known: k,
      }
    })
  }

  /**
   * 装前体检（第 1 档）：工作台里 DSH 自己的插件页要装 spec 时，桥把这次安装停住，引擎半身调这里。
   * 在临时 DSH_HOME 里拿当前组合起两次 —— 装之前一次、装上之后一次 —— 比出这个插件加了哪些工具、提示词多了多少字、
   * 有没有没启动的部分、启动时连了哪些外部主机（node --import 的钩子量出来的，不是读代码猜的）。不动真实的组合。
   */
  review(spec, opts = {}) {
    return this.exclusive(`review ${spec}`, () => this.reviewNow(spec, opts))
  }

  /** @param {{ approvedBuilds?: string[] }} [opts] approvedBuilds：DSH 插件页「允许这些脚本并重试」时带来的那几个 */
  async reviewNow(spec, { approvedBuilds = [] } = {}) {
    const t0 = Date.now()
    const log = this.deps.log
    let name = null
    try { name = await specName(spec) } catch { name = null }
    const known = this.deps.known()
    const trial = this.paths.trialHome
    await rm(trial, { recursive: true, force: true })
    await copyProfileTo(this.paths.home, trial)
    // 用户 DSH 目录顶层的 cordis.patch.yml 对所有组合生效：试启动也带上它（只读，不往回写）
    if (existsSync(join(this.paths.home, 'cordis.patch.yml'))) await cp(join(this.paths.home, 'cordis.patch.yml'), join(trial, 'cordis.patch.yml'))
    const sync = await dsh(this.paths, trial, ['plugin', '--profile', PROFILE, 'install', '--ignore-scripts'], { log })
    if (this.disposed) { await rm(trial, { recursive: true, force: true }); return { verdict: 'failed', spec, name, reasons: ['DSH2Forsion is being turned off'] } }
    if (sync.code !== 0) return { verdict: 'failed', spec, name, reasons: [`could not prepare the trial copy: ${tail(sync.out, 4)}`], ms: Date.now() - t0 }
    const buildsBefore = await pendingBuilds(trial)
    const before = await this.measure(trial, 'before')
    if (this.disposed) return { verdict: 'failed', spec, name, reasons: ['DSH2Forsion is being turned off'] }
    log(`review: add ${spec}`)
    const add = await dsh(this.paths, trial, ['plugin', '--profile', PROFILE, 'add', '--ignore-scripts', spec], { log })
    if (this.disposed) { await rm(trial, { recursive: true, force: true }); return { verdict: 'failed', spec, name, reasons: ['DSH2Forsion is being turned off'] } }
    if (add.code !== 0 && VERSION_REFUSED.test(add.out)) {
      await rm(trial, { recursive: true, force: true })
      return { verdict: 'version-refused', spec, name, reasons: [tail(add.out, 4)], ms: Date.now() - t0 }
    }
    if (add.code !== 0) {
      await rm(trial, { recursive: true, force: true })
      return { verdict: 'failed', spec, name, reasons: [tail(add.out, 6)], ms: Date.now() - t0 }
    }
    const added = (await userPlugins(trial)).filter(p => !before.deps.includes(p.name))
    name ??= added[0]?.name ?? null
    const version = name ? (await userPlugins(trial)).find(p => p.name === name)?.version ?? null : null
    const shadowed = await shadowedCorePackages(this.paths, trial)
    // 它带进来的、要跑构建脚本的包（体检不跑）：没人允许过的，真装时 DSH 的 pnpm 会报错
    const buildsAfter = await pendingBuilds(trial)
    let builds = null
    if (buildsBefore !== null && buildsAfter !== null) {
      let decisions = new Map()
      try { decisions = allowBuildsDecisions(await readFile(join(profileDir(trial), 'pnpm-workspace.yaml'), 'utf8')) }
      catch (error) { if (error?.code !== 'ENOENT') decisions = null }
      const had = new Set(buildsBefore.map(buildDepPath))
      builds = classifyBuilds({ added: buildsAfter.filter(b => !had.has(buildDepPath(b))), decisions, approved: approvedBuilds })
    }
    const after = await this.measure(trial, 'after')
    await rm(trial, { recursive: true, force: true })
    if (this.disposed) return { verdict: 'failed', spec, name, reasons: ['DSH2Forsion is being turned off'] }
    // 兼容矩阵的评级只对它跑过的那一版 DSH 算数（matrixDsh）；换了版本就只看这次实测
    const graded = name && version && (known.matrixDsh ?? known.dsh) === this.paths.dshVersion ? known.plugins?.[`${name}@${version}`] ?? null : null
    const judged = judgeTrial({ ready: after.ready, lines: after.lines, shadowed, pluginName: name ?? spec, graded })
    const beforeChars = new Map(before.sections.map(x => [x.name, x.chars]))
    const report = {
      verdict: judged.verdict, spec, name, version, reasons: judged.reasons,
      tools: after.tools.filter(t => !before.tools.includes(t)),
      toolsGone: after.ready ? before.tools.filter(t => !after.tools.includes(t)) : [],
      promptChars: after.sections.reduce((n, x) => n + x.chars, 0) - before.sections.reduce((n, x) => n + x.chars, 0),
      sections: after.sections.filter(x => x.chars !== beforeChars.get(x.name)).map(x => ({ name: x.name, chars: x.chars - (beforeChars.get(x.name) ?? 0) })),
      inactive: after.lines.filter(l => INACTIVE.test(l) || BROKEN.test(l)).filter(l => !before.lines.includes(l)).slice(0, 8),
      hosts: after.hosts.filter(h => !before.hosts.includes(h)),
      builds,
      measured: { before: before.ready, after: after.ready },
      ms: Date.now() - t0,
    }
    log(`review: ${report.verdict}, +${report.tools.length} tools, ${report.promptChars >= 0 ? '+' : ''}${report.promptChars} prompt chars, ${report.hosts.length} hosts, builds ${builds === null ? 'unread' : builds.map(b => `${b.key}=${b.state}`).join(',') || 'none'}`)
    return report
  }

  /** 在体检目录里起一次组合，量工具、提示词分节和外连主机；起不来也返回（ready=false）。 */
  async measure(trial, label) {
    // 停用以后不再起试启动的 DSH（dispose 只收得掉已经在跑的那个）
    if (this.disposed) return { ready: false, tools: [], sections: [], lines: [], hosts: [], deps: [] }
    const netFile = join(trial, `net-${label}.txt`)
    await writeFile(netFile, '')
    const probe = new Sidecar(this.paths, { home: trial, label: `trial-${label}`, cwd: trial, preload: this.deps.netHook, extraEnv: { DSH2FORSION_TRIAL_NET: netFile } })
    this.probe = probe
    let ready = false, tools = [], sections = []
    try {
      await probe.start(); ready = true
      if (this.disposed) throw new Error('turning off')
      // 等日志里的激活告警、插件启动时的外连落地
      await new Promise(r => setTimeout(r, 2500))
      const check = await probe.bridge('/fusion/check')
      tools = check.tools ?? []
      sections = check.sections ?? []
    } catch { /* 起不来 / 桥不在：ready 或工具表为空，交给判定 */ }
    const lines = [...probe.lines]
    await probe.stop()
    this.probe = null
    let hosts = []
    try { hosts = (await readFile(netFile, 'utf8')).split('\n').map(l => l.trim()).filter(Boolean) } catch { hosts = [] }
    const deps = (await userPlugins(trial)).map(p => p.name)
    return { ready, tools, sections, lines, hosts: [...new Set(hosts)], deps }
  }

  remove(name) {
    if (typeof name !== 'string' || !NPM_NAME.test(name)) return Promise.resolve({ status: 'failed', name, message: 'not an npm package name' })
    return this.exclusive(`remove ${name}`, async () => {
      if (!this.owned()) return { status: 'failed', name, message: NOT_OURS }
      await this.snapshot(`before remove ${name}`)
      const r = await dsh(this.paths, this.paths.home, ['plugin', '--profile', PROFILE, 'remove', name], { log: this.deps.log })
      if (r.code !== 0) return { status: 'failed', name, message: tail(r.out, 8) }
      await this.deps.restart()
      return { status: 'removed', name }
    })
  }

  /**
   * 回到最近一次改动之前；用掉的快照删掉，再回滚就往更早走。
   * 被换下来的那份（含之后在 DSH Space 里改的插件设置、从 DSH 插件页装的插件）先存进 backups/undone-<时刻>，
   * 不参与回滚顺序、只留最近几份：回滚错了还能手动拿回来。恢复失败就不删快照。
   */
  rollback() {
    return this.exclusive('rollback', async () => {
      if (!this.owned()) return { status: 'failed', message: NOT_OURS }
      const dir = await newestBackup(this.paths.backups)
      if (!dir) return { status: 'nothing-to-roll-back' }
      if (!await this.sameHome(dir)) return { status: 'failed', message: 'That snapshot is from a different DSH folder; it was kept and not applied.' }
      const undone = await this.snapshot('replaced by rollback', UNDONE_PREFIX)
      await pruneUndone(this.paths.backups)
      const ok = await this.restore(dir)
      if (!ok) return { status: 'failed', message: 'could not reinstall the plugins of that snapshot; the snapshot was kept', kept: undone }
      await rm(dir, { recursive: true, force: true })
      await this.deps.restart()
      return { status: 'rolled-back', to: dir, kept: undone }
    })
  }

  /** sidecar 成功启动后调用：记下这份能启动的 profile。 */
  async saveLastGood() {
    const dir = join(this.paths.backups, LAST_GOOD)
    await copyProfileFiles(profileDir(this.paths.home), join(dir, 'profile'))
    await writeFile(join(dir, 'label.txt'), `last good start ${new Date().toISOString()}\n`)
    await writeFile(join(dir, HOME_FILE), this.paths.home)
  }

  /** 快照只还原回建它的那份 DSH 目录（换过 DSH_HOME、或 v0.1 私有目录留下的快照都不认）。 */
  async sameHome(dir) {
    try { return (await readFile(join(dir, HOME_FILE), 'utf8')) === this.paths.home } catch { return false }
  }

  restoreLastGood() {
    return this.exclusive('restore last good', async () => {
      if (!this.owned()) return { status: 'failed', message: NOT_OURS }
      const dir = join(this.paths.backups, LAST_GOOD)
      if (!existsSync(join(dir, 'profile', 'package.json')) || !await this.sameHome(dir)) return { status: 'nothing-to-restore' }
      await this.snapshot('before restoring last good')
      await this.restore(dir)
      await this.deps.restart()
      return { status: 'restored' }
    })
  }

  async snapshot(label, prefix = '') {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const dir = join(this.paths.backups, `${prefix}${stamp}`)
    await mkdir(dir, { recursive: true })
    await copyProfileFiles(profileDir(this.paths.home), join(dir, 'profile'))
    await writeFile(join(dir, 'label.txt'), `${label}\n`)
    await writeFile(join(dir, HOME_FILE), this.paths.home)
    return dir
  }

  async restore(dir) {
    if (!this.owned() || !await this.sameHome(dir)) { this.deps.log('restore refused: profile not ours or snapshot from another DSH folder'); return false }
    // 只还原自己那份组合；DSH 目录顶层的 cordis.patch.yml 是用户所有组合共用的，从不往回写
    await copyProfileFiles(join(dir, 'profile'), profileDir(this.paths.home))
    // 按恢复后的清单和锁文件重装 node_modules
    const r = await dsh(this.paths, this.paths.home, ['plugin', '--profile', PROFILE, 'install', '--ignore-scripts'], { log: this.deps.log })
    if (r.code !== 0) this.deps.log(`restore install failed: ${tail(r.out, 6)}`)
    return r.code === 0
  }
}
