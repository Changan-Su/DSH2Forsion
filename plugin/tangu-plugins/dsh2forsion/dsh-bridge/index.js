// DSH2Forsion 桥：装进 sidecar 的 profile，经 DSH 的 webServer 给 Forsion 引擎半身提供几个口。
// DSH 的插件路由默认没有任何鉴权（webserver README「No server-wide authentication」），
// 所以每个请求都核对启动时注入的密钥。只在 sidecar 里跑，不依赖任何第三方包。
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto'
import { isAbsolute } from 'node:path'
import { managedSkills } from './skills.js'
import { mcpSnapshot } from './mcp.js'
import { SessionScopePool } from './session-scope.js'
import { listModels, resolveModel, readModelBody, streamModelResponse } from './models.js'
import { APPROVAL_EVENT, createApprovalRouter } from './approvals.js'
import { createRailReports } from './rail.js'

export const name = 'dsh2forsion-bridge'
export const inject = ['tools', 'webServer', 'systemPrompt', 'sessionProjections', 'skills', 'llm']

const PREFIX = '/forsion-bridge'
const BRIDGE_VERSION = '0.3.0'
const MAX_BODY = 1 << 20
const MAX_RAIL_BODY = 64 << 10
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
  // DSH 自己的审批:Forsion 发的轮问到 Forsion 的审批卡,工作台发的轮留在工作台(approvals.js)。
  // DSH2FORSION_APPROVAL_EVENT 只给测试用:故意挂到对不上的事件名上,看自检退回工作台提示。
  const eventName = process.env.DSH2FORSION_APPROVAL_EVENT || APPROVAL_EVENT
  const approvals = createApprovalRouter({
    events: () => ctx.events, ownName: name, log, eventName,
    // 只在融合进程里(stdout 是插件读的 ACP 管道)往 stdout 写扩展通知
    write: process.env.DSH2FORSION_STDIO_NOTICES === '1' ? line => process.stdout.write(line) : null,
  })
  ctx.on(APPROVAL_EVENT, function (req, next) {
    const until = req.callId === undefined ? undefined : approved.get(req.callId)
    if (until !== undefined && until > Date.now()) {
      approved.delete(req.callId)
      return 'allowed-once'
    }
    return eventName === APPROVAL_EVENT ? approvals.link(this, req, next) : next()
  }, { prepend: true })
  if (eventName !== APPROVAL_EVENT) ctx.on(eventName, function (req, next) { return approvals.link(this, req, next) }, { prepend: true })
  ctx.on('agent/inbox/claimed', payload => approvals.onClaim(payload))
  ctx.on('session/event', (session, event) => approvals.onSessionEvent(session, event))
  // DSH 的对话入口晚于桥装上:起来几秒后自检一次,原因进日志(之后每次接管前都再核一遍)
  const firstCheck = setTimeout(() => approvals.check(), 3000)
  firstCheck.unref?.()
  ctx.effect(() => () => { clearTimeout(firstCheck); approvals.dispose() })
  watchParent(ctx, log)
  const agents = new AgentPool(ctx, log)
  const scopes = new SessionScopePool(ctx)
  // 工作台里 DSH 自己的插件页装插件时，先停在这里等 Forsion 体检、问过用户（融合插件第 1 档）。
  const gate = installGate(ctx, log)
  // Forsion 右栏里的 DSH 页（第 2 档，client.js 的右栏模式）做没做成，凭口令报回这里（rail.js）
  const rail = createRailReports()
  const dispose = ctx.webServer.register({
    kind: 'prefix',
    path: PREFIX,
    handler: (req, res) => handle(ctx, { secret, approved, agents, scopes, gate, approvals, rail }, req, res).catch(error => {
      if (!res.headersSent && !res.destroyed) send(res, 500, { error: String(error?.message ?? error) })
    }),
  })
  ctx.effect(() => () => { gate.dispose(); dispose(); void agents.dispose(); void scopes.dispose().catch(error => log.warn(error)) })
}

// 装插件闸：包住 pluginManager.installBundle。只拦界面发起的安装（带 requestId、不是升级 —— 升级失败时插件管理器自己
// 会用 installBundle 装回旧版，那一步不能拦）。Forsion 那半轮询待审的安装、体检、问用户，再回话放行或拒绝；
// 没人回话就按拒绝处理（INSTALL_TTL_MS）。拦不上（插件管理器不在、方法名变了）时 armed=false，引擎半身据此报「对不上」。
const INSTALL_TTL_MS = 15 * 60_000

