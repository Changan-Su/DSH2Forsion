// 融合进程里 DSH 自己的审批往哪走(审批 B:提前进第 1 档)。
//
// DSH 的审批是 cordis 的 waterfall 事件 approval/request(dsh-user-approval 发,提权写文件和插件在 tools/pre-execute 里要问的
// 都走它)。网页界面(dsh-api-remotes)挂的那一环把它排进网页的待办、不往下传;对话入口(dsh-acp)那一环只认它自己开着的
// 会话、把它问给 ACP 客户端(Forsion)。两头开在一个进程里时网页那环在前,Forsion 的轮碰到审批就停在工作台里
// (方案目录 instrument/evidence/resident-approval.txt)。
//
// 这里在链首挂一环(桥的 index.js 用 prepend 挂):
//  - 这场会话有 Forsion 的一轮在跑(插件在 ACP 管道上看见 session/prompt 进、回包出,经 /forsion-turns 告诉桥,
//    而且是先告诉桥、再把那句交给 DSH),且眼下这一轮不是网页发起的 → 直接调 dsh-acp 那一环,问到 Forsion 的审批卡;
//    dsh-acp 不认(不是它开着的会话、没有 callId)就照常往下传。
//  - 其余照常往下传:工作台自己发的轮留在工作台。
// 每次接管前自检(见 check()),对不上就整块退回 A:不接管,日志写明原因。
// 不管接没接管,进了工作台的审批都经 ACP 扩展通知 `_forsion/notice` 报给 Forsion(那场会话 Forsion 正等着时它显示
// 「DSH 在工作台里等你批准」+「打开工作台」)。这条靠会话落盘的 approval/asked / approval/decided 发现,不靠 waterfall:
// 事件名改了、接管挂不上时照样提示,Forsion 的轮不会无声停住。
//
// 依赖的 DSH 内部结构(PR / MAPPING 里同一份清单)。1–3 由 check() 在每次启动和接管前查,跟版 CI 把结果记进运行时清单
// (selfCheck.approvals,只记不拦);4、5 要真跑一轮才看得出,只有 npm run test:approvals 覆盖,换钉死的 DSH 版本时手动跑:
//  1. cordis 事件表 `ctx.events._hooks[事件名]` 是 `{ ctx, callback }` 的数组,waterfall 按数组顺序调,prepend = 放到最前;
//     `hook.ctx.fiber.name` 是挂它的插件名(模块的 `name` 导出)。
//  2. 审批事件名 `approval/request`,参数 `(request, next)`,request 带 `agent`(agent.session.id = ACP 的 sessionId)、`callId`。
//  3. dsh-acp 的插件名是 `acp`,它那一环对不是它开着的会话同步调 next()(自检拿一个假会话实调一次)。
//  4. `agent/inbox/claimed` 的参数 `{ agent, message, turn }`,网页发的消息 `message.source` 带 `rpcId`(dsh-api-session-controller)。
//  5. `session/event` 的参数 `(session, event)`:`session.header.id` / `origin` / `parentSession`;event.type 有
//     `approval/asked`(data.id / callId / toolName)、`approval/decided`(data.id)、`turn/end`(data.turn)。
import { randomUUID } from 'node:crypto'

export const APPROVAL_EVENT = 'approval/request'
export const ACP_PLUGIN = 'acp'
export const NOTICE_METHOD = '_forsion/notice'
/** approval/asked 先落盘、waterfall 后跑:等接管那一环跑完再判这次进没进工作台。 */
const NOTICE_DELAY_MS = 250
/** 插件没来得及说「这一轮完了」(DSH 被强杀)时,记着的轮最多留这么久。 */
const TURN_TTL_MS = 6 * 3600_000

const NOTICE_TEXT = { zh: 'DSH 在工作台里等你批准', en: 'DSH is waiting for your approval in the workbench' }
/** 按钮 = 渲染半身登记的对话菜单项(先 hold 再落到那场);id 必须和它一致,check-renderer 钉着。 */
export const NOTICE_ACTION = { id: 'open-in-workbench', label: { zh: '打开工作台', en: 'Open the workbench' } }

/** 这一轮第一条消息是谁发的:网页的 session/prompt 带 rpcId;别的(对话入口、/plan、/goal、子代理)都只是 { kind: 'user' } 之类。 */
export function startedInWorkbench(source) {
  return !!source && typeof source === 'object' && Object.prototype.hasOwnProperty.call(source, 'rpcId')
}

const short = id => String(id ?? '').slice(0, 8)
const nameOf = hook => { try { return hook?.ctx?.fiber?.name } catch { return undefined } }
const fiberOf = hook => { try { return hook?.ctx?.fiber } catch { return undefined } }

