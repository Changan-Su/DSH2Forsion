// Bridge-owned attribution agents, never model drivers or copies of Tangu history.
// Callers authenticate the native session and send only SHA-256([userId,sessionId]).
import { realpath, stat } from 'node:fs/promises'
import { isAbsolute } from 'node:path'

const combine = (...signals) => AbortSignal.any(signals.filter(Boolean))
function waitFor(promise, signal) {
  signal?.throwIfAborted()
  if (!signal) return promise
  let cancel
  const aborted = new Promise((_resolve, reject) => {
    cancel = () => reject(signal.reason)
    signal.addEventListener('abort', cancel, { once: true })
  })
  return Promise.race([promise, aborted]).finally(() => signal.removeEventListener('abort', cancel))
}

export class SessionScopePool {
  constructor(ctx) {
    this.ctx = ctx
    this.entries = new Map()
    this.abort = new AbortController()
    this.disposing = null
  }

  check(signal) {
    this.abort.signal.throwIfAborted()
    signal?.throwIfAborted()
  }

  async entry({ sessionKey, cwd } = {}, signal) {
    this.check(signal)
    if (typeof sessionKey !== 'string' || !/^[a-f0-9]{64}$/.test(sessionKey)) throw new Error('An opaque SHA-256 session key is required')
    if (typeof cwd !== 'string' || !isAbsolute(cwd)) throw new Error('Session scope cwd must be an absolute directory')
    const canonical = await realpath(cwd)
    if (!(await stat(canonical)).isDirectory()) throw new Error('Session scope cwd must be a directory')
    this.check(signal)
    let entry = this.entries.get(sessionKey)
    if (entry && entry.cwd !== canonical) throw new Error('Session scope project changed; explicit session rebinding is required')
    if (!entry) {
      entry = { cwd: canonical, handle: null, tail: Promise.resolve(), opening: null }
      this.entries.set(sessionKey, entry)
      entry.opening = this.open(sessionKey, entry).catch(error => {
        if (this.entries.get(sessionKey) === entry) this.entries.delete(sessionKey)
        throw error
      })
      // A cancelled waiting caller does not orphan an unobserved shared open.
      entry.opening.catch(() => {})
    }
    await waitFor(entry.opening, combine(signal, this.abort.signal))
    this.check(signal)
    return entry
  }

  async open(sessionKey, entry) {
    const registry = this.ctx.get('agents')
    const workspace = this.ctx.get('workspaceRegistry')
    if (!registry?.create || !registry?.withInitiator || !workspace?.archiveSession) throw new Error('Session attribution requires agents and workspace archive services')
    const id = `dsh2forsion-session-${sessionKey}`
    const persistence = this.ctx.get('sessionPersistence')
    // Unknown/read failure is never interpreted as absent. The public stat
    // observation decides create versus resume; ownership conflicts propagate.
    const stored = persistence ? await persistence.stat(id, { signal: this.abort.signal }) : undefined
    this.check()
    let handle
    try {
      handle = stored
        ? await registry.resume({ resumeSessionId: id, signal: this.abort.signal })
        : await registry.create({ sessionId: id, meta: { cwd: entry.cwd }, signal: this.abort.signal })
      this.check()
      const agent = handle?.agent
      if (!agent?.runMaintenance || agent.session?.id !== id || agent.session?.header?.cwd !== entry.cwd) throw new Error('Session attribution agent identity or project does not match')
      await workspace.archiveSession(id)
      this.check()
      entry.handle = handle
      return agent
    } catch (error) {
      await handle?.dispose?.()
      throw error
    }
  }

  async get(input, signal) {
    const entry = await this.entry(input, signal)
    this.check(signal)
    return entry.handle.agent
  }

  async enqueue(input, signal, operation) {
    const entry = await this.entry(input, signal)
    const previous = entry.tail
    const pending = previous.catch(() => {}).then(async () => {
      this.check(signal)
      const agent = entry.handle.agent
      return agent.runMaintenance(async maintenanceSignal => {
        const combined = combine(signal, maintenanceSignal, this.abort.signal)
        this.check(combined)
        // The entire Promise must settle here; returning an unconsumed lazy
        // AsyncIterable would run its network fetch outside this ALS boundary.
        const result = await this.ctx.get('agents').withInitiator(agent, () => operation(agent, combined))
        this.check(combined)
        return result
      })
    })
    entry.tail = pending
    const clear = () => { if (entry.tail === pending) entry.tail = Promise.resolve() }
    pending.then(clear, clear)
    // A queued cancelled caller can settle immediately, but the owned queue
    // remains intact until its work reaches quiescence; disposal awaits it.
    return waitFor(pending, combine(signal, this.abort.signal))
  }

  withInitiator(input, signal, consume) {
    if (typeof consume !== 'function') return Promise.reject(new Error('A complete async inference consumer is required'))
    return this.enqueue(input, signal, async (agent, combined) => {
      const result = await consume(agent, combined)
      if (result && typeof result[Symbol.asyncIterator] === 'function') throw new Error('Consume the model stream completely inside withInitiator')
      return result
    })
  }

  execute(input, signal, execute) {
    return this.enqueue(input, signal, async (agent, combined) => {
      const boundary = this.ctx.get('sessionProjections')?.stateOf(agent.session, 'turnBoundary')
      if (!boundary || boundary.openTurnStartSeq !== null) throw new Error('Session attribution has no available turn boundary')
      const turn = boundary.lastTurn + 1
      agent.session.append('turn/start', { turn })
      let reason = { kind: 'completed' }
      try {
        const result = await execute(agent, combined)
        if (result?.isError || result?.result?.isError) reason = { kind: 'error', error: { message: 'External tool returned an error', code: 'UNKNOWN' } }
        return result
      } catch (error) {
        reason = { kind: 'error', error: { message: String(error?.message ?? error), code: 'UNKNOWN' } }
        throw error
      } finally {
        if (combined.aborted) reason = { kind: 'aborted', reason: { kind: this.abort.signal.aborted ? 'disposed' : 'user' } }
        agent.session.append('turn/end', { turn, reason })
      }
    })
  }

  dispose() {
    if (this.disposing) return this.disposing
    this.abort.abort(new Error('Session scope pool is disposed'))
    this.disposing = (async () => {
      const entries = [...this.entries.values()]
      await Promise.allSettled(entries.map(entry => entry.opening))
      await Promise.allSettled(entries.map(entry => entry.tail))
      const results = await Promise.allSettled(entries.map(entry => entry.handle?.dispose()))
      this.entries.clear()
      const failures = results.filter(result => result.status === 'rejected').map(result => result.reason)
      if (failures.length) throw new AggregateError(failures, 'Session attribution disposal failed')
    })()
    return this.disposing
  }
}
