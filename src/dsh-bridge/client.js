// DSH2Forsion 桥的网页端小模块。两件事，都只做导航、不加界面、不改样式：
//
// 一、工作台落点（第 1 档）：Forsion 从对话右键菜单「在 DSH 工作台里打开」时，把工作台导航到 `#d2f-session=<DSH 会话 id>&n=<序号>`
// （序号让同一场再点一次也能触发）。这里在 DSH 自己的界面里选中那场会话，用的是 DSH 的 uiWorkspace.openSession。
// 用过就把 # 那段从地址里拿掉，页面之后重载不会再跳回这一场。
// 整页载入时 DSH 自己会把存着的「上次那场」恢复出来，可能晚于这里的 openSession 把它盖回去：页面刚载入的几秒里落点的，
// 之后看 DSH 存下的当前会话，仍是载入时存着的那一场就再开一次；用户自己点到了别处就收手。已经开着的页面里落点不会被恢复盖掉，不重试。
//
// 二、右栏页（第 2 档）：Forsion 右栏里开着的 DSH 页，地址是 `#d2f-rail=<页的 kind>&d2f-session=<DSH 会话 id>&d2f-nonce=<回报口令>&n=<序号>`。
// 只用 DSH 右侧栏的公开接口（dsh-client-ui-sidebar-right README「Extension seats」「ctx.sidebarRight」）：
//   选中这场会话 → `ctx.sidebarRight.openTab(kind)` 打开那一页 → 右侧栏铺满整个页面。窄于 768 时 DSH 自己就铺满（它的 narrow 规则）；
//   更宽时（右栏被拖得很宽、或撕成了独立窗口）按一次 DSH 自己的「全屏」（toggleFullscreen）。
//   **不认具体是哪一页**：文件、预览、终端、插件注册的页（`ctx.sidebarRightTabs.register`）走同一条路。第 1 档以前逐个给面板打补丁、
//   升版就断，这里换成只认 DSH 的这几个公开接口。DSH 的页签条、「+」、分屏、收起这些它自己画的东西都还在。
//   用户在 DSH 里收起了右侧栏（或关掉了最后一页）就再展开（展开时 DSH 自己补它的默认页），这一页绑着的会话被别的会话顶掉了就选回来：
//   右栏页只为 Forsion 的这一场对话服务，底下的 DSH 对话界面在这里没有意义。
//   做没做成报回桥（POST /forsion-bridge/rail/report，凭 # 里的口令；桥的其余口子要启动密钥，网页拿不到也不该拿到）：
//   ok / missing（这一版 DSH 里没有这一页）/ incompatible（接口对不上）/ no-session / failed，连同 DSH 此刻有哪些页。
//   Forsion 那半据此显示这一页，或退回「去工作台里看」的提示。
window.__ModuleLoader__.load({ id: 'dsh2forsion-bridge', factory() {
  const KEY = 'd2f-session'
  const RAIL = 'd2f-rail'
  const CURRENT = 'dsh.sessions.current' // DSH 存「当前会话」的地方（uiWorkspace 的 selection）
  const REASSERT_MS = [600, 1500, 3000]
  const STARTUP_MS = 8000 // 页面载入后这么久之内的落点才可能被 DSH 的恢复盖掉
  const WIDE = 768 // DSH 右侧栏自己铺满的宽度界（ui-sidebar-right README「Presentations」）
  const RAIL_SERVICES_MS = 6000 // 右侧栏的两个服务这么久还没出现 = 这一版 DSH 对不上
  const RAIL_TICK_MS = 700
  const PAGE_WAIT_MS = 5000 // 要的那一页这么久还没登记上 = 这一版 DSH 里没有它
  const ANY_PAGE = '*' // d2f-rail=* ：不换页，留着 DSH 为这一场记住的那页
  const current = () => { try { return JSON.parse(globalThis.localStorage?.getItem(CURRENT) || 'null')?.sessionId ?? null } catch { return null } }
  const hash = () => String(globalThis.location?.hash || '')
  const params = () => { try { return new URLSearchParams(hash().replace(/^#/, '')) } catch { return new URLSearchParams() } }
  const wanted = () => (params().has(RAIL) ? '' : params().get(KEY) || '')
  const railWanted = () => {
    const p = params()
    const kind = p.get(RAIL)
    return kind ? { kind, session: p.get(KEY) || '', nonce: p.get('d2f-nonce') || '', n: p.get('n') || '', at: hash() } : null
  }
  return {
    inject: ['uiWorkspace', 'sessions'],
    apply(ctx) {
      const openSession = (id) => {
        try { ctx.uiWorkspace.openSession(id) } catch (error) { console.warn('[dsh2forsion] could not open the session', error) }
      }
      ctx.effect(() => {
        const startedAt = Date.now()
        const restored = current() // 载入时存着的那一场：DSH 的恢复会把它选回来
        let handled = ''
        let fallback = null
        let waitingFor = ''
        let timers = []
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

      // ── 右栏页 ──────────────────────────────────────────────────────────────
      const report = (want, body) => {
        if (!want?.nonce) return
        const payload = { ...body, kind: want.kind, session: want.session, n: want.n, width: globalThis.innerWidth || 0 }
        try {
          void fetch('/forsion-bridge/rail/report', {
            method: 'POST', headers: { 'content-type': 'application/json', 'x-d2f-rail-nonce': want.nonce }, body: JSON.stringify(payload),
          }).catch(() => {})
        } catch { /* 报不回去，Forsion 那半等不到回报会按对不上处理 */ }
      }
      let railServices = false
      // 右侧栏的两个服务一直没出现（这一版 DSH 改了名 / 拆了包）：只要地址要的是右栏页，就照实报回去
      ctx.effect(() => {
        const check = () => {
          const want = railWanted()
          if (!want) return
          const t = setTimeout(() => {
            if (!railServices && railWanted()?.at === want.at) report(want, { state: 'incompatible', reason: 'DSH right sidebar services (sidebarRight, sidebarRightTabs) are not available' })
          }, RAIL_SERVICES_MS)
          return t
        }
        let timer = check()
        const onHash = () => { clearTimeout(timer); timer = check() }
        globalThis.addEventListener('hashchange', onHash)
        return () => { clearTimeout(timer); globalThis.removeEventListener('hashchange', onHash) }
      }, 'dsh2forsion: report a missing right sidebar')

      ctx.inject(['sidebarRight', 'sidebarRightTabs'], (scope) => {
        scope.effect(() => {
          railServices = true
          const right = scope.sidebarRight
          const tabs = scope.sidebarRightTabs
          // 用到的公开接口，少一个都算对不上（不去猜替代品）
          const missing = [
            ['sidebarRight.openTab', right?.openTab], ['sidebarRight.isExpanded', right?.isExpanded], ['sidebarRight.toggleExpanded', right?.toggleExpanded],
            ['sidebarRight.toggleFullscreen', right?.toggleFullscreen], ['sidebarRight.commandTarget', right?.commandTarget],
            ['sidebarRight.focusedTarget', right?.focusedTarget], ['sidebarRight.mounted.getSnapshot', right?.mounted?.getSnapshot],
            ['sidebarRightTabs.get', tabs?.get], ['sidebarRightTabs.entries', tabs?.entries], ['sidebarRightTabs.subscribe', tabs?.subscribe],
          ].filter(([, f]) => typeof f !== 'function').map(([name]) => name)
          // 这一版 DSH 有哪些「页」：按 kind 打开、不认地址的那类（文件、浏览器、终端、插件注册的页……），向导页本身不算
          const pages = () => {
            const out = []
            const seen = new Set()
            for (const d of tabs.entries()) {
              if (!d || typeof d.kind !== 'string' || seen.has(d.kind) || d.kind === 'guide') continue
              if (Array.isArray(d.patterns) && d.patterns.length) continue
              if (tabs.get(d.kind) !== d) continue // 同一个 kind 只认正在生效的那份
              seen.add(d.kind)
              let title = d.kind
              try { title = String(d.title('') || d.kind) } catch { /* 标题取不出就用 kind */ }
              out.push({ kind: d.kind, title: title.slice(0, 120) })
            }
            return out
          }
          let want = null
          let reported = ''
          let tick = null
          let waiting = null // 这一次导航等会话上屏、等页登记的轮询（换导航 / 卸载时撤掉）
          let later = null
          const stopWaiting = () => { if (waiting) { clearInterval(waiting); waiting = null } }
          const stopAll = () => { stopWaiting(); clearTimeout(later); later = null }
          const onScreen = () => { try { return right.mounted.getSnapshot() } catch { return undefined } }
          // 右侧栏此刻是不是盖住了整页：拿页面左边那块的元素问 DSH 自己「这是不是右侧栏里的一页」
          const covering = () => {
            try {
              const el = document.elementFromPoint(Math.max(4, globalThis.innerWidth * 0.12), globalThis.innerHeight * 0.5)
              return !!(el && right.focusedTarget(el))
            } catch { return false }
          }
          const say = (state, extra = {}) => {
            const key = `${want?.at}|${state}|${extra.reason ?? ''}|${extra.covering ?? ''}|${JSON.stringify(extra.pages ?? [])}`
            if (key === reported) return
            reported = key
            report(want, { state, ...extra })
          }
          const keep = () => {
            if (!want?.active) return // 还没打开过（等会话上屏）或这一页没有：不动 DSH 的界面
            if (want.kind !== ANY_PAGE && !tabs.get(want.kind)) { say('missing', { pages: pages(), reason: `no page of kind "${want.kind}" in this DSH` }); return }
            if (onScreen() !== want.session) { if (ctx.sessions.list.getSnapshot().byId[want.session] !== undefined) openSession(want.session); return }
            try {
              if (!right.isExpanded()) right.toggleExpanded()
              else if ((globalThis.innerWidth || 0) >= WIDE && !covering()) {
                const target = right.commandTarget()
                if (target) right.toggleFullscreen(target)
              }
            } catch (error) { console.warn('[dsh2forsion] rail: could not keep the page open', error) }
            say('ok', { pages: pages(), covering: covering() })
          }
          const begin = () => {
            const next = railWanted()
            if (!next || next.at === want?.at) return
            stopAll()
            want = next
            reported = ''
            if (missing.length) { say('incompatible', { reason: `missing: ${missing.join(', ')}` }); return }
            if (!want.session) { say('no-session', { pages: pages() }); return }
            console.info('[dsh2forsion] rail: showing', want.kind, 'for', want.session)
            const started = Date.now()
            const deadline = started + 8000 + PAGE_WAIT_MS
            const opened = want.at
            let asked = 0
            let lastError = ''
            const fail = () => { stopWaiting(); say('failed', { reason: lastError || 'the DSH session did not come on screen', pages: pages() }) }
            waiting = setInterval(() => {
              if (want?.at !== opened) { stopWaiting(); return }
              // 会话列表还没载到这一场时 DSH 不认（sessions.retain: unknown session）：列出来了再选；没上屏就每秒再选一次
              if (onScreen() !== want.session && ctx.sessions.list.getSnapshot().byId[want.session] !== undefined && Date.now() - asked > 1000) {
                asked = Date.now()
                openSession(want.session)
              }
              // 各页是各自的插件登记的，整页载入时可能晚于这里（文件页就晚于测试插件）：等一会儿再说「没有这一页」
              if (want.kind !== ANY_PAGE && !tabs.get(want.kind)) {
                if (Date.now() - started > PAGE_WAIT_MS) { stopWaiting(); say('missing', { pages: pages(), reason: `no page of kind "${want.kind}" in this DSH` }) }
                return
              }
              if (onScreen() === want.session) {
                // 会话刚上屏时右侧栏这一场的状态可能还没建好，DSH 会抛「no session surface is mounted」：下一拍再试，到时限才算失败
                // 「*」= 不指定哪一页：这一场 DSH 自己记着上次看的那页（按会话存），只把右侧栏展开、铺满
                try { if (want.kind !== ANY_PAGE) right.openTab(want.kind) } catch (error) {
                  lastError = String(error?.message ?? error).slice(0, 300)
                  if (Date.now() > deadline) fail()
                  return
                }
                stopWaiting()
                want.active = true
                later = setTimeout(keep, 120)
                return
              }
              if (Date.now() > deadline) fail()
            }, 100)
          }
          if (!missing.length) {
            tick = setInterval(keep, RAIL_TICK_MS)
            // 装上 / 卸掉插件时页的清单会变：再报一次
            const off = tabs.subscribe(() => { if (want) { reported = ''; keep() } })
            globalThis.addEventListener('hashchange', begin)
            globalThis.addEventListener('resize', keep)
            begin()
            return () => { stopAll(); clearInterval(tick); off(); globalThis.removeEventListener('hashchange', begin); globalThis.removeEventListener('resize', keep) }
          }
          globalThis.addEventListener('hashchange', begin)
          begin()
          return () => { stopAll(); globalThis.removeEventListener('hashchange', begin) }
        }, 'dsh2forsion: show one right sidebar page for Forsion')
      })
    },
  }
} })
