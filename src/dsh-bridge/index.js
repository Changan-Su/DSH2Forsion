// DSH2Forsion 桥：装进 sidecar 的 profile，经 DSH 的 webServer 给 Forsion 引擎半身提供几个口。
// DSH 的插件路由默认没有任何鉴权（webserver README「No server-wide authentication」），
// 所以每个请求都核对启动时注入的密钥。只在 sidecar 里跑，不依赖任何第三方包。
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto'
import { isAbsolute } from 'node:path'
import { managedSkills } from './skills.js'
import { installNativeAdapters } from './native-adapters.js'
import { mcpSnapshot } from './mcp.js'
import { SessionScopePool } from './session-scope.js'
import { listModels, resolveModel, readModelBody, streamModelResponse } from './models.js'

export const name = 'dsh2forsion-bridge'
export const inject = ['tools', 'webServer', 'systemPrompt', 'sessionProjections', 'skills', 'llm']

const PREFIX = '/forsion-bridge'
const MAX_BODY = 1 << 20
const APPROVAL_TTL_MS = 60_000

export function apply(ctx) {
  const log = ctx.logger('dsh2forsion')
  const secret = process.env.DSH2FORSION_SECRET ?? ''
  if (secret.length < 32) {
    log.warn('DSH2FORSION_SECRET missing or too short; bridge routes not mounted')
    return
  }
  // Tangu 批过的调用：callId → 过期时刻。DSH 侧再问审批时只放行这些，其余交给下一个回答方
  // （DSH Space 里照常弹卡）；拿不到就不放行。
  const approved = new Map()
  ctx.on('approval/request', async (req, next) => {
    const until = req.callId === undefined ? undefined : approved.get(req.callId)
    if (until !== undefined && until > Date.now()) {
      approved.delete(req.callId)
      return 'allowed-once'
    }
    return next()
  }, { prepend: true })
  watchParent(ctx, log)
  const agents = new AgentPool(ctx, log)
  const scopes = new SessionScopePool(ctx)
  const native = { endpoint: null }
  native.adapters = installNativeAdapters(ctx, { log: line => log.info(line), invoke: async (op, payload) => {
    if (!native.endpoint) throw new Error('Open the native view from a Tangu project session first')
    const response = await fetch(native.endpoint.url, { method: 'POST', signal: AbortSignal.timeout(30_000),
      headers: { 'content-type': 'application/json', 'x-dsh2forsion-native': native.endpoint.secret },
      body: JSON.stringify({ adapter: 'task-board', version: 1, op, payload }) })
    const result = await response.json()
    if (!response.ok) throw new Error(result.error || 'Native execution failed')
    return result
  } })
  const dispose = ctx.webServer.register({
    kind: 'prefix',
    path: PREFIX,
    handler: (req, res) => handle(ctx, { secret, approved, agents, scopes, native }, req, res).catch(error => {
      if (!res.headersSent && !res.destroyed) send(res, 500, { error: String(error?.message ?? error) })
    }),
  })
  ctx.effect(() => () => { native.endpoint = null; native.adapters.dispose(); dispose(); void agents.dispose(); void scopes.dispose().catch(error => log.warn(error)) })
}

// Forsion 崩溃或被强杀时引擎来不及停 sidecar，DSH 会变成孤儿常驻（约 400 MB，真桌面台架实测）。
// 桥跑在 DSH 进程里：每 3 秒看一眼引擎还在不在，不在就自己退出。
const PARENT_POLL_MS = 3000

function watchParent(ctx, log) {
  const parent = Number(process.env.DSH2FORSION_PARENT_PID)
  if (!Number.isInteger(parent) || parent <= 1) return
  const timer = setInterval(() => {
    try { process.kill(parent, 0) } catch (error) {
      if (error?.code === 'EPERM') return // 进程还在，只是不归我们管
      clearInterval(timer)
      log.warn('Forsion engine (pid %d) is gone; stopping DSH', parent)
      // POSIX 上走 DSH 自己的 SIGTERM 收尾；Windows 没有可捕获的 SIGTERM，直接退出
      if (process.platform === 'win32') process.exit(0)
      else process.kill(process.pid, 'SIGTERM')
    }
  }, PARENT_POLL_MS)
  timer.unref?.()
  ctx.effect(() => () => clearInterval(timer))
}

