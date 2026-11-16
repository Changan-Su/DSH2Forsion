// DSH2Forsion 引擎半身：装在 Forsion 插件包的 tangu-plugins/dsh2forsion/ 下，由 tangu-agent 原地加载。
// 第 1 档（融合）：常驻一个两头都开的 DSH（用户自己的 DSH 目录 + 自己那份组合），
//   - 替 Forsion 的 DSH 引擎登记成「常驻进程」：DSH 这个 Agent 的对话改连它（ctx.registerResidentEngine）；
//   - 给界面半身工作台的地址（同一个进程的网页界面）；
//   - 工作台里装插件先体检、问过用户再放行；跟版通道与「先退回上一版 DSH」。
// 只用 Node 内置模块（引擎插件不许 npm install），esbuild 打成单文件。
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DSH_VERSION, ENGINE_ID, NODE_VERSION, PLUGIN_ID, PROFILE } from './constants.mjs'
import { activeVersion, compareVersions, fetchChannel, installedVersions, PLUGIN_VERSION, previousVersion, setActiveVersion, storedManifest, verifiedVersions } from './channel.mjs'
import { ensureFusedProfile } from './fusion.mjs'
import { layout, resolveDshHome } from './layout.mjs'
import { PluginManager } from './plugins.mjs'
import { ensureBridge, userPlugins } from './profile.mjs'
import { installRuntime, runtimeInstalled } from './runtime.mjs'
import { Sidecar } from './sidecar.mjs'
import { PROVIDER_ID, ToolBridge } from './tools.mjs'

const LOG_LIMIT = 300
const REVIEW_POLL_MS = 1000
const REVIEW_KEEP_MS = 10 * 60_000

function readJson(file, fallback) {
  try { return JSON.parse(readFileSync(file, 'utf8')) } catch { return fallback }
}

