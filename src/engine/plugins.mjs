// DSH 插件管理：装前试启动、核心包夹带扫描、版本豁免、改前快照、一键回滚。
// M0 随机样本里 30 个有 2 个会拖垮整个 sidecar 或界面，DSH 自己的插件管理器只在 pnpm 失败时回滚，
// 所以装之前先在临时 DSH_HOME 里整套装一遍、起一次，过了才动用户的 profile。
import { existsSync } from 'node:fs'
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DSH_VERSION, PROFILE } from './constants.mjs'
import { LAST_GOOD, copyProfileFiles, dsh, newestBackup, profileDir, shadowedCorePackages, userPlugins } from './profile.mjs'
import { tail } from './proc.mjs'
import { Sidecar } from './sidecar.mjs'

const NPM_NAME = /^(@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*$/i
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

export class PluginManager {
  /**
   * @param {ReturnType<import('./layout.mjs').layout>} paths
   * @param {{ main: Sidecar, bridgeDir: string, known: () => any, log: (l: string) => void, restart: () => Promise<void> }} deps
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

  install(spec, opts = {}) {
    return this.exclusive(`install ${spec}`, () => this.installNow(spec, opts))
  }

  async installNow(spec, { acceptRisk = false, confirm = false, force = false } = {}) {
    const name = await specName(spec)
    const log = this.deps.log
    const known = this.deps.known()
    const verified = Boolean(known.exemptions?.includes(spec) || known.exemptions?.includes(`${name}@${spec.slice(name.length + 1)}`))
    const trial = this.paths.trialHome
    await rm(trial, { recursive: true, force: true })
    await copyProfileFiles(profileDir(this.paths.home), profileDir(trial))
    if (existsSync(join(this.paths.home, 'cordis.patch.yml'))) await cp(join(this.paths.home, 'cordis.patch.yml'), join(trial, 'cordis.patch.yml'))
    log(`trial: add ${spec}`)
    let exempted = false
    let add = await dsh(this.paths, trial, ['plugin', '--profile', PROFILE, 'add', '--ignore-scripts', spec], { log })
    if (add.code !== 0 && VERSION_REFUSED.test(add.out)) {
      if (!acceptRisk && !verified) {
        return { status: 'version-refused', name, spec, verified, message: tail(add.out, 6) }
      }
      const grant = await dsh(this.paths, trial, ['plugin', '--profile', PROFILE, 'allow-version', spec, '--dsh-version', DSH_VERSION, '--accept-risk'], { log })
      if (grant.code !== 0) return { status: 'failed', name, spec, message: tail(grant.out, 6) }
      exempted = true
      add = await dsh(this.paths, trial, ['plugin', '--profile', PROFILE, 'add', '--ignore-scripts', spec], { log })
    }
    if (add.code !== 0) return { status: 'failed', name, spec, message: tail(add.out, 8) }

    const shadowed = await shadowedCorePackages(this.paths, trial)
    const version = (await userPlugins(trial)).find(p => p.name === name)?.version
    const graded = version ? known.plugins?.[`${name}@${version}`] ?? null : null
    if (this.disposed) return { status: 'failed', name, spec, message: 'DSH2Forsion is being turned off' }
    const probe = new Sidecar(this.paths, { home: trial, label: 'trial' })
    this.probe = probe
    let ready = false
    try { await probe.start(); ready = true } catch { ready = false }
    // 等日志里的激活告警落地
    if (ready) await new Promise(r => setTimeout(r, 1500))
    const lines = [...probe.lines]
    await probe.stop()
    this.probe = null
    if (this.disposed) return { status: 'failed', name, spec, message: 'DSH2Forsion is being turned off' }
    const judged = judgeTrial({ ready, lines, shadowed, pluginName: name, graded })
    log(`trial: ${judged.verdict}`)
    if (judged.verdict === 'blocked' && !force) return { status: 'blocked', name, spec, reasons: judged.reasons }
    if (judged.verdict === 'partial' && !confirm && !force) return { status: 'needs-confirm', name, spec, reasons: judged.reasons }

    const backup = await this.snapshot(`before install ${spec}`)
    try {
      if (exempted) {
        const g = await dsh(this.paths, this.paths.home, ['plugin', '--profile', PROFILE, 'allow-version', spec, '--dsh-version', DSH_VERSION, '--accept-risk'], { log })
        if (g.code !== 0) throw new Error(tail(g.out, 6))
      }
      const real = await dsh(this.paths, this.paths.home, ['plugin', '--profile', PROFILE, 'add', '--ignore-scripts', spec], { log })
      if (real.code !== 0) throw new Error(tail(real.out, 8))
    } catch (error) {
      await this.restore(backup)
      return { status: 'failed', name, spec, message: String(error.message ?? error) }
    }
    await rm(trial, { recursive: true, force: true })
    await this.deps.restart()
    return { status: 'installed', name, spec, exempted, verdict: judged.verdict, reasons: judged.reasons }
  }

  remove(name) {
    if (typeof name !== 'string' || !NPM_NAME.test(name)) return Promise.resolve({ status: 'failed', name, message: 'not an npm package name' })
    return this.exclusive(`remove ${name}`, async () => {
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
      const dir = await newestBackup(this.paths.backups)
      if (!dir) return { status: 'nothing-to-roll-back' }
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
    await cp(join(this.paths.home, 'cordis.patch.yml'), join(dir, 'home.cordis.patch.yml')).catch(() => {})
    await writeFile(join(dir, 'label.txt'), `last good start ${new Date().toISOString()}\n`)
  }

  restoreLastGood() {
    return this.exclusive('restore last good', async () => {
      const dir = join(this.paths.backups, LAST_GOOD)
      if (!existsSync(join(dir, 'profile', 'package.json'))) return { status: 'nothing-to-restore' }
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
    await cp(join(this.paths.home, 'cordis.patch.yml'), join(dir, 'home.cordis.patch.yml')).catch(() => {})
    await writeFile(join(dir, 'label.txt'), `${label}\n`)
    return dir
  }

  async restore(dir) {
    await copyProfileFiles(join(dir, 'profile'), profileDir(this.paths.home))
    if (existsSync(join(dir, 'home.cordis.patch.yml'))) await cp(join(dir, 'home.cordis.patch.yml'), join(this.paths.home, 'cordis.patch.yml'))
    // 按恢复后的清单和锁文件重装 node_modules
    const r = await dsh(this.paths, this.paths.home, ['plugin', '--profile', PROFILE, 'install', '--ignore-scripts'], { log: this.deps.log })
    if (r.code !== 0) this.deps.log(`restore install failed: ${tail(r.out, 6)}`)
    return r.code === 0
  }
}
