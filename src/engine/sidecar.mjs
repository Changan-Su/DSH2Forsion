// sidecar 进程：官方 Node 跑钉死的 DSH 运行时，只听 127.0.0.1 随机端口。
// 每次启动生成新密钥交给桥；就绪的标志是 DSH 打印的 `dsh web: http://127.0.0.1:<port>/?token=…`。
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { PROFILE, READY_TIMEOUT_MS } from './constants.mjs'
import { childEnv } from './env.mjs'

const READY = /dsh web: (http:\/\/127\.0\.0\.1:\d+)\/\?token=(\S+)/
const LOG_LIMIT = 400
const BRIDGE_TIMEOUT_MS = 15_000

export class Sidecar {
  /** @param {ReturnType<import('./layout.mjs').layout>} paths */
  constructor(paths, { home = paths.home, onState = () => {}, label = 'main' } = {}) {
    this.paths = paths
    this.home = home
    this.onState = onState
    this.label = label
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
  }

  snapshot() {
    return { state: this.state, pid: this.child?.pid ?? null, base: this.base, startedAt: this.startedAt, readyMs: this.readyMs, error: this.error }
  }

  log(line) {
    this.lines.push(line)
    if (this.lines.length > LOG_LIMIT) this.lines.splice(0, this.lines.length - LOG_LIMIT)
  }

  setState(state, error = null) {
    this.state = state
    this.error = error
    this.onState(this.snapshot())
  }

  /** 已在跑就直接返回；正在启动就等同一次。 */
  start() {
    if (this.state === 'running') return Promise.resolve(this.snapshot())
    if (this.starting) return this.starting
    this.starting = this.spawnOnce().finally(() => { this.starting = null })
    return this.starting
  }

  spawnOnce() {
    return new Promise((resolve, reject) => {
      this.secret = randomBytes(32).toString('hex')
      this.lines = []
      this.base = null
      this.token = null
      this.setState('starting')
      const t0 = Date.now()
      const env = childEnv(process.env, {
        binDir: this.paths.runtimePath,
        extra: { DSH_HOME: this.home, DSH2FORSION_SECRET: this.secret, DSH2FORSION_PARENT_PID: String(process.pid), npm_config_store_dir: join(this.paths.cache, 'pnpm-store'), npm_config_update_notifier: 'false' },
      })
      let child
      try {
        child = spawn(this.paths.nodeBin, [this.paths.dshBin, '--profile', PROFILE, '--host', '127.0.0.1', '--port', '0', '--no-open'], {
          cwd: homedir(), env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
        })
      } catch (error) {
        this.setState('failed', String(error.message ?? error))
        reject(error)
        return
      }
      this.child = child
      let settled = false
      let pending = ''
      const onData = chunk => {
        pending += chunk.toString('utf8')
        const parts = pending.split(/\r?\n/)
        pending = parts.pop() ?? ''
        for (const line of parts) {
          if (!line.trim()) continue
          this.log(line)
          const m = !settled && line.match(READY)
          if (m) {
            settled = true
            clearTimeout(timer)
            this.base = m[1]
            this.token = m[2]
            this.startedAt = new Date().toISOString()
            this.readyMs = Date.now() - t0
            this.setState('running')
            resolve(this.snapshot())
          }
        }
      }
      child.stdout.on('data', onData)
      child.stderr.on('data', onData)
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
        if (settled) return
        settled = true
        clearTimeout(timer)
        this.setState('failed', String(error.message ?? error))
        reject(error)
      })
      child.once('exit', (code, signal) => {
        if (pending.trim()) this.log(pending)
        this.child = null
        this.base = null
        this.token = null
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

  /** DSH Space 用的登录地址（webview 打开它换 cookie）。 */
  spaceUrl() {
    if (this.state !== 'running' || !this.base) return null
    return `${this.base}/?token=${this.token}`
  }
}