export function installGate(ctx, log) {
  const pending = new Map()
  // 被停住的安装按 DSH 插件页给的 requestId 记着：DSH 自己的「取消」和断线重连后的 waitForInstall 认的是它
  const byRequest = new Map()
  const gate = { armed: false, reason: 'waiting for the plugin manager', pending,
    list: () => [...pending.values()].map(({ id, spec, at, approvedBuilds }) => ({ id, spec, at, approvedBuilds })),
    decide(id, allow, message) {
      const item = pending.get(id)
      if (!item) return false
      pending.delete(id)
      clearTimeout(item.timer)
      if (allow) item.resolve()
      else item.reject(new Error(message || 'Forsion did not approve installing this plugin'))
      return true
    },
    dispose() { for (const id of [...pending.keys()]) gate.decide(id, false, 'DSH2Forsion bridge stopped') },
  }
  const arm = (pm) => {
    if (!pm || typeof pm.installBundle !== 'function') { gate.reason = `plugin manager has no installBundle (${typeof pm})`; log.warn(gate.reason); return () => {} }
    // cordis 给的是服务的代理，往它身上赋值不生效：改定义 installBundle 的那一层原型（远程调用按名字取方法，会取到这里）
    let owner = Object.getPrototypeOf(pm)
    while (owner && !Object.prototype.hasOwnProperty.call(owner, 'installBundle')) owner = Object.getPrototypeOf(owner)
    if (!owner) { gate.reason = 'installBundle is not defined on the plugin manager class'; log.warn(gate.reason); return () => {} }
    const original = owner.installBundle
    const originalCancel = typeof owner.cancelInstall === 'function' ? owner.cancelInstall : null
    const originalWait = typeof owner.waitForInstall === 'function' ? owner.waitForInstall : null
    const wrapped = function installBundle(spec, options) {
      if (options?.requestId === undefined || options?.expected !== undefined) return original.call(this, spec, options)
      const id = randomUUID()
      const requestId = options.requestId
      const held = new Promise((resolve, reject) => {
        const timer = setTimeout(() => gate.decide(id, false, 'Nobody confirmed this install in Forsion'), INSTALL_TTL_MS)
        timer.unref?.()
        // DSH 插件页「允许这些脚本并重试」带着 approvedBuilds 再装一次：体检要知道用户在 DSH 里刚允许了哪些构建脚本
        const approvedBuilds = Array.isArray(options?.approvedBuilds) ? options.approvedBuilds.filter(x => typeof x === 'string') : []
        pending.set(id, { id, spec: String(spec), at: Date.now(), approvedBuilds, resolve, reject, timer })
      })
      log.info('install of %s held for review in Forsion', String(spec))
      const result = held.then(() => original.call(this, spec, options))
      byRequest.set(requestId, { id, result })
      const forget = () => { if (byRequest.get(requestId)?.result === result) byRequest.delete(requestId) }
      result.then(forget, forget)
      return result
    }
    // 还在等 Forsion 回话时，DSH 里点了取消：当用户拒绝（原来的 cancelInstall 不认得这次安装，会回 not-running）
    const wrappedCancel = async function cancelInstall(requestId) {
      const hold = byRequest.get(requestId)
      if (hold && pending.has(hold.id)) { gate.decide(hold.id, false, 'Cancelled in DSH'); return { status: 'cancelled' } }
      return originalCancel.call(this, requestId)
    }
    // 断线重连后 DSH 的界面按 requestId 取这次安装的结果：停住的那次给同一个结果（被拒 = 没有这次安装）
    const wrappedWait = async function waitForInstall(requestId) {
      const hold = byRequest.get(requestId)
      if (hold) return hold.result.catch(() => null)
      return originalWait.call(this, requestId)
    }
    try {
      owner.installBundle = wrapped
      if (originalCancel) owner.cancelInstall = wrappedCancel
      if (originalWait) owner.waitForInstall = wrappedWait
    } catch (error) { gate.reason = `installBundle could not be replaced: ${error?.message ?? error}`; log.warn(gate.reason); return () => {} }
    gate.armed = pm.installBundle === wrapped || owner.installBundle === wrapped
    gate.reason = gate.armed ? 'armed' : 'installBundle could not be replaced'
    return () => {
      if (owner.installBundle === wrapped) owner.installBundle = original
      if (originalCancel && owner.cancelInstall === wrappedCancel) owner.cancelInstall = originalCancel
      if (originalWait && owner.waitForInstall === wrappedWait) owner.waitForInstall = originalWait
      gate.armed = false; gate.reason = 'disarmed'
    }
  }
  if (typeof ctx.inject !== 'function') gate.reason = 'this DSH has no ctx.inject'
  else {
    ctx.inject(['pluginManager'], sub => {
      const undo = arm(sub.get?.('pluginManager') ?? sub.pluginManager)
      sub.effect(() => undo)
    })
  }
  return gate
}