async function handle(ctx, state, req, res) {
  if (!authorized(req.headers['x-dsh2forsion-secret'], state.secret)) return send(res, 401, { error: 'unauthorized' })
  const path = new URL(req.url ?? '/', 'http://127.0.0.1').pathname
  if (req.method === 'GET' && path === `${PREFIX}/health`) return send(res, 200, { ok: true })
  if (path.startsWith(`${PREFIX}/models`)) {
    const controller = new AbortController()
    res.once('close', () => { if (!res.writableEnded) controller.abort() })
    const signal = controller.signal
    if (req.method === 'GET' && path === `${PREFIX}/models`) return send(res, 200, await listModels(ctx, { signal }))
    if (req.method === 'POST' && path === `${PREFIX}/models/resolve`) return send(res, 200, await resolveModel(ctx, (await readModelBody(req)).modelId, { signal }))
    if (req.method === 'POST' && path === `${PREFIX}/models/stream`) {
      const input = await readModelBody(req)
      if (input.sessionKey && input.cwd) return state.scopes.withInitiator(input, signal,
        (agent, combined) => streamModelResponse(ctx, input, res, { signal: combined, agent }))
      // Projectless/background inference has no attribution agent. Context
      // extensions must not treat this path as evidence of compression support.
      return streamModelResponse(ctx, input, res, { signal })
    }
  }
  if (req.method === 'GET' && [ `${PREFIX}/tools`, `${PREFIX}/mcp/catalog` ].includes(path)) {
    const controller = new AbortController()
    res.once('close', () => { if (!res.writableEnded) controller.abort() })
    const cwd = requestCwd(req)
    const keys = new URL(req.url, 'http://127.0.0.1').searchParams.getAll('sessionKey')
    if (keys.length > 1 || (keys.length && !/^[a-f0-9]{64}$/.test(keys[0]))) throw new Error('Invalid session key')
    const agent = keys.length ? await state.scopes.get({ sessionKey: keys[0], cwd }, controller.signal) : await state.agents.forCwd(cwd)
    controller.signal.throwIfAborted()
    if (path.endsWith('/mcp/catalog')) return send(res, 200, await mcpSnapshot(ctx, { agent, signal: controller.signal }))
    return send(res, 200, { tools: ctx.tools.schemas(agent) })
  }
  if (req.method === 'GET' && path === `${PREFIX}/prompt`) return send(res, 200, { sections: promptSections(ctx) })
  if (req.method === 'GET' && path === `${PREFIX}/skills`) {
    const controller = new AbortController()
    res.once('close', () => { if (!res.writableEnded) controller.abort() })
    return send(res, 200, { skills: await managedSkills(ctx, process.env.DSH_HOME, controller.signal, { cwd: requestCwd(req) }) })
  }
  if (req.method === 'POST' && path === `${PREFIX}/native/configure`) {
    const body = JSON.parse(await readBody(req))
    const url = new URL(body.url)
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.pathname !== '/invoke' || url.username || url.password || url.search || url.hash || !/^[a-f0-9]{64}$/.test(body.secret)) throw new Error('Invalid native callback')
    state.native.endpoint = { url: url.href, secret: body.secret }
    return send(res, 200, { ok: true })
  }
  if (req.method === 'POST' && path === `${PREFIX}/native/view`) {
    if (!state.native.endpoint) throw new Error('Native execution is unavailable on this host')
    return send(res, 200, state.native.adapters.openView(JSON.parse(await readBody(req))))
  }
  if (req.method === 'POST' && path === `${PREFIX}/tools/execute`) {
    const body = JSON.parse(await readBody(req))
    const callId = `dsh2forsion-${randomUUID()}`
    const controller = new AbortController()
    // 调用方断开才中止。别挂在 req 的 close 上：新版 Node 里请求体读完就会触发它
    res.once('close', () => { if (!res.writableEnded) controller.abort() })
    try {
      const execute = body.sessionKey
        ? fn => state.scopes.execute(body, controller.signal, fn)
        : fn => state.agents.execute(body.cwd, controller.signal, fn)
      const executed = await execute(async (agent, signal) => {
        if (body.approved === true) state.approved.set(callId, Date.now() + APPROVAL_TTL_MS)
        try {
          const result = await ctx.tools.execute({
            callId, name: String(body.name), arguments: body.arguments ?? {}, signal,
            ...(agent ? { agent } : {}),
          })
          return { agent: Boolean(agent), result }
        } finally { state.approved.delete(callId) }
      })
      return send(res, 200, { callId, ...executed })
    } finally {
      state.approved.delete(callId)
    }
  }
  if (req.method === 'POST' && path === `${PREFIX}/appearance`) {
    const body = JSON.parse(await readBody(req))
    return send(res, 200, await applyAppearance(ctx, body))
  }
  return send(res, 404, { error: 'not found' })
}

function requestCwd(req) {
  const values = new URL(req.url, 'http://127.0.0.1').searchParams.getAll('cwd')
  if (values.length > 1 || (values.length && !values[0].trim())) throw new Error('Exactly one nonempty cwd is allowed when supplied')
  return values[0]
}

// 全局层的提示词分节（含文本）。哪些是第三方加的由引擎半身按随版本发的基线名单判断。
function promptSections(ctx) {
  const layer = ctx.systemPrompt?.layers?.global
  const entries = layer?.sections?.entries?.()
  if (!entries) return []
  const out = []
  for (const [name, section] of entries) {
    let text = ''
    try { text = typeof section.text === 'function' ? String(section.text({}) ?? '') : String(section.text ?? '') }
    catch { text = '' }
    out.push({ name, order: section.order, text })
  }
  return out
}

