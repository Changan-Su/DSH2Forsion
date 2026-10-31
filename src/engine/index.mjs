// DSH2Forsion 引擎半身：装在 Forsion 插件包的 tangu-plugins/dsh2forsion/ 下，由 tangu-agent 原地加载。
// 管运行时与 sidecar、DSH 插件、把第三方工具 / 提示词挂进 Tangu，并给界面半身提供作用域路由。
// 只用 Node 内置模块（引擎插件不许 npm install），esbuild 打成单文件。
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DSH_VERSION, NODE_VERSION, PLUGIN_ID } from './constants.mjs'
import { layout } from './layout.mjs'
import { PluginManager } from './plugins.mjs'
import { ensureBridge, ensureProfile } from './profile.mjs'
import { installRuntime, runtimeInstalled } from './runtime.mjs'
import { Sidecar } from './sidecar.mjs'
import { PROVIDER_ID, ToolBridge } from './tools.mjs'

const LOG_LIMIT = 300

function readJson(file, fallback) {
  try { return JSON.parse(readFileSync(file, 'utf8')) } catch { return fallback }
}

export function createPlugin() {
  let state = null

  return {
    async activate(ctx) {
      const paths = layout(ctx.paths.dataDir)
      const bridgeDir = join(ctx.paths.pluginDir, 'dsh-bridge')
      const compatDir = join(ctx.paths.pluginDir, 'compat')
      const store = ctx.sdk.pluginStore
      const settings = () => ({ autoStart: true, exposeTools: true, downloadSource: 'auto', ...(store.getScopeSettings(PLUGIN_ID, 'global') ?? {}) })
      const logs = []
      const log = line => {
        logs.push(`${new Date().toISOString().slice(11, 19)} ${line}`)
        if (logs.length > LOG_LIMIT) logs.splice(0, logs.length - LOG_LIMIT)
      }
      const baseline = () => readJson(join(compatDir, `baseline-${DSH_VERSION}.json`), { tools: [], sections: [] })
      const known = () => readJson(join(compatDir, 'known.json'), { plugins: {}, exemptions: [] })

      const sidecar = new Sidecar(paths, { onState: s => log(`sidecar ${s.state}${s.error ? `: ${s.error}` : ''}`) })
      const tools = new ToolBridge({
        sidecar, baseline, log,
        enabled: () => store.isPluginEnabledSync(PLUGIN_ID) && settings().exposeTools !== false,
      })
      const job = { name: null, running: false, error: null, lines: [] }

      // 停用后（宿主启动时会先激活全部、再停掉被关的）不许再起 DSH：每个 await 之后都看一眼
      let disposed = false
      const offline = new Error('DSH2Forsion is turned off')
      let starting = null
      // 起 sidecar 前把 profile 和桥备好；起来以后同步一次工具表
      const startNow = async () => {
        if (!runtimeInstalled(paths)) throw new Error('runtime not installed')
        await ensureProfile(paths, paths.home, { log })
        if (disposed) throw offline
        if (await ensureBridge(paths, paths.home, bridgeDir, { log })) log('bridge installed / updated')
        if (disposed) throw offline
        await sidecar.start()
        if (disposed) { await sidecar.stop(1000); throw offline }
        await plugins.saveLastGood().catch(error => log(`save last good failed: ${error.message}`))
        await tools.refresh()
        if (disposed) return
        tools.startPolling()
      }
      const start = () => {
        if (disposed) return Promise.reject(offline)
        starting ??= startNow().finally(() => { starting = null })
        return starting
      }
      const stop = async (graceMs) => { tools.stopPolling(); await sidecar.stop(graceMs); await tools.refresh() }
      const restart = async () => {
        if (disposed) return
        const wasRunning = sidecar.state === 'running' || settings().autoStart !== false
        await stop()
        if (wasRunning && !disposed) await start().catch(error => log(`restart failed: ${error.message}`))
      }
      const plugins = new PluginManager(paths, { main: sidecar, bridgeDir, known, log, restart })

      const runJob = (name, fn) => {
        if (job.running) return false
        Object.assign(job, { name, running: true, error: null, lines: [] })
        const jlog = line => { job.lines.push(line); if (job.lines.length > 200) job.lines.shift(); log(line) }
        void fn(jlog).catch(error => { job.error = String(error.message ?? error); log(`${name} failed: ${job.error}`) })
          .finally(() => { job.running = false })
        return true
      }

      // 限时 5 秒：正在起的那次最多等 2 秒（等不到也没关系，它每一步都会看 disposed），sidecar 给 1.5 秒优雅退出
      const shutdown = async () => {
        disposed = true
        await plugins.dispose()
        if (starting) await Promise.race([starting.catch(() => {}), new Promise(r => setTimeout(r, 2000))])
        await stop(1500)
      }
      state = { shutdown }

      // Host owns namespacing and revokes this provider on disable/unload.
      // Old hosts keep tools working; they must not claim native skill support.
      if (ctx.registerSkillProvider) ctx.registerSkillProvider({
        id: 'dsh',
        list: async ({ signal } = {}) => {
          if (disposed || !store.isPluginEnabledSync(PLUGIN_ID) || sidecar.state !== 'running') return []
          const { skills } = await sidecar.bridge('/skills', { signal })
          return disposed ? [] : skills
        },
      })

      ctx.registerPlugin({
        id: PLUGIN_ID,
        name: 'DSH2Forsion',
        nameEn: 'DSH2Forsion',
        description: '让 Tangu 使用 DeepSeek Harness 插件的工具和技能，并管理其兼容运行时。原生技能需要新版宿主支持。',
        descriptionEn: 'Use DeepSeek Harness plugin tools and skills in Tangu, with a managed compatibility runtime. Native skills require host support.',
        scopes: ['global'],
        defaultEnabled: true,
        settings: {
          fields: [
            { key: 'autoStart', type: 'toggle', label: '随 Forsion 启动 DSH', labelEn: 'Start DSH with Forsion', default: true, help: '关掉则只在打开 DSH Space 时启动（常驻约 400 MB 内存）。', helpEn: 'When off, DSH starts only when you open the DSH Space (it uses about 400 MB of memory while running).' },
            { key: 'exposeTools', type: 'toggle', label: '把 DSH 插件的工具交给 Tangu', labelEn: 'Offer DSH plugin tools to Tangu', default: true, help: '每次调用都会先问你。', helpEn: 'Tangu asks you before every call.' },
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
      const status = () => ({
        dshVersion: DSH_VERSION,
        nodeVersion: NODE_VERSION,
        runtime: { installed: runtimeInstalled(paths), root: paths.root },
        job: { name: job.name, running: job.running, error: job.error, lines: job.lines.slice(-12) },
        sidecar: sidecar.snapshot(),
        tools: tools.schemas.map(t => t.name),
        promptSections: tools.sections.map(s => s.name),
        pluginJob: plugins.busy,
        settings: settings(),
        nativeSkills: { supported: typeof ctx.registerSkillProvider === 'function' },
      })

      ctx.registerScopedRoutes(router => {
        router.get('/status', (_req, res) => send(res, status))
        router.get('/logs', (_req, res) => send(res, () => ({ lines: [...logs], sidecar: sidecar.lines.slice(-200) })))
        router.post('/runtime/install', (_req, res) => send(res, () => {
          const started = runJob('install-runtime', jlog => installRuntime(paths, { source: settings().downloadSource, log: jlog }).then(() => start()))
          return { started }
        }))
        router.post('/sidecar/start', (_req, res) => send(res, async () => { await start(); return status() }))
        router.post('/sidecar/stop', (_req, res) => send(res, async () => { await stop(); return status() }))
        router.post('/sidecar/restart', (_req, res) => send(res, async () => { await stop(); await start(); return status() }))
        router.post('/space', (_req, res) => send(res, async () => {
          if (sidecar.state !== 'running') await start()
          return { url: sidecar.spaceUrl() }
        }))
        router.post('/appearance', (req, res) => send(res, async () => {
          if (sidecar.state !== 'running') return { ok: false, reason: 'not running' }
          return sidecar.bridge('/appearance', { method: 'POST', body: JSON.stringify({ theme: req.body?.theme, locale: req.body?.locale }) })
        }))
        router.get('/plugins', (_req, res) => send(res, async () => ({ plugins: await plugins.list(), known: known() })))
        router.post('/plugins/install', (req, res) => send(res, async () => {
          const r = await plugins.install(String(req.body?.spec ?? ''), { acceptRisk: req.body?.acceptRisk === true, confirm: req.body?.confirm === true, force: req.body?.force === true })
          await tools.refresh()
          return r
        }))
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
      })

      // 不阻塞激活（限时 30s）：装好了且开着自动启动，就在后台起
      if (runtimeInstalled(paths) && settings().autoStart !== false) {
        void start().catch(error => log(`auto start failed: ${error.message}`))
      } else if (!existsSync(paths.root)) {
        log('runtime not installed yet')
      }
      ctx.log(`activated (DSH ${DSH_VERSION})`)
    },

    async deactivate() {
      const s = state
      state = null
      if (s) await s.shutdown().catch(() => {})
    },
  }
}

export default createPlugin()
