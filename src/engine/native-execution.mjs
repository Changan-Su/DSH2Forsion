// Native task ownership stays in Tangu. DSH holds only an opaque execution reference.
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { createServer } from 'node:http'
import { mkdir, readFile, realpath, rename, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute } from 'node:path'

const terminal = new Set(['succeeded', 'failed', 'cancelled'])
const id = (kind, value) => {
  const h = createHash('sha256').update(`dsh2forsion:${kind}:${value}`).digest('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`
}
const message = error => String(error?.message ?? error)
const required = (value, name, max = 512) => {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`Invalid ${name}`)
  return value
}

export class NativeExecution {
  constructor({ runs, file, enabled = () => true, navigationTimeoutMs = 15_000 }) {
    this.runs = runs
    this.file = file
    this.enabled = enabled
    this.navigationTimeoutMs = navigationTimeoutMs
    this.data = { version: 1, userId: null, context: null, projects: {}, executions: {} }
    this.queue = Promise.resolve()
    this.locks = new Map()
    this.events = new Map()
    this.secret = randomBytes(32).toString('hex')
    this.disposed = false
    this.server = null
    this.ready = this.load()
  }

  async load() {
    let text
    try { text = await readFile(this.file, 'utf8') } catch (error) { if (error.code === 'ENOENT') return; throw error }
    const data = JSON.parse(text)
    if (data?.version !== 1 || !data.projects || !data.executions || typeof data.projects !== 'object' || typeof data.executions !== 'object' || Array.isArray(data.projects) || Array.isArray(data.executions)) throw new Error('Invalid native task ledger; refusing to overwrite it')
    for (const [key, record] of Object.entries(data.executions)) {
      if (!record || record.executionId !== key || !record.sessionId || !record.runId || !record.intent || !data.userId) throw new Error('Invalid native task record')
    }
    this.data = data
  }

  check(userId) {
    if (this.disposed || !this.enabled()) throw new Error('Native compatibility is disabled')
    if (!this.runs?.context || !this.runs?.start) throw new Error('Update Forsion to use native task execution')
    if (userId !== undefined && (!userId || (this.data.userId && this.data.userId !== userId))) throw new Error('Native view belongs to another local user')
  }

  async save(change) {
    const work = this.queue.then(async () => {
      this.check()
      // Never publish in-memory changes if the atomic disk write failed.
      const next = structuredClone(this.data)
      const result = change(next)
      await mkdir(dirname(this.file), { recursive: true })
      const temp = `${this.file}.${randomUUID()}.tmp`
      await writeFile(temp, JSON.stringify(next, null, 2), { mode: 0o600 })
      this.check()
      await rename(temp, this.file)
      this.data = next
      return result
    })
    this.queue = work.catch(() => {})
    return work
  }

  async project(path) {
    if (typeof path !== 'string' || !isAbsolute(path)) throw new Error('Select an absolute project directory in Tangu')
    const cwd = await realpath(path)
    if (!(await stat(cwd)).isDirectory()) throw new Error('Project is not a directory')
    return { id: id('project', process.platform === 'win32' ? cwd.toLowerCase() : cwd), path: cwd, name: basename(cwd) || cwd }
  }

  async configure(userId, { sessionId, models = [] } = {}) {
    await this.ready
    this.check(userId)
    const current = await this.runs.context(required(sessionId, 'active Tangu session'), userId)
    const workspace = await this.project(current.cwd)
    const catalog = (Array.isArray(models) ? models : []).slice(0, 1000).filter(m => typeof m?.id === 'string' && m.id.length < 512)
      .map(m => ({ id: m.id, name: String(m.name || m.id).slice(0, 200), ...(typeof m.provider === 'string' ? { provider: m.provider } : {}) }))
    if (current.modelId && !catalog.some(m => m.id === current.modelId)) catalog.push({ id: current.modelId, name: current.modelId })
    this.check(userId)
    await this.save(data => {
      if (data.userId && data.userId !== userId) throw new Error('Native view belongs to another local user')
      data.userId = userId
      data.projects[workspace.id] = workspace
      data.context = { ...current, cwd: workspace.path, workspace, models: catalog }
    })
    return this.context()
  }

  context() {
    this.check()
    const context = this.data.context
    if (!context || !this.data.userId) throw new Error('Open this view from a Tangu project session first')
    return { cwd: context.cwd, workspace: context.workspace, workspaces: Object.values(this.data.projects), models: context.models,
      defaultModelId: context.modelId, currentSessionId: context.sessionId, agentModes: [{ id: 'tangu', name: 'Tangu' }] }
  }

  async exclusive(key, fn) {
    const before = this.locks.get(key) || Promise.resolve()
    const work = before.catch(() => {}).then(fn)
    this.locks.set(key, work)
    try { return await work } finally { if (this.locks.get(key) === work) this.locks.delete(key) }
  }