// 主题、语言跟随 Forsion：写进 DSH 自己的设置（ui-theme / locale），DSH 会推给已打开的页面。
async function applyAppearance(ctx, body) {
  const settings = ctx.get('settings')
  if (!settings) return { ok: false, reason: 'settings service unavailable' }
  const done = {}
  if (['light', 'dark', 'system'].includes(body.theme)) {
    try { await settings.update('ui-theme', { preference: body.theme }); done.theme = body.theme }
    catch (error) { done.themeError = String(error?.message ?? error) }
  }
  if (['zh', 'en'].includes(body.locale)) {
    try { await settings.update('locale', { preference: body.locale }); done.locale = body.locale }
    catch (error) { done.localeError = String(error?.message ?? error) }
  }
  return { ok: true, ...done }
}

// 每个工作目录复用一个 DSH agent：工具的相对路径、工作目录与 DSH 侧审批都要靠 agent。
// 调用方指定了目录时，必须成功建立上下文；不能悄悄退回用户主目录执行。
class AgentPool {
  constructor(ctx, log) {
    this.ctx = ctx
    this.log = log
    this.byCwd = new Map()
    this.pendingByCwd = new Map()
    this.abort = new AbortController()
  }

  // These archived agents only carry external tool calls; never wake their model driver.
  // DSH approval audit events require a turn, even when Tangu supplied the model call.
  async execute(cwd, signal, fn) {
    signal = AbortSignal.any([signal, this.abort.signal])
    signal.throwIfAborted()
    const agent = await this.forCwd(cwd)
    signal.throwIfAborted()
    if (!agent) return fn(undefined, signal)
    const previous = this.pendingByCwd.get(cwd) ?? Promise.resolve()
    const pending = previous.catch(() => {}).then(() => {
      signal.throwIfAborted()
      return agent.runMaintenance(async maintenanceSignal => {
        const combined = AbortSignal.any([signal, maintenanceSignal])
        combined.throwIfAborted()
        const boundary = this.ctx.get('sessionProjections')?.stateOf(agent.session, 'turnBoundary')
        if (!boundary || boundary.openTurnStartSeq !== null) throw new Error('DSH bridge session has no available turn boundary')
        const turn = boundary.lastTurn + 1
        agent.session.append('turn/start', { turn })
        let reason = { kind: 'completed' }
        try {
          const value = await fn(agent, combined)
          if (value.result?.isError) reason = { kind: 'error', error: { message: 'External tool returned an error', code: 'UNKNOWN' } }
          return value
        } catch (error) {
          reason = { kind: 'error', error: { message: String(error?.message ?? error), code: 'UNKNOWN' } }
          throw error
        } finally {
          if (combined.aborted) reason = { kind: 'aborted', reason: { kind: this.abort.signal.aborted || maintenanceSignal.aborted ? 'disposed' : 'user' } }
          agent.session.append('turn/end', { turn, reason })
        }
      })
    })
    this.pendingByCwd.set(cwd, pending)
    try { return await pending }
    finally { if (this.pendingByCwd.get(cwd) === pending) this.pendingByCwd.delete(cwd) }
  }

  async forCwd(cwd) {
    if (cwd === undefined) return undefined
    if (typeof cwd !== 'string' || !isAbsolute(cwd)) throw new Error('DSH working directory must be an absolute path')
    if (!this.byCwd.has(cwd)) this.byCwd.set(cwd, this.open(cwd))
    const pending = this.byCwd.get(cwd)
    try { return (await pending).agent }
    catch (error) {
      if (this.byCwd.get(cwd) === pending) this.byCwd.delete(cwd)
      throw error
    }
  }

  async open(cwd) {
    const registry = this.ctx.get('agents')
    const sessionId = `dsh2forsion-${createHash('sha256').update(cwd).digest('hex').slice(0, 24)}`
    try {
      if (!registry) throw new Error('agents service unavailable')
      let handle
      try { handle = await registry.create({ sessionId, meta: { cwd } }) }
      catch (error) {
        // 上次留下的同名会话：接着用
        if (typeof registry.resume !== 'function') throw error
        handle = await registry.resume({ resumeSessionId: sessionId })
      }
      if (!handle?.agent) {
        await handle?.dispose?.()
        throw new Error('agent handle unavailable')
      }
      // 这些会话是桥自己的执行上下文，别出现在 DSH Space 的会话列表里
      try { await this.ctx.get('workspaceRegistry')?.archiveSession?.(sessionId) } catch { /* 归档失败只影响列表观感 */ }
      return handle
    } catch (error) {
      this.log.warn('bridge agent for %s unavailable: %s', cwd, error?.message ?? error)
      throw new Error(`Cannot establish DSH agent for working directory ${cwd}: ${error?.message ?? error}`)
    }
  }

  async dispose() {
    this.abort.abort({ kind: 'disposed' })
    const handles = await Promise.all([...this.byCwd.values()].map(p => p.catch(() => null)))
    this.byCwd.clear()
    await Promise.all(handles.map(h => h?.dispose?.().catch(() => {})))
  }
}

function authorized(header, secret) {
  if (typeof header !== 'string') return false
  const a = Buffer.from(header)
  const b = Buffer.from(secret)
  return a.length === b.length && timingSafeEqual(a, b)
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', chunk => {
      size += chunk.length
      if (size > MAX_BODY) { reject(new Error('body too large')); req.destroy(); return }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8') || '{}'))
    req.on('error', reject)
  })
}

function send(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(value))
}
