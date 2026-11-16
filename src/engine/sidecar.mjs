// sidecar 进程：官方 Node 跑钉死的 DSH 运行时，起的是融合组合（网页界面 + 对话入口同一个进程）。
// - 网页界面只听 127.0.0.1 随机端口（写在组合配置里）；就绪的标志是 DSH 打印的 `dsh web: http://127.0.0.1:<port>/?token=…`。
// - 对话入口走 stdio：stdout 里的 JSON 行是 ACP 消息，交给 Forsion 的引擎（connection()）；不是 JSON 的行（含就绪行）进日志。
// - 启动令牌只在内存里：进日志的每一行都先把 token 抹掉，不落盘、不打印。
// - stdin 一直开着：ACP 入口读到 EOF 就会退出。
import { spawn } from 'node:child_process'
import { StringDecoder } from 'node:string_decoder'
import { randomBytes } from 'node:crypto'
import { PassThrough, Writable } from 'node:stream'
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'
import { PROFILE, READY_TIMEOUT_MS } from './constants.mjs'
import { childEnv } from './env.mjs'

const READY = /dsh web: (http:\/\/127\.0\.0\.1:\d+)\/\?token=(\S+)/
const LOG_LIMIT = 400
const BRIDGE_TIMEOUT_MS = 15_000
/** 报「Forsion 在这场会话上开始一轮」的上限:报不上也照样把那句交给 DSH(审批退回工作台提示,不卡住这句)。 */
const TURN_REPORT_MS = 1000

