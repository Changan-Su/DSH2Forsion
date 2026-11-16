// Dedicated client adapter; shares React/Cordis through DSH's public module table.
window.__ModuleLoader__.load({ id: 'dsh2forsion-bridge', factory(require) {
  const React = require('react')
  const current = globalThis.__FORSION_NATIVE_VIEW__
  return { inject: ['slots', 'locale'], apply(ctx) {
    let context = null, pending, disposed = false
    const controllers = new Set()
    const listeners = new Set()
    const fail = error => {
      const message = String(error?.message || error)
      const box = document.getElementById('forsion-native-error')
      if (box) box.textContent = message
      console.error('[Forsion native view]', message)
    }
    const request = async (op, payload = {}) => {
      if (!current || disposed) throw new Error('Native view is not active')
      const response = await fetch(`/forsion-native/api/${op}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forsion-native-view': current.ticket }, body: JSON.stringify(payload), signal: AbortSignal.timeout(120000) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || `Native adapter ${response.status}`)
      return result
    }
    const push = controller => {
      controller.setExecutionOptions({
        workspaces: (context?.workspaces || []).map(w => ({ workspaceId: w.id, title: w.name || w.path })),
        models: (context?.models || []).map(m => ({ id: m.id, name: m.name, label: m.name || m.id, provider: m.provider, reasoning: { supported: false } })),
        presets: context?.agentModes || [],
      })
    }
    const refresh = async controller => {
      if (disposed) return
      pending ??= request('context').then(value => {
        if (!Array.isArray(value.workspaces)) value.workspaces = value.workspace ? [value.workspace] : []
        context = value
        for (const target of controllers) push(target)
        for (const fn of listeners) fn()
      }).finally(() => { pending = null })
      await pending
      if (controller) push(controller)
    }
    const face = {
      enabled: !!current,
      currentSession: () => context?.currentSessionId,
      currentCwd: () => context?.cwd,
      async openSession(ref) { try { return await request('openSession', { sessionId: ref }) } catch (error) { fail(error); return { opened: false } } },
      openCurrentSession() {
        if (!context?.currentSessionId) { fail(new Error('The current Tangu session is unavailable')); return }
        void request('openSession', { sessionId: context.currentSessionId }).catch(fail)
      },
      async createWorkspace(path) { const value = await request('createWorkspace', { path }); await refresh(); return value },
      refresh,
      bind(controller) { controllers.add(controller); void refresh(controller).catch(fail) },
      unbind(controller) { controllers.delete(controller) },
      subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn) },
    }
    ctx.provide('nativeExecutionClient', face)
    if (!current) return
    const timer = setInterval(() => { void refresh().catch(fail) }, 5000)
    ctx.effect(() => () => { disposed = true; clearInterval(timer); controllers.clear(); listeners.clear() })
    ctx.slots.inject('task-board.detail.section', () => ctx.slots.register({ name: 'task-board.detail.section', id: 'forsion-native-execution', order: -100 }, function NativeExecution({ task }) {
      const [busy, setBusy] = React.useState(false)
      const [error, setError] = React.useState('')
      const [locale, setLocale] = React.useState(() => ctx.locale.getLocale())
      React.useEffect(() => ctx.on('locale/change', value => { setLocale(value.active) }), [])
      const zh = String(locale).startsWith('zh')
      const ref = [...(task.executions || [])].reverse().find(e => String(e.sessionId || '').startsWith('forsion-task:'))?.sessionId
      if (!ref) return null
      const action = op => async () => { setBusy(true); setError(''); try { await request(op, { sessionId: ref }) } catch (e) { setError(String(e.message || e)) } finally { setBusy(false) } }
      return React.createElement('section', { 'data-forsion-native-execution': ref },
        React.createElement('button', { type: 'button', 'data-forsion-native-action': 'open-session', disabled: busy, onClick: action('openSession') }, zh ? '在 Tangu 中打开' : 'Open in Tangu'),
        React.createElement('button', { type: 'button', 'data-forsion-native-action': 'cancel', disabled: busy || task.status !== 'running', onClick: action('cancel') }, zh ? '取消 Tangu 任务' : 'Cancel Tangu task'),
        error ? React.createElement('div', { role: 'alert' }, error) : null)
    }))
  } }
} })
