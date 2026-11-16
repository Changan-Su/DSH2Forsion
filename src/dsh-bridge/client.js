// DSH2Forsion 桥的网页端小模块（第 1 档）：工作台落点。
// Forsion 从对话右键菜单「在 DSH 工作台里打开」时，把工作台导航到 `#d2f-session=<DSH 会话 id>&n=<序号>`
// （序号让同一场再点一次也能触发）。这里在 DSH 自己的界面里选中那场会话，用的是 DSH 的 uiWorkspace.openSession。
// 只做导航：不加界面、不改样式、不碰别的模块。用过就把 # 那段从地址里拿掉，页面之后重载不会再跳回这一场。
// 整页载入时 DSH 自己会把存着的「上次那场」恢复出来，可能晚于这里的 openSession 把它盖回去：页面刚载入的几秒里落点的，
// 之后看 DSH 存下的当前会话，仍是载入时存着的那一场就再开一次；用户自己点到了别处就收手。已经开着的页面里落点不会被恢复盖掉，不重试。
window.__ModuleLoader__.load({ id: 'dsh2forsion-bridge', factory() {
  const KEY = 'd2f-session'
  const CURRENT = 'dsh.sessions.current' // DSH 存「当前会话」的地方（uiWorkspace 的 selection）
  const REASSERT_MS = [600, 1500, 3000]
  const STARTUP_MS = 8000 // 页面载入后这么久之内的落点才可能被 DSH 的恢复盖掉
  const current = () => { try { return JSON.parse(globalThis.localStorage?.getItem(CURRENT) || 'null')?.sessionId ?? null } catch { return null } }
  const hash = () => String(globalThis.location?.hash || '')
  const wanted = () => {
    try { return new URLSearchParams(hash().replace(/^#/, '')).get(KEY) || '' } catch { return '' }
  }
  return {
    inject: ['uiWorkspace', 'sessions'],
    apply(ctx) {
      ctx.effect(() => {
        const startedAt = Date.now()
        const restored = current() // 载入时存着的那一场：DSH 的恢复会把它选回来
        let handled = ''
        let fallback = null
        let waitingFor = ''
        let timers = []
        const openSession = (id) => {
          try { ctx.uiWorkspace.openSession(id) } catch (error) { console.warn('[dsh2forsion] could not open the session', error) }
        }
        const open = (id, at) => {
          handled = at
          clearTimeout(fallback)
          waitingFor = ''
          for (const t of timers) clearTimeout(t)
          timers = []
          console.info('[dsh2forsion] opening the session from the address', id)
          openSession(id)
          try { history.replaceState(history.state, '', location.pathname + location.search) } catch { /* 拿不掉也不影响这次落点 */ }
          if (Date.now() - startedAt > STARTUP_MS || restored === id) return
          let landed = false
          const stop = () => { for (const t of timers) clearTimeout(t); timers = [] }
          timers = REASSERT_MS.map((ms) => setTimeout(() => {
            const now = current()
            if (handled !== at) return
            if (now === id) { landed = true; return }
            // 落上过之后又回到载入时那场、或者到了第三场：是用户自己点的，收手
            if (landed || now !== restored) { stop(); return }
            console.info('[dsh2forsion] DSH restored its last session over the landing; opening it again', id, `+${ms}ms`)
            openSession(id)
          }, ms))
        }
        const check = () => {
          const at = hash()
          const id = wanted()
          if (!id || at === handled) return
          if (ctx.sessions.list.getSnapshot().byId[id] !== undefined) { open(id, at); return }
          // 会话列表还没加载到这一场：等它出现；几秒后还没有就直接开（openSession 自己会把它取回来）。
          // 时限按这一次落点只设一次：列表别的会话一直在变也不会把它往后推
          if (waitingFor === at) return
          clearTimeout(fallback)
          waitingFor = at
          fallback = setTimeout(() => { if (hash() === at && handled !== at) open(id, at) }, 4000)
        }
        const unsubscribe = ctx.sessions.list.subscribe(check)
        globalThis.addEventListener('hashchange', check)
        check()
        return () => { unsubscribe(); globalThis.removeEventListener('hashchange', check); clearTimeout(fallback); for (const t of timers) clearTimeout(t) }
      }, 'dsh2forsion: land the workbench on a Forsion conversation')
    },
  }
} })