// DSH 0.2.2 起 ctx.tools.execute 收一批调用（ToolBatchInput），0.2.1 是一次一个；按有没有 selectExecutor 判版本。
export async function executeTool(tools, { callId, name, args, signal, agent }) {
  if (typeof tools.selectExecutor !== 'function') {
    return tools.execute({ callId, name, arguments: args ?? {}, signal, ...(agent ? { agent } : {}) })
  }
  const out = await tools.execute({ calls: [{ type: 'tool-call', id: callId, name, arguments: JSON.stringify(args ?? {}) }], signal, ...(agent ? { agent } : {}) })
  const hit = out?.results?.find(r => r.callId === callId) ?? out?.results?.[0]
  if (!hit) throw new Error('DSH returned no result for the tool call')
  return hit.result
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
  const path = new URL(req.url ?? '/', 'http://127.0.0.1').pathname
  // 唯一不要启动密钥的口子：右栏页（DSH 自己的网页）凭地址里的口令报回做没做成。只写这一份回报，别的什么都碰不到。
  if (req.method === 'POST' && path === `${PREFIX}/rail/report`) {
    const nonce = String(req.headers['x-d2f-rail-nonce'] ?? '')
    let body = null
    try { body = JSON.parse(await readBody(req, MAX_RAIL_BODY)) } catch { return send(res, 400, { error: 'bad report' }) }
    return state.rail.accept(nonce, body) ? send(res, 200, { ok: true }) : send(res, 403, { error: 'unknown nonce or report' })
  }
  if (!authorized(req.headers['x-dsh2forsion-secret'], state.secret)) return send(res, 401, { error: 'unauthorized' })
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
  // 融合自检 + 装前体检用：桥在、装插件闸拦上了没有、全局工具和提示词分节（只给名字和字数）
  if (req.method === 'GET' && path === `${PREFIX}/fusion/check`) {
    const sections = promptSections(ctx).map(s => ({ name: s.name, chars: s.text.length }))
    let tools = []
    try { tools = ctx.tools.schemas().map(t => t.name) } catch { tools = [] }
    return send(res, 200, { ok: true, bridge: BRIDGE_VERSION, gate: state.gate.armed, gateReason: state.gate.reason, approvals: state.approvals.status(), tools, sections })
  }
  // 插件在 ACP 管道上看见 Forsion 的 session/prompt 进 / 回包出:先报到这里,再把那句交给 DSH
  if (req.method === 'POST' && path === `${PREFIX}/forsion-turns`) {
    const body = JSON.parse(await readBody(req))
    const ok = state.approvals.setForsionTurn(typeof body.sessionId === 'string' ? body.sessionId : '', body.id, body.active === true)
    return send(res, 200, { ok, approvals: state.approvals.status() })
  }
  if (req.method === 'GET' && path === `${PREFIX}/approvals`) return send(res, 200, state.approvals.status())
  // 右栏页：引擎半身要一个口令（放进右栏页地址的 #），之后凭口令取网页报回来的结果
  if (req.method === 'POST' && path === `${PREFIX}/rail/nonce`) return send(res, 200, { nonce: state.rail.issue() })
  if (req.method === 'GET' && path === `${PREFIX}/rail`) {
    return send(res, 200, state.rail.get(new URL(req.url ?? '/', 'http://127.0.0.1').searchParams.get('nonce') ?? ''))
  }
  if (req.method === 'GET' && path === `${PREFIX}/fusion/installs`) return send(res, 200, { armed: state.gate.armed, pending: state.gate.list() })
  if (req.method === 'POST' && path === `${PREFIX}/fusion/installs/decide`) {
    const body = JSON.parse(await readBody(req))
    return send(res, 200, { ok: state.gate.decide(String(body.id ?? ''), body.allow === true, typeof body.message === 'string' ? body.message.slice(0, 400) : undefined) })
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
          const result = await executeTool(ctx.tools, { callId, name: String(body.name), args: body.arguments ?? {}, signal, agent })
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

function readBody(req, max = MAX_BODY) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', chunk => {
      size += chunk.length
      if (size > max) { reject(new Error('body too large')); req.destroy(); return }
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