  record(payload) {
    const executionId = payload.executionId ?? (String(payload.sessionId || '').startsWith('forsion-task:') ? payload.sessionId.slice(13) : null)
    const record = executionId ? (Object.hasOwn(this.data.executions, executionId) ? this.data.executions[executionId] : null) : Object.values(this.data.executions).find(r => r.sessionId === payload.sessionId && (!payload.runId || r.runId === payload.runId))
    if (!record) throw new Error('Unknown native execution')
    return record
  }

  async startRecord(record) {
    this.check()
    if (record.cancelRequested) return { sessionId: record.sessionId, runId: record.runId }
    const result = await this.runs.start({ ...record.intent, userId: this.data.userId, sessionId: record.sessionId, requestId: record.runId })
    if (result.sessionId !== record.sessionId || result.runId !== record.runId) throw new Error('Native run identity mismatch')
    await this.save(data => { data.executions[record.executionId].started = true })
    return result
  }

  async launch(payload) {
    const executionId = required(payload.executionId, 'execution ID')
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(executionId) || ['constructor', 'prototype', '__proto__'].includes(executionId)) throw new Error('Invalid execution ID')
    return this.exclusive(executionId, async () => {
      const context = this.context()
      const workspace = await this.project(payload.cwd || context.cwd)
      if (!this.data.projects[workspace.id] || (payload.workspaceId && payload.workspaceId !== workspace.id)) throw new Error('Project has not been selected in the native view')
      if (payload.mode && payload.mode !== 'tangu') throw new Error(`Unsupported agent mode: ${payload.mode}`)
      const permission = payload.permission || 'default'
      if (!['default', 'readonly', 'read-only', 'auto-edit', 'workspace-write'].includes(permission)) throw new Error(`Unsupported permission mode: ${permission}`)
      const modelId = payload.modelId || context.defaultModelId
      if (!modelId || !context.models.some(m => m.id === modelId)) throw new Error('Select an available Tangu model')
      const prompt = required(payload.prompt, 'prompt', 100_000)
      const resumed = payload.resumeExecutionId ? this.record({ executionId: required(payload.resumeExecutionId, 'resume execution ID') }) : null
      if (resumed && resumed.intent.cwd !== workspace.path) throw new Error('Cannot resume a task in a different project')
      const intent = { prompt, cwd: workspace.path, modelId, parentSessionId: context.currentSessionId,
        title: String(payload.title || prompt).slice(0, 200), readOnly: ['readonly', 'read-only'].includes(permission),
        ...(payload.reasoningEffort ? { thinkingLevel: required(payload.reasoningEffort, 'reasoning effort', 64) } : {}) }
      const fingerprint = createHash('sha256').update(JSON.stringify({ taskId: payload.taskId, prompt, cwd: intent.cwd, modelId, readOnly: intent.readOnly, thinkingLevel: intent.thinkingLevel, resumeExecutionId: payload.resumeExecutionId })).digest('hex')
      let record = this.data.executions[executionId]
      if (record && record.fingerprint !== fingerprint) throw new Error('Execution ID already used with different input')
      if (!record) {
        if (Object.keys(this.data.executions).length >= 10_000) throw new Error('Native task ledger is full')
        record = { executionId, taskId: required(payload.taskId, 'task ID'), fingerprint, intent,
          sessionId: resumed?.sessionId || id('session', `${this.data.userId}:${executionId}`), runId: id('run', `${this.data.userId}:${executionId}`), started: false, cancelRequested: false }
        await this.save(data => { data.executions[executionId] = record })
      }
      return this.startRecord(record)
    })
  }

  async statusRecord(record, recover = true) {
    this.check()
    let result
    try { result = await this.runs.status(record.runId, this.data.userId) } catch (error) {
      if (error.code !== 'RUN_NOT_FOUND') throw error
      if (record.cancelRequested) return { state: 'cancelled' }
      if (recover && !record.started) { await this.startRecord(record); return this.statusRecord(this.data.executions[record.executionId], false) }
      return { state: 'unknown', error: 'Native run could not be found' }
    }
    if (record.cancelRequested && !['done', 'error', 'aborted'].includes(result.status)) {
      // A crash can occur after persisting cancellation and before sending stop.
      // Retry the idempotent native stop when reconciling; never relaunch this intent.
      await this.runs.stop(record.runId, this.data.userId)
      result = await this.runs.status(record.runId, this.data.userId)
    }
    const state = { queued: 'queued', running: 'running', done: 'succeeded', error: 'failed', aborted: 'cancelled' }[result.status] || 'unknown'
    return { state: !terminal.has(state) && result.waiting?.length ? 'waiting' : state, summary: result.summary || '', error: result.error || undefined, waiting: result.waiting || [] }
  }

  async cancel(payload) {
    const initial = this.record(payload)
    return this.exclusive(initial.executionId, async () => {
      await this.save(data => { data.executions[initial.executionId].cancelRequested = true })
      const record = this.data.executions[initial.executionId]
      try { await this.runs.stop(record.runId, this.data.userId) } catch (error) { if (error.code !== 'RUN_NOT_FOUND') throw error }
      const status = await this.statusRecord(record, false)
      return { ...status, settled: terminal.has(status.state) }
    })
  }

  async invoke({ adapter, version, op, payload = {} } = {}) {
    await this.ready
    this.check()
    if (adapter !== 'task-board' || version !== 1) throw new Error('Unsupported native adapter protocol')
    if (op === 'context') return this.context()
    this.context()
    if (op === 'launch') return this.launch(payload)
    if (op === 'status') return this.exclusive(this.record(payload).executionId, () => this.statusRecord(this.record(payload)))
    if (op === 'cancel') return this.cancel(payload)
    if (op === 'list') return { known: true, items: await Promise.all(Object.values(this.data.executions).map(async r => ({ executionId: r.executionId, sessionId: r.sessionId, runId: r.runId, ...(await this.exclusive(r.executionId, () => this.statusRecord(this.data.executions[r.executionId]))) }))) }
    if (op === 'createWorkspace') {
      const workspace = await this.project(payload.path)
      await this.save(data => { data.projects[workspace.id] = workspace })
      return workspace
    }
    if (op === 'openSession') {
      let sessionId
      if (!payload.executionId && payload.sessionId === this.data.context.sessionId) {
        // The panel's back button may return only to its authenticated parent.
        await this.runs.context(payload.sessionId, this.data.userId)
        sessionId = payload.sessionId
      } else {
        const record = this.record(payload)
        await this.runs.status(record.runId, this.data.userId) // Recheck native ownership before navigation.
        sessionId = record.sessionId
      }
      return new Promise((resolve, reject) => {
        const eventId = randomUUID()
        const timer = setTimeout(() => { this.events.delete(eventId); reject(new Error('The Forsion view did not acknowledge navigation')) }, this.navigationTimeoutMs)
        this.events.set(eventId, { eventId, type: 'openSession', sessionId, timer, resolve, reject })
      })
    }
    throw new Error(`Unsupported native operation: ${op}`)
  }

  async pendingEvents(userId) {
    await this.ready; this.check(userId)
    return { events: [...this.events.values()].map(({ eventId, type, sessionId }) => ({ eventId, type, sessionId })) }
  }

  async acknowledge(userId, { eventId, error } = {}) {
    await this.ready; this.check(userId)
    const event = this.events.get(eventId)
    if (!event) throw new Error('Navigation request has expired')
    this.events.delete(eventId); clearTimeout(event.timer)
    if (error) event.reject(new Error(String(error).slice(0, 500)))
    else event.resolve({ opened: true })
    return { ok: true }
  }

  async listen() {
    await this.ready; this.check()
    if (this.server) return this.endpoint
    this.server = createServer(async (req, res) => {
      const respond = (code, body) => { if (!res.destroyed) { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)) } }
      try {
        const header = req.headers['x-dsh2forsion-native']
        if (req.headers.origin || typeof header !== 'string' || header.length !== this.secret.length || !timingSafeEqual(Buffer.from(header), Buffer.from(this.secret))) return respond(401, { error: 'unauthorized' })
        if (req.method !== 'POST' || req.url !== '/invoke') return respond(404, { error: 'not found' })
        const chunks = []
        let bytes = 0
        for await (const chunk of req) {
          bytes += chunk.length
          if (bytes > 1 << 20) return respond(413, { error: 'body too large' })
          chunks.push(chunk)
        }
        respond(200, await this.invoke(JSON.parse(Buffer.concat(chunks).toString('utf8'))))
      } catch (error) { respond(400, { error: message(error) }) }
    })
    await new Promise((resolve, reject) => { this.server.once('error', reject); this.server.listen(0, '127.0.0.1', resolve) })
    this.endpoint = { url: `http://127.0.0.1:${this.server.address().port}/invoke`, secret: this.secret }
    return this.endpoint
  }

  async dispose() {
    this.disposed = true
    for (const event of this.events.values()) { clearTimeout(event.timer); event.reject(new Error('Native view was disabled')) }
    this.events.clear()
    if (this.server) { this.server.closeAllConnections(); await new Promise(resolve => this.server.close(resolve)) }
    await this.queue
    // Native runs and history intentionally survive a UI toggle and remain accessible in Tangu.
  }
}