export function createPlugin() {
  let state = null

  return {
    async activate(ctx) {
      const root = ctx.paths.dataDir
      const dshHome = resolveDshHome(process.env)
      const logs = []
      const log = line => {
        logs.push(`${new Date().toISOString().slice(11, 19)} ${line}`)
        if (logs.length > LOG_LIMIT) logs.splice(0, logs.length - LOG_LIMIT)
      }
      let paths = layout(root, process.platform, { dshHome, dshVersion: activeVersion(root, log) })
      const bridgeDir = join(ctx.paths.pluginDir, 'dsh-bridge')
      const netHook = join(bridgeDir, 'trial-net-hook.mjs')
      const compatDir = join(ctx.paths.pluginDir, 'compat')
      const store = ctx.sdk.pluginStore
      const settings = () => ({ autoStart: true, exposeTools: false, downloadSource: 'auto', updateChannel: 'pinned', ...(store.getScopeSettings(PLUGIN_ID, 'global') ?? {}) })
      const enabled = () => !disposed && store.isPluginEnabledSync(PLUGIN_ID)
      const baseline = () => readJson(join(compatDir, `baseline-${paths.dshVersion}.json`), readJson(join(compatDir, `baseline-${DSH_VERSION}.json`), { tools: [], sections: [] }))
      const known = () => readJson(join(compatDir, 'known.json'), { plugins: {}, exemptions: [] })

      const sidecar = new Sidecar(paths, { onState: s => log(`sidecar ${s.state}${s.error ? `: ${s.error}` : ''}`), cwd: dshHome })
      const tools = new ToolBridge({ sidecar, baseline, log, enabled: () => enabled() && settings().exposeTools === true })
      const job = { name: null, running: false, error: null, lines: [] }

      // 停用后（宿主启动时会先激活全部、再停掉被关的）不许再起 DSH：每个 await 之后都看一眼
      let disposed = false
      // 融合自检没过：进程收掉、工作台停用、对话退回底层那条路（每轮起一个 DSH）
      let incompatible = null
      let profileError = null
      const sessionEvents = []
      let eventSeq = 0 // 单调递增：状态里只带最后 10 条，界面按序号认新来的（按条数认，满了之后就再也看不到新的）
      const offline = new Error('DSH2Forsion is turned off')
      let starting = null
      const startNow = async () => {
        if (!runtimeInstalled(paths)) throw new Error('runtime not installed')
        try { await ensureFusedProfile(paths, { log }); profileError = null }
        catch (error) { profileError = String(error.message ?? error); throw error }
        if (disposed) throw offline
        if (await ensureBridge(paths, paths.home, bridgeDir, { log })) log('bridge installed / updated')
        if (disposed) throw offline
        await sidecar.start()
        if (disposed) { await sidecar.stop(1000); throw offline }
        // 自检：桥在、装插件闸拦上了。不过关 = 这一版 DSH 和这个插件版本对不上
        let check = null
        try { check = await sidecar.bridge('/fusion/check') } catch (error) { check = { ok: false, error: String(error.message ?? error) } }
        if (!check?.ok || check.gate !== true) {
          incompatible = { dshVersion: paths.dshVersion, reason: check?.ok ? `install review not armed: ${check.gateReason ?? 'unknown'}` : `bridge unavailable: ${check?.error ?? 'unknown'}`, at: new Date().toISOString() }
          log(`fusion self-check failed on DSH ${paths.dshVersion}: ${incompatible.reason}`)
          await sidecar.stop(1500)
          throw new Error(incompatible.reason)
        }
        incompatible = null
        await plugins.saveLastGood().catch(error => log(`save last good failed: ${error.message}`))
        await tools.refresh()
        if (disposed) return
        tools.startPolling()
        reviews.startPolling()
      }
      const start = () => {
        if (disposed) return Promise.reject(offline)
        starting ??= startNow().finally(() => { starting = null })
        return starting
      }
      const stop = async (graceMs) => { tools.stopPolling(); reviews.stopPolling(); await sidecar.stop(graceMs); await tools.refresh() }
      const restart = async () => {
        if (disposed) return
        await stop()
        if (!disposed) await start().catch(error => log(`restart failed: ${error.message}`))
      }
      const plugins = new PluginManager(paths, { main: sidecar, bridgeDir, netHook, known, log, restart })

      // 工作台里装插件：桥把安装停住 → 这里体检 → 界面问用户 → 回桥放行 / 拒绝
      const reviews = {
        items: new Map(), timer: null,
        list: () => [...reviews.items.values()].map(({ id, spec, at, state, report, error }) => ({ id, spec, at, state, report, error })),
        startPolling() {
          if (reviews.timer) return
          const tick = async () => {
            reviews.timer = null
            if (disposed || sidecar.state !== 'running') return
            try {
              const { pending } = await sidecar.bridge('/fusion/installs')
              for (const p of pending ?? []) {
                if (reviews.items.has(p.id)) continue
                const item = { id: p.id, spec: p.spec, at: p.at, state: 'checking', report: null, error: null }
                reviews.items.set(p.id, item)
                log(`install of ${p.spec} is waiting for review`)
                void plugins.review(p.spec, { approvedBuilds: p.approvedBuilds }).then(r => { item.report = r; item.state = 'ready' }, e => { item.error = String(e.message ?? e); item.state = 'ready' })
              }
              const live = new Set((pending ?? []).map(p => p.id))
              for (const [id, item] of reviews.items) {
                // 桥那边已经没有了（超时拒绝 / DSH 重启）：界面上收掉，过一阵删
                if (!live.has(id) && item.state !== 'decided' && item.state !== 'checking') { item.state = 'gone' }
                if ((item.state === 'decided' || item.state === 'gone') && Date.now() - item.at > REVIEW_KEEP_MS) reviews.items.delete(id)
              }
            } catch { /* DSH 正在重启；下一轮再看 */ }
            if (!disposed && sidecar.state === 'running') reviews.timer = setTimeout(tick, REVIEW_POLL_MS)
          }
          reviews.timer = setTimeout(tick, REVIEW_POLL_MS)
        },
        stopPolling() { clearTimeout(reviews.timer); reviews.timer = null },
        async decide(id, allow) {
          const item = reviews.items.get(id)
          if (!item) throw new Error('This install is no longer waiting')
          if (item.state === 'checking' && allow) throw new Error('Wait for the check to finish')
          const r = await sidecar.bridge('/fusion/installs/decide', { method: 'POST', body: JSON.stringify({ id, allow, message: allow ? undefined : 'Cancelled in Forsion' }) })
          item.state = r.ok ? 'decided' : 'gone'
          item.allowed = allow
          return { ok: r.ok }
        },
      }

      const runJob = (name, fn) => {
        if (job.running) return false
        Object.assign(job, { name, running: true, error: null, lines: [] })
        const jlog = line => { job.lines.push(line); if (job.lines.length > 200) job.lines.shift(); log(line) }
        void fn(jlog).catch(error => { job.error = String(error.message ?? error); log(`${name} failed: ${job.error}`) })
          .finally(() => { job.running = false })
        return true
      }

      // 换一版运行时（跟版通道装好新版 / 先退回上一版）：记下、换路径、重启
      const switchRuntime = async (version) => {
        await setActiveVersion(root, version)
        await stop()
        paths = layout(root, process.platform, { dshHome, dshVersion: version })
        sidecar.paths = paths
        plugins.paths = paths
        incompatible = null
        log(`switched to DSH ${version}`)
        if (!disposed) await start().catch(error => log(`start on DSH ${version} failed: ${error.message}`))
      }
      const channel = { checkedAt: null, published: null, latest: null, error: null }
      const checkChannel = async (jlog = log) => {
        channel.checkedAt = new Date().toISOString()
        try {
          const r = await fetchChannel(root)
          channel.published = r.published
          channel.latest = r.manifest?.dsh ?? null
          channel.error = null
          if (!r.published) { jlog('update channel: nothing published yet'); return }
          if (compareVersions(r.manifest.dsh, paths.dshVersion) <= 0) { jlog(`update channel: DSH ${paths.dshVersion} is current`); return }
          const next = layout(root, process.platform, { dshHome, dshVersion: r.manifest.dsh })
          jlog(`update channel: installing DSH ${r.manifest.dsh}`)
          await installRuntime(next, { source: settings().downloadSource, log: jlog, files: r.manifest.files })
          await switchRuntime(r.manifest.dsh)
        } catch (error) { channel.error = String(error.message ?? error); jlog(`update channel: ${channel.error}`) }
      }

      // 限时 5 秒：正在起的那次最多等 2 秒（等不到也没关系，它每一步都会看 disposed），sidecar 给 1.5 秒优雅退出
      const shutdown = async () => {
        disposed = true
        reviews.stopPolling()
        await plugins.dispose()
        if (starting) await Promise.race([starting.catch(() => {}), new Promise(r => setTimeout(r, 2000))])
        await stop(1500)
      }
      state = { shutdown }

      // 常驻进程：DSH 这个 Agent 的对话连它。只在进程确实起不来时回 null（那时宿主每轮起一个 DSH，两个进程不会同时开在一份目录上）
      if (ctx.registerResidentEngine) ctx.registerResidentEngine({
        engineId: ENGINE_ID,
        connect: async (signal) => {
          if (!enabled() || incompatible || !runtimeInstalled(paths)) return null
          try {
            await Promise.race([start(), new Promise((_, reject) => signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true }))])
          } catch (error) { log(`resident connect: ${error.message}`); return null }
          if (!enabled()) return null
          return sidecar.connection()
        },
        onSession: (event) => {
          sessionEvents.push({ ...event, seq: ++eventSeq, at: Date.now() })
          if (sessionEvents.length > 50) sessionEvents.splice(0, sessionEvents.length - 50)
        },
        // 第 2 档：交过去的 Computer Use 先问「这场会话的模型收不收图」，由 DSH 自己按它的模型目录答；答不了 = 不知道（宿主按不能处理）
        modelSeesImages: async (model) => {
          if (typeof model !== 'string' || !model || sidecar.state !== 'running') return undefined
          try {
            const { image } = await sidecar.bridge('/models/images', { method: 'POST', body: JSON.stringify({ modelId: model }) })
            return typeof image === 'boolean' ? image : undefined
          } catch (error) { log(`modelSeesImages: ${error.message}`); return undefined }
        },
      })

      // 技能照旧经后台 DSH 给 Tangu 的 Agent（改成直接读文件不在第 1 档）
      if (ctx.registerSkillProvider) ctx.registerSkillProvider({
        id: 'dsh',
        list: async ({ signal, cwd } = {}) => {
          if (!enabled() || sidecar.state !== 'running') return []
          const { skills } = await sidecar.bridge(`/skills${cwd ? `?cwd=${encodeURIComponent(cwd)}` : ''}`, { signal })
          return disposed ? [] : skills
        },
      })

      ctx.registerPlugin({
        id: PLUGIN_ID,
        name: 'DSH2Forsion',
        nameEn: 'DSH2Forsion',
        description: '在 Forsion 里常驻一个 DeepSeek Harness：DSH 这个 Agent 的对话连它，DSH 工作台开它的界面，装 DSH 插件前先体检。',
        descriptionEn: 'Keeps one DeepSeek Harness running in Forsion: chats with the DSH agent connect to it, the DSH workbench opens its interface, and DSH plugins are checked before they are installed.',
        scopes: ['global'],
        defaultEnabled: true,
        settings: {
          fields: [
            { key: 'autoStart', type: 'toggle', label: '随 Forsion 启动 DSH', labelEn: 'Start DSH with Forsion', default: true, help: '关掉则在第一次和 DSH 对话或打开工作台时再启动（常驻约 400 MB 内存）。', helpEn: 'When off, DSH starts the first time you chat with DSH or open the workbench (it uses about 400 MB of memory while running).' },
            { key: 'exposeTools', type: 'toggle', label: '把 DSH 插件的工具交给 Tangu', labelEn: 'Offer DSH plugin tools to Tangu', default: false, help: '缺省关：把要 DSH 插件做的事交给 DSH 这个 Agent。打开后每次调用都会先问你，升版时最容易断。', helpEn: 'Off by default: hand work that needs a DSH plugin to the DSH agent. When on, Tangu asks before every call; this is the part most likely to break when DSH updates.' },
            {
              key: 'updateChannel', type: 'select', label: '更新通道', labelEn: 'Update channel', default: 'pinned',
              options: [
                { value: 'pinned', label: '固定在这个插件版本验过的 DSH', labelEn: 'Stay on the DSH this plugin version was checked with' },
                { value: 'follow', label: '跟版：装 DSH2Forsion 每天自检过的新版', labelEn: 'Follow: install newer DSH versions that DSH2Forsion checks every day' },
              ],
            },
            {
              key: 'downloadSource', type: 'select', label: '下载源', labelEn: 'Download source', default: 'auto',
              options: [
                { value: 'auto', label: '自动（官方优先，失败用国内镜像）', labelEn: 'Automatic (official first, then the China mirror)' },
                { value: 'official', label: '官方（nodejs.org / npmjs）', labelEn: 'Official (nodejs.org / npmjs)' },
                { value: 'mirror', label: '国内镜像（npmmirror）', labelEn: 'China mirror (npmmirror)' },
              ],
            },
          ],
        },
        toolProvider: {
          id: PROVIDER_ID,
          tools: () => tools.toolDefs(() => store.isPluginEnabledSync(PLUGIN_ID)),
        },
        promptSection: () => tools.promptSection(),
      })

      const send = (res, fn) => Promise.resolve().then(fn).then(
        value => res.json(value ?? { ok: true }),
        error => res.status(500).json({ error: String(error?.message ?? error) }),
      )
      const status = async () => ({
        pluginVersion: PLUGIN_VERSION,
        dshVersion: paths.dshVersion,
        pinnedVersion: DSH_VERSION,
        nodeVersion: NODE_VERSION,
        runtime: { installed: runtimeInstalled(paths), root: paths.root, installedVersions: await installedVersions(root), verifiedVersions: verifiedVersions(root), previous: await previousVersion(root, paths.dshVersion) },
        fusion: { home: dshHome, profile: PROFILE, profileError, incompatible, resident: typeof ctx.registerResidentEngine === 'function', hold: typeof ctx.sdk.engines?.hold === 'function', events: sessionEvents.slice(-10) },
        channel: { ...channel, setting: settings().updateChannel },
        job: { name: job.name, running: job.running, error: job.error, lines: job.lines.slice(-12) },
        sidecar: sidecar.snapshot(),
        tools: tools.schemas.map(t => t.name),
        promptSections: tools.sections.map(s => s.name),
        pluginJob: plugins.busy,
        // 用户装的 DSH 插件清单的指纹(名字@版本):界面据此知道清单变了,让宿主重取 Harness 卡上的行
        plugins: { key: (await userPlugins(paths.home)).map(p => `${p.name}@${p.version}`).sort().join(',') },
        reviews: reviews.list().filter(r => r.state === 'checking' || r.state === 'ready').length,
        // DSH 自己的审批:mode 'forsion' = Forsion 发的轮问到 Forsion 的审批卡;'workbench' = 自检没过,退回工作台提示(reason 写原因)
        approvals: sidecar.state === 'running' ? await sidecar.bridge('/approvals', { signal: AbortSignal.timeout(1500) }).catch(() => null) : null,
        settings: settings(),
        nativeSkills: { supported: typeof ctx.registerSkillProvider === 'function' },
      })

      ctx.registerScopedRoutes(router => {
        router.get('/status', (_req, res) => send(res, status))
        router.get('/logs', (_req, res) => send(res, () => ({ lines: [...logs], sidecar: sidecar.lines.slice(-200) })))
        router.post('/runtime/install', (_req, res) => send(res, () => {
          // 当前选中的是通道上验过的另一版：按它存着的清单装（随包的锁只对钉死那一版）；清单不在 / 不对就不装，别装错版本
          const started = runJob('install-runtime', async jlog => {
            const manifest = await storedManifest(root, paths.dshVersion)
            await installRuntime(paths, { source: settings().downloadSource, log: jlog, ...(manifest ? { files: manifest.files } : {}) })
            await start()
          })
          return { started }
        }))
        router.post('/sidecar/start', (_req, res) => send(res, async () => { await start(); return status() }))
        // 停到下次用：下一次和 DSH 对话或打开工作台时会再起
        router.post('/sidecar/stop', (_req, res) => send(res, async () => { await stop(); return status() }))
        router.post('/sidecar/restart', (_req, res) => send(res, async () => { await stop(); await start(); return status() }))
        // 工作台：同一个进程的网页界面（登录地址只在内存里，经这个路由交给界面半身的受控网页容器）
        const workbench = async () => {
          if (incompatible) return { incompatible, previous: await previousVersion(root, paths.dshVersion) }
          if (sidecar.state !== 'running') await start()
          return { url: sidecar.spaceUrl(), base: sidecar.base, startedAt: sidecar.startedAt }
        }
        router.post('/workbench', (_req, res) => send(res, workbench))
        router.post('/space', (_req, res) => send(res, workbench))
        // 右栏页（第 2 档）：同一份登录地址 + 一个回报口令（网页凭它把「这一页开没开成」报回桥，见 dsh-bridge/rail.js）。
        // 地址里的 # 由 Forsion 那半拼（页、会话、口令），这里不拼：令牌只在登录那一下用，网页登录后自己去掉。
        router.post('/rail', (_req, res) => send(res, async () => {
          const wb = await workbench()
          if (wb.incompatible) return wb
          const { nonce } = await sidecar.bridge('/rail/nonce', { method: 'POST', body: '{}' })
          return { ...wb, nonce }
        }))
        router.post('/rail/report', (req, res) => send(res, async () => {
          if (sidecar.state !== 'running') return { known: false, report: null, stopped: true }
          return sidecar.bridge(`/rail?nonce=${encodeURIComponent(String(req.body?.nonce ?? ''))}`)
        }))
        // 右键菜单「在 DSH 工作台里打开」：先让宿主在常驻进程里把这一场开着留给工作台
        router.post('/hold', (req, res) => send(res, async () => {
          if (typeof ctx.sdk.engines?.hold !== 'function') throw new Error('Update Forsion to open conversations in the DSH workbench')
          if (sidecar.state !== 'running') await start()
          return ctx.sdk.engines.hold(ENGINE_ID, String(req.body?.sessionId ?? ''), req.user?.userId)
        }))
        router.post('/appearance', (req, res) => send(res, async () => {
          if (sidecar.state !== 'running') return { ok: false, reason: 'not running' }
          return sidecar.bridge('/appearance', { method: 'POST', body: JSON.stringify({ theme: req.body?.theme, locale: req.body?.locale }) })
        }))
        router.get('/plugins', (_req, res) => send(res, async () => ({ plugins: await plugins.list(), known: known() })))
        router.get('/reviews', (_req, res) => send(res, () => ({ reviews: reviews.list() })))
        router.post('/reviews/decide', (req, res) => send(res, () => reviews.decide(String(req.body?.id ?? ''), req.body?.allow === true)))
        router.post('/plugins/remove', (req, res) => send(res, async () => {
          const r = await plugins.remove(String(req.body?.name ?? ''))
          await tools.refresh()
          return r
        }))
        router.post('/plugins/restore-last-good', (_req, res) => send(res, async () => {
          const r = await plugins.restoreLastGood()
          await tools.refresh()
          return r
        }))
        router.post('/plugins/rollback', (_req, res) => send(res, async () => {
          const r = await plugins.rollback()
          await tools.refresh()
          return r
        }))
        router.post('/channel/check', (_req, res) => send(res, () => ({ started: runJob('update-channel', jlog => checkChannel(jlog)) })))
        router.post('/channel/set', (req, res) => send(res, async () => {
          const value = req.body?.updateChannel
          if (value !== 'pinned' && value !== 'follow') throw new Error('updateChannel must be pinned or follow')
          await store.setScopeSettings(PLUGIN_ID, 'global', { updateChannel: value })
          if (value === 'follow') runJob('update-channel', jlog => checkChannel(jlog))
          return status()
        }))
        // 先退回上一版 DSH：只退到盘上装好了、这个插件版本认的那一版；没有就不给退
        router.post('/runtime/previous', (_req, res) => send(res, async () => {
          const prev = await previousVersion(root, paths.dshVersion)
          if (!prev) throw new Error('No earlier DSH version that this DSH2Forsion has checked is installed on this computer')
          await switchRuntime(prev)
          return status()
        }))
      })

      // 不阻塞激活（限时 30s）：装好了且开着自动启动，就在后台起
      if (runtimeInstalled(paths) && settings().autoStart !== false) {
        void start().catch(error => log(`auto start failed: ${error.message}`))
      } else if (!existsSync(paths.root)) {
        log('runtime not installed yet')
      }
      if (settings().updateChannel === 'follow' && runtimeInstalled(paths)) void checkChannel().catch(() => {})
      ctx.log(`activated (DSH ${paths.dshVersion}, profile ${PROFILE})`)
    },

    async deactivate() {
      const s = state
      state = null
      if (s) await s.shutdown().catch(() => {})
    },
  }
}

export default createPlugin()
