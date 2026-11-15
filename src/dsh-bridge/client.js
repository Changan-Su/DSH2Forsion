// DSH2Forsion 桥的网页端小模块（第 1 档）：工作台落点。
// Forsion 从对话右键菜单「在 DSH 工作台里打开」时，把工作台导航到 `#d2f-session=<DSH 会话 id>&n=<序号>`
// （序号让同一场再点一次也能触发）。这里在 DSH 自己的界面里选中那场会话，用的是 DSH 的 uiWorkspace.openSession。
// 只做导航：不加界面、不改样式、不碰别的模块。用过就把 # 那段从地址里拿掉，页面之后重载不会再跳回这一场。
window.__ModuleLoader__.load({ id: 'dsh2forsion-bridge', factory() {
  const KEY = 'd2f-session'
  const hash = () => String(globalThis.location?.hash || '')
  const wanted = () => {
    try { return new URLSearchParams(hash().replace(/^#/, '')).get(KEY) || '' } catch { return '' }
  }
  return {
    inject: ['uiWorkspace', 'sessions'],
    apply(ctx) {
      ctx.effect(() => {
        let handled = ''
        let fallback = null
        let waitingFor = ''
        const open = (id, at) => {
          handled = at
          clearTimeout(fallback)
          waitingFor = ''
          try { ctx.uiWorkspace.openSession(id) } catch (error) { console.warn('[dsh2forsion] could not open the session', error) }
          try { history.replaceState(history.state, '', location.pathname + location.search) } catch { /* 拿不掉也不影响这次落点 */ }
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
        return () => { unsubscribe(); globalThis.removeEventListener('hashchange', check); clearTimeout(fallback) }
      }, 'dsh2forsion: land the workbench on a Forsion conversation')
    },
  }
} })