/**
 * @param {{ events: () => any, ownName: string, log: { info: Function, warn: Function }, eventName?: string,
 *   write?: ((line: string) => void) | null, now?: () => number, delay?: (fn: () => void, ms: number) => any, cancel?: (t: any) => void }} opts
 */
export function createApprovalRouter({ events, ownName, log, eventName = APPROVAL_EVENT, write = null, now = Date.now, delay = setTimeout, cancel = clearTimeout }) {
  /** sessionId → { turn, workbench }:眼下这一轮(按第一条被领走的消息判是不是网页发起的)。 */
  const turns = new Map()
  /** sessionId → Map<promptId, since>:Forsion 在这场会话上正在跑的轮(插件报的)。 */
  const forsion = new Map()
  /** 子代理会话 → 父会话(提示挂到 Forsion 那场对话上)。 */
  const parents = new Map()
  /** 接管给了 Forsion 的 callId(落盘的 approval/asked 据此判它没进工作台)。 */
  const taken = new Set()
  /** approval id → { sessionId, timer, shown }。 */
  const asked = new Map()
  const shapes = new WeakMap()
  let last = { ok: false, reason: 'not checked yet' }

  const fail = reason => ({ ok: false, reason })
  const report = result => {
    if (result.ok !== last.ok || result.reason !== last.reason) {
      if (result.ok) log.info('approvals: Forsion turns ask in Forsion (DSH ACP link found on "%s")', eventName)
      else log.warn('approvals: falling back to the workbench prompt: %s', result.reason)
    }
    last = result
    return result
  }

  // dsh-acp 那一环对「不是它开着的会话」该同步调 next() 并把 next 的结果原样交回:拿一个不存在的会话实调一次。
  const shapeOf = callback => {
    if (shapes.has(callback)) return shapes.get(callback)
    const marker = { probe: true }
    let calls = 0, verdict
    try {
      const out = Reflect.apply(callback, undefined, [
        { agent: { session: { id: `dsh2forsion-selfcheck-${randomUUID()}` } }, callId: 'dsh2forsion-selfcheck', toolName: 'dsh2forsion-selfcheck' },
        () => { calls += 1; return marker },
      ])
      verdict = calls === 1 && out === marker ? true : `DSH's ACP link did not pass on a request for a session it does not own (next called ${calls}×)`
    } catch (error) {
      verdict = `DSH's ACP link threw on a request for a session it does not own: ${error?.message ?? error}`
    }
    shapes.set(callback, verdict)
    return verdict
  }

  /** 自检:能不能接管。返回 { ok, reason, acp }。 */
  function check() {
    let table
    try { table = events()?._hooks } catch (error) { return report(fail(`cordis event table is not readable: ${error?.message ?? error}`)) }
    if (!table || typeof table !== 'object') return report(fail('cordis event table (ctx.events._hooks) is not readable'))
    const list = Array.isArray(table[eventName]) ? table[eventName] : []
    if (!list.some(h => nameOf(h) === ownName)) return report(fail(`the bridge link is not on "${eventName}"`))
    if (nameOf(list[0]) !== ownName) return report(fail(`"${nameOf(list[0]) ?? 'another module'}" runs before the bridge on "${eventName}"`))
    const acps = list.filter(h => nameOf(h) === ACP_PLUGIN)
    if (acps.length !== 1) return report(fail(acps.length ? `${acps.length} ACP links on "${eventName}"` : `DSH's ACP module has no link on "${eventName}"`))
    const acp = acps[0]
    if (typeof acp.callback !== 'function') return report(fail(`DSH's ACP link on "${eventName}" is not a function`))
    for (const ev of ['agent/inbox/claimed', 'session/event']) {
      const l = Array.isArray(table[ev]) ? table[ev] : []
      if (!l.some(h => fiberOf(h) === fiberOf(acp))) return report(fail(`DSH's ACP module no longer listens to "${ev}"`))
      if (!l.some(h => nameOf(h) === ownName)) return report(fail(`the bridge is not listening to "${ev}"`))
    }
    const shape = shapeOf(acp.callback)
    if (shape !== true) return report(fail(shape))
    return report({ ok: true, reason: 'ok', acp: acp.callback })
  }

  const rootOf = sessionId => {
    let id = sessionId
    for (let i = 0; i < 16 && parents.has(id); i++) id = parents.get(id)
    return id
  }
  const forsionActive = sessionId => {
    const m = forsion.get(sessionId)
    if (!m) return false
    for (const [id, since] of m) if (now() - since > TURN_TTL_MS) m.delete(id)
    if (!m.size) forsion.delete(sessionId)
    return m.size > 0
  }
  const emit = params => {
    if (!write) return
    try { write(JSON.stringify({ jsonrpc: '2.0', method: NOTICE_METHOD, params }) + '\n') }
    catch (error) { log.warn('approvals: could not tell Forsion: %s', error?.message ?? error) }
  }

  return {
    check,
    status() { const r = check(); return { mode: r.ok ? 'forsion' : 'workbench', reason: r.reason, event: eventName } },

    /** 插件报:Forsion 在 sessionId 上开始 / 结束一轮(promptId = ACP 请求 id)。 */
    setForsionTurn(sessionId, promptId, active) {
      if (typeof sessionId !== 'string' || !sessionId) return false
      const key = String(promptId ?? '')
      if (active) {
        let m = forsion.get(sessionId)
        if (!m) forsion.set(sessionId, m = new Map())
        m.set(key, now())
        // 这场(含子代理)在工作台里已经有待批的:当时没有 Forsion 的轮在跑,宿主把提示丢了;这一轮排在它后面,再说一次
        for (const item of asked.values()) if (item.shown && item.sessionId === sessionId) emit(item.notice)
      } else {
        forsion.get(sessionId)?.delete(key)
        if (!forsion.get(sessionId)?.size) forsion.delete(sessionId)
      }
      return true
    },
    forsionActive,

    /** 链首那一环(在 Forsion 已批过的工具调用之后)。thisArg = waterfall 的接收者,原样交给 dsh-acp 那一环。 */
    link(thisArg, req, next) {
      const sid = req?.agent?.session?.id
      if (typeof sid !== 'string' || !forsionActive(sid)) return next()
      if (turns.get(sid)?.workbench) {
        log.info('approval on %s: this turn was started in the workbench; it stays there', short(sid))
        return next()
      }
      const r = check()
      if (!r.ok) {
        log.warn('approval on %s (%s) goes to the workbench: %s', short(sid), String(req.toolName ?? ''), r.reason)
        return next()
      }
      let passed = false
      const out = Reflect.apply(r.acp, thisArg, [req, () => { passed = true; return next() }])
      if (passed) {
        log.info('approval on %s (%s): DSH\'s ACP side did not take it; it goes to the workbench', short(sid), String(req.toolName ?? ''))
        return out
      }
      if (req.callId !== undefined) {
        const callId = req.callId
        taken.add(callId)
        // 两个分支都接住:finally 派生出的那个 promise 没人接,acp 那一环 reject 时会成未处理的 rejection,DSH 收到就退出整个进程
        const forget = () => { delay(() => taken.delete(callId), 10_000) }
        Promise.resolve(out).then(forget, forget)
      }
      log.info('approval on %s (%s) asks in Forsion', short(sid), String(req.toolName ?? ''))
      return out
    },

    onClaim({ agent, message, turn } = {}) {
      const sid = agent?.session?.id
      if (typeof sid !== 'string') return
      const cur = turns.get(sid)
      if (cur && cur.turn === turn) return // 这一轮的第一条已经判过
      turns.set(sid, { turn, workbench: startedInWorkbench(message?.source) })
    },

    onSessionEvent(session, event) {
      const sid = session?.header?.id
      if (typeof sid !== 'string' || !event) return
      if (session.header.origin === 'subagent' && typeof session.header.parentSession === 'string') parents.set(sid, session.header.parentSession)
      const data = event.data ?? {}
      if (event.type === 'turn/end') {
        if (turns.get(sid)?.turn === data.turn) turns.delete(sid)
        return
      }
      if (event.type === 'approval/asked' && data.id !== undefined) {
        const id = String(data.id)
        const callId = data.callId
        const item = { sessionId: rootOf(sid), timer: null, shown: false, notice: null }
        item.timer = delay(() => {
          item.timer = null
          if (callId !== undefined && taken.has(callId)) { asked.delete(id); return }
          item.shown = true
          item.notice = { sessionId: item.sessionId, id: `dsh-approval-${id}`, kind: 'approval-elsewhere', text: NOTICE_TEXT, action: NOTICE_ACTION }
          if (forsionActive(item.sessionId)) log.info('approval on %s (%s) is waiting in the workbench; telling Forsion', short(item.sessionId), String(data.toolName ?? ''))
          emit(item.notice)
        }, NOTICE_DELAY_MS)
        asked.set(id, item)
        return
      }
      if (event.type === 'approval/decided' && data.id !== undefined) {
        const id = String(data.id)
        const item = asked.get(id)
        if (!item) return
        asked.delete(id)
        if (item.timer) cancel(item.timer)
        if (item.shown) emit({ sessionId: item.sessionId, id: `dsh-approval-${id}`, clear: true })
      }
    },

    dispose() {
      for (const item of asked.values()) if (item.timer) cancel(item.timer)
      asked.clear(); taken.clear(); turns.clear(); forsion.clear(); parents.clear()
    },
  }
}