/** 进日志之前抹掉启动令牌（就绪行、DSH 自己可能打的登录地址）。 */
export function redact(line) {
  return String(line).replace(/([?&]token=)[^\s&"'<>]+/gi, '$1<redacted>')
}

export class Sidecar {
  /**
   * @param {ReturnType<import('./layout.mjs').layout>} paths
   * @param {{ home?: string, onState?: (s: any) => void, label?: string, cwd?: string, preload?: string, extraEnv?: Record<string,string> }} [opts]
   */
  constructor(paths, { home = paths.home, onState = () => {}, label = 'main', cwd, preload, extraEnv } = {}) {
    this.paths = paths
    this.home = home
    this.onState = onState
    this.label = label
    this.cwd = cwd ?? home
    this.preload = preload
    this.extraEnv = extraEnv ?? {}
    this.state = 'stopped' // stopped | starting | running | failed
    this.child = null
    this.base = null
    this.token = null
    this.secret = null
    this.error = null
    this.lines = []
    this.startedAt = null
    this.readyMs = null
    this.starting = null
    this.conn = null
    this.spawns = 0
  }

  snapshot() {
    return { state: this.state, pid: this.child?.pid ?? null, base: this.base, startedAt: this.startedAt, readyMs: this.readyMs, error: this.error, dshVersion: this.paths.dshVersion ?? null }
  }

  log(line) {
    this.lines.push(redact(line))
    if (this.lines.length > LOG_LIMIT) this.lines.splice(0, this.lines.length - LOG_LIMIT)
  }

  setState(state, error = null) {
    this.state = state
    this.error = error === null ? null : redact(error)
    this.onState(this.snapshot())
  }

  /** 已在跑就直接返回；正在启动就等同一次。 */
  start() {
    if (this.state === 'running') return Promise.resolve(this.snapshot())
    if (this.starting) return this.starting
    this.starting = this.spawnOnce().finally(() => { this.starting = null })
    return this.starting
  }

  /** 给 Forsion 引擎的 ACP 连接（registerResidentEngine 的 connect）。进程没在跑 → null。 */
  connection() {
    if (this.state !== 'running' || !this.conn) return null
    return this.conn
  }

  spawnOnce() {
    return new Promise((resolve, reject) => {
      this.secret = randomBytes(32).toString('hex')
      this.lines = []
      this.base = null
      this.token = null
      this.conn = null
      this.setState('starting')
      const t0 = Date.now()
      const env = childEnv(process.env, {
        binDir: this.paths.runtimePath,
        extra: { DSH_HOME: this.home, DSH2FORSION_SECRET: this.secret, DSH2FORSION_PARENT_PID: String(process.pid), DSH2FORSION_STDIO_NOTICES: '1', npm_config_store_dir: join(this.paths.cache, 'pnpm-store'), npm_config_update_notifier: 'false', ...this.extraEnv },
      })
      const args = [...(this.preload ? ['--import', pathToFileURL(this.preload).href] : []), this.paths.dshBin, '--profile', PROFILE]
      let child
      try {
        child = spawn(this.paths.nodeBin, args, { cwd: this.cwd, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
      } catch (error) {
        this.setState('failed', String(error.message ?? error))
        reject(error)
        return
      }
      this.child = child
      this.spawns += 1
      const output = new PassThrough()
      let exited
      const closed = new Promise(r => { exited = r })
      const turns = promptGate(this, child.stdin)
      const conn = { id: `${child.pid ?? 'x'}-${this.spawns}-${randomBytes(4).toString('hex')}`, input: turns.input, output, closed }
      child.stdin.on('error', () => { /* 进程退出时写半截：closed 会告诉对方 */ })
      let settled = false
      const onLine = (line, fromStdout) => {
        if (fromStdout && line.trimStart().startsWith('{')) { turns.onOutput(line); output.write(line + '\n'); return }
        if (!line.trim()) return
        this.log(line)
        const m = !settled && line.match(READY)
        if (m) {
          settled = true
          clearTimeout(timer)
          this.base = m[1]
          this.token = m[2]
          this.conn = conn
          this.startedAt = new Date().toISOString()
          this.readyMs = Date.now() - t0
          this.setState('running')
          resolve(this.snapshot())
        }
      }
      const reader = fromStdout => {
        let pending = ''
        // 一个多字节字符（中文）可能被拆在两块里：逐块 toString 会变成乱码，用流式解码器接上
        const decoder = new StringDecoder('utf8')
        return {
          data: chunk => {
            pending += decoder.write(chunk)
            const parts = pending.split(/\r?\n/)
            pending = parts.pop() ?? ''
            for (const line of parts) onLine(line, fromStdout)
          },
          flush: () => { pending += decoder.end(); if (pending) onLine(pending, fromStdout); pending = '' },
        }
      }
      const out = reader(true), err = reader(false)
      child.stdout.on('data', out.data)
      child.stderr.on('data', err.data)
      const timer = setTimeout(() => {
        if (settled) return
        settled = true
        this.setState('failed', 'DSH did not become ready in time')
        try { child.kill('SIGKILL') } catch { /* 已退出 */ }
        reject(new Error(this.error))
      }, READY_TIMEOUT_MS)
      child.once('error', error => {
        // 异步的启动失败（EACCES、ENOENT…）只有 error、不会再有 exit：这里就把 child 放掉，stop() 才不会干等
        if (this.child === child) this.child = null
        output.end()
        exited()
        if (settled) return
        settled = true
        clearTimeout(timer)
        this.setState('failed', String(error.message ?? error))
        reject(error)
      })
      child.once('exit', (code, signal) => {
        out.flush(); err.flush()
        output.end()
        exited()
        if (this.child === child) {
          this.child = null
          this.base = null
          this.token = null
          this.conn = null
        }
        if (!settled) {
          settled = true
          clearTimeout(timer)
          const why = this.lines.find(l => /startup failed|fatal|SyntaxError|Error:/.test(l)) ?? `exited with ${code ?? signal}`
          this.setState('failed', why.slice(0, 400))
          reject(new Error(this.error))
          return
        }
        if (this.state === 'running') this.setState(code === 0 || signal === 'SIGTERM' ? 'stopped' : 'failed', code === 0 || signal === 'SIGTERM' ? null : `exited with ${code ?? signal}`)
      })
    })
  }

  /** 有界停止：先 SIGTERM，等不到再 SIGKILL；SIGKILL 之后最多再等 2 秒，绝不无限期挂住。 */
  stop(graceMs = 4000) {
    const child = this.child
    const gone = !child || child.pid === undefined || child.exitCode !== null || child.signalCode !== null
    if (gone) {
      if (this.child === child) this.child = null
      if (this.state !== 'failed') this.setState('stopped')
      return Promise.resolve()
    }
    return new Promise(resolve => {
      let done = false
      const finish = () => { if (done) return; done = true; clearTimeout(kill); clearTimeout(giveUp); if (this.child === child) this.child = null; this.setState('stopped'); resolve() }
      const kill = setTimeout(() => { try { child.kill('SIGKILL') } catch { /* 已退出 */ } }, graceMs)
      const giveUp = setTimeout(finish, graceMs + 2000)
      child.once('exit', finish)
      try { child.kill('SIGTERM') } catch { finish() }
    })
  }

  /** 给桥发请求（带密钥）。 */
  async bridge(path, init = {}) {
    if (this.state !== 'running' || !this.base) throw new Error('DSH is not running')
    // 不带 signal 的调用（工具表、提示词、外观）限时 15 秒：DSH 的事件循环卡住时别把调用方一起挂住。
    // 工具执行带的是 Tangu 的 signal，由 Tangu 决定等多久
    const res = await fetch(`${this.base}/forsion-bridge${path}`, {
      ...init,
      signal: init.signal ?? AbortSignal.timeout(BRIDGE_TIMEOUT_MS),
      headers: { 'content-type': 'application/json', 'x-dsh2forsion-secret': this.secret, ...(init.headers ?? {}) },
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(body.error ?? `bridge ${path} → ${res.status}`)
    return body
  }

  /** 用 DSH 自己的登录 token 换 cookie，再调它的 /api 远程方法。 */
  async rpc(method, args = {}) {
    if (this.state !== 'running' || !this.base) throw new Error('DSH is not running')
    if (!this.cookie || this.cookieFor !== this.base) {
      const login = await fetch(`${this.base}/?token=${this.token}`, { redirect: 'manual', signal: AbortSignal.timeout(BRIDGE_TIMEOUT_MS) })
      this.cookie = (login.headers.get('set-cookie') ?? '').split(';')[0]
      this.cookieFor = this.base
    }
    const res = await fetch(`${this.base}/api/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: this.base, cookie: this.cookie },
      body: JSON.stringify({ type: 'client-request', rpcId: `d2f-${Date.now()}`, method, payload: { args } }),
      signal: AbortSignal.timeout(BRIDGE_TIMEOUT_MS),
    })
    const body = await res.json()
    if (!body?.result?.ok) throw new Error(body?.result?.error?.message ?? `rpc ${method} failed`)
    return body.result.value
  }

  /** 工作台用的登录地址（受控网页容器打开它换 cookie）。 */
  spaceUrl() {
    if (this.state !== 'running' || !this.base) return null
    return `${this.base}/?token=${this.token}`
  }
}

const parseLine = line => { try { return JSON.parse(line) } catch { return null } }

/**
 * Forsion → DSH 的 ACP 管道(融合进程的 stdin)。Forsion 的 session/prompt 先报给桥(这场会话有 Forsion 的一轮在跑,
 * DSH 要问的审批问到 Forsion 的审批卡),报完再交给 DSH;它的回包从 stdout 出来时报「这一轮完了」(onOutput)。
 * 只看 session/prompt 的请求与回包这一层 ACP 协议,别的原样转过去。
 */
export function promptGate(sidecar, stdin, { retryMs = [500, 1000, 2000] } = {}) {
  const pending = new Map() // ACP 请求 id → sessionId
  const decoder = new StringDecoder('utf8')
  let buf = ''
  const post = (sessionId, id, active) => sidecar.bridge('/forsion-turns', {
    method: 'POST', body: JSON.stringify({ sessionId, id, active }), signal: AbortSignal.timeout(TURN_REPORT_MS),
  })
  const failed = error => sidecar.log(`[dsh2forsion] reporting a Forsion turn to the bridge failed: ${error?.message ?? error}`)
  // 开始只报一次(不能让那句话多等);结束要重试:报丢了桥会把这场当成 Forsion 的轮最多 6 小时,
  // 其间工作台用 /plan 之类起的轮(来源只有 { kind: 'user' })的审批会被交给对话入口,Forsion 没在跑就回取消 = 吞掉
  const report = (sessionId, id, active) => post(sessionId, id, active).catch(failed)
  const reportEnd = async (sessionId, id) => {
    for (let attempt = 0; ; attempt++) {
      try { await post(sessionId, id, false); return } catch (error) {
        if (attempt >= retryMs.length || (sidecar.state !== undefined && sidecar.state !== 'running')) return failed(error) // 进程没了,桥的记录跟着没了
        await new Promise(resolve => setTimeout(resolve, retryMs[attempt]))
      }
    }
  }
  const put = data => new Promise(resolve => {
    if (stdin.destroyed || !stdin.writable) return resolve()
    if (stdin.write(data)) return resolve()
    const done = () => { stdin.off('drain', done); stdin.off('close', done); resolve() }
    stdin.once('drain', done)
    stdin.once('close', done)
  })
  const input = new Writable({
    write(chunk, _enc, cb) {
      buf += decoder.write(chunk)
      ;(async () => {
        let i
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i + 1)
          buf = buf.slice(i + 1)
          const m = line.includes('"session/prompt"') ? parseLine(line) : null
          if (m?.method === 'session/prompt' && m.id != null && typeof m.params?.sessionId === 'string') {
            pending.set(m.id, m.params.sessionId)
            await report(m.params.sessionId, m.id, true)
          }
          await put(line)
        }
      })().then(() => cb(), cb)
    },
    final(cb) {
      buf += decoder.end()
      if (buf && !stdin.destroyed) stdin.write(buf)
      buf = ''
      stdin.end()
      cb()
    },
  })
  input.on('error', () => { /* 进程退出时写半截:closed 会告诉对方 */ })
  const onOutput = line => {
    if (!pending.size || line.length > 8192 || line.includes('"session/update"')) return
    const m = parseLine(line)
    if (!m || m.method !== undefined || m.id == null || !pending.has(m.id)) return
    const sessionId = pending.get(m.id)
    pending.delete(m.id)
    void reportEnd(sessionId, m.id)
  }
  return { input, onOutput, pending }
}
