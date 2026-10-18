// DSH2Forsion 界面半身。宿主用 new Function('ctx', source) 求值：本文件就是 setup 体，不许顶层 import / export。
// 三样东西：DSH Space（整幅嵌 DSH 自己的 Web 客户端）、插件详情页里的管理面板、两条命令。
// 所有动作都经 ctx.tangu.request 交给包里的引擎半身（tangu-plugins/dsh2forsion）。
const ENGINE = 'dsh2forsion'
const PARTITION = 'persist:dsh2forsion'
// DSH Space 盯 sidecar 的间隔：装、卸、回滚插件后它会换端口重启，旧页面就死了
const WATCH_MS = 2000

const STRINGS = {
  zh: {
    spaceTitle: 'DSH',
    manageTitle: 'DeepSeek Harness 运行时',
    cmdOpen: 'DSH2Forsion：打开 DSH Space',
    cmdManage: 'DSH2Forsion：管理运行时与插件',
    noEngine: '没连上本机引擎。DSH2Forsion 只能在桌面端的本机引擎上运行。',
    loading: '正在连接 DSH…',
    starting: '正在启动 DSH，第一次大约要十几秒…',
    restarting: 'DSH 正在重启（装、卸插件后会自动重启）…',
    stoppedNote: 'DSH 已停止。',
    onboardTitle: '在 Forsion 里运行 DeepSeek Harness 插件',
    onboardBody: 'DSH2Forsion 会在你的电脑上起一个 DeepSeek Harness（DSH）后台进程，把它的界面放进这个 Space，并把 DSH 插件的工具交给 Tangu。',
    onboardDownload: '第一次要下载官方 Node.js {node} 和 DSH {dsh} 运行时，共约 300 MB；装好后占约 1.1 GB 磁盘，运行时常驻约 400 MB 内存。',
    onboardSource: '下载来源：nodejs.org 与 npm 官方源，失败时改用国内镜像 npmmirror（可在插件设置里改）。',
    onboardTrust: 'DSH 插件是在你电脑上以完整权限运行的代码：能读写文件、联网、运行命令。DSH2Forsion 把它们放在单独的进程里，但这不是沙箱。只装你信任的插件。',
    onboardButton: '下载并启动',
    installing: '正在下载和安装…',
    failed: 'DSH 没有起来',
    retry: '重试',
    openManage: '查看日志与管理',
    restoreGood: '恢复到上次能启动的状态',
    sandboxNote: '如果开着主机沙箱，Forsion 会停用所有引擎插件，DSH2Forsion 也就用不了。',
    sectionRuntime: '运行时',
    sectionTools: '交给 Tangu 的工具',
    sectionPlugins: '已装的 DSH 插件',
    sectionInstall: '安装插件',
    sectionLogs: '日志',
    stateRunning: '运行中',
    stateStarting: '启动中',
    stateStopped: '已停止',
    stateFailed: '出错',
    stateMissing: '未安装',
    start: '启动',
    stop: '停止',
    restart: '重启',
    openSpace: '打开 DSH Space',
    install: '安装',
    remove: '移除',
    rollback: '撤销上一次改动',
    refresh: '刷新',
    noTools: '还没有。装了带工具的 DSH 插件后会出现在这里；Tangu 每次调用都会先问你。',
    noPlugins: '还没有装插件。在下面输入 npm 包名安装，或者在 DSH Space 的「插件」页里浏览。在 DSH Space 里直接装的插件不经过装前试启动。',
    installHint: 'npm 包名，可带版本，例如 dsh-free-search@0.9.5',
    installTrial: '先在临时副本里试装、试启动，通过了才装进来…',
    resultInstalled: '已安装 {name}。',
    resultPartial: '已安装 {name}，但有部分没激活：',
    resultFailed: '没装上：',
    resultBlocked: '试启动没通过，没有安装。装上它会让 DSH 整个起不来：',
    resultNeedsConfirm: '试启动能起，但 {name} 有部分没激活，功能可能缺一块：',
    resultVersion: '{name} 声明不支持当前的 DSH {dsh}。',
    resultVerified: '这个版本在 DSH2Forsion 的兼容矩阵里实测过，可以放心装。',
    confirmAnyway: '仍然安装',
    forceAnyway: '强制安装（不建议）',
    acceptRisk: '接受风险并安装',
    removed: '已移除 {name}。',
    rolledBack: '已撤销上一次改动。被换下来的那份（包括之后改过的插件设置）存在数据目录的 backups/undone-* 里。',
    rollbackFailed: '没撤销成功，快照还在：',
    nothingToRollBack: '没有可以撤销的改动。',
    pluginError: '出错',
    pluginOk: '已启用',
    pluginOff: '已停用',
    knownOk: '兼容矩阵：装载通过',
    knownPartial: '兼容矩阵：部分',
    knownBad: '兼容矩阵：不行',
    busy: '正在处理：{job}',
    tangu: 'Tangu 的模型能看到 {tools} 个 DSH 工具、{sections} 段 DSH 插件说明。',
  },
  en: {
    spaceTitle: 'DSH',
    manageTitle: 'DeepSeek Harness runtime',
    cmdOpen: 'DSH2Forsion: Open DSH Space',
    cmdManage: 'DSH2Forsion: Manage runtime and plugins',
    noEngine: 'Not connected to the local engine. DSH2Forsion only runs on the desktop app with its local engine.',
    loading: 'Connecting to DSH…',
    starting: 'Starting DSH. The first start takes a few seconds…',
    restarting: 'DSH is restarting. It restarts after plugins are installed or removed…',
    stoppedNote: 'DSH is stopped.',
    onboardTitle: 'Run DeepSeek Harness plugins in Forsion',
    onboardBody: 'DSH2Forsion runs a DeepSeek Harness (DSH) process on your computer, shows its interface in this Space, and offers the tools of DSH plugins to Tangu.',
    onboardDownload: 'The first start downloads official Node.js {node} and the DSH {dsh} runtime, about 300 MB in total. Once installed it takes about 1.1 GB of disk and about 400 MB of memory while running.',
    onboardSource: 'Downloads come from nodejs.org and the official npm registry, falling back to the npmmirror mirror in China. You can change this in the plugin settings.',
    onboardTrust: 'DSH plugins are code that runs on your computer with full permissions: they can read and write files, use the network and run commands. DSH2Forsion keeps them in a separate process, but that is not a sandbox. Only install plugins you trust.',
    onboardButton: 'Download and start',
    installing: 'Downloading and installing…',
    failed: 'DSH did not start',
    retry: 'Retry',
    openManage: 'Logs and settings',
    restoreGood: 'Go back to the last state that started',
    sandboxNote: 'When the host sandbox is on, Forsion turns off every engine plugin, so DSH2Forsion is unavailable.',
    sectionRuntime: 'Runtime',
    sectionTools: 'Tools offered to Tangu',
    sectionPlugins: 'Installed DSH plugins',
    sectionInstall: 'Install a plugin',
    sectionLogs: 'Logs',
    stateRunning: 'Running',
    stateStarting: 'Starting',
    stateStopped: 'Stopped',
    stateFailed: 'Error',
    stateMissing: 'Not installed',
    start: 'Start',
    stop: 'Stop',
    restart: 'Restart',
    openSpace: 'Open DSH Space',
    install: 'Install',
    remove: 'Remove',
    rollback: 'Undo the last change',
    refresh: 'Refresh',
    noTools: 'None yet. Tools from DSH plugins you install show up here. Tangu asks you before every call.',
    noPlugins: 'No plugins yet. Enter an npm package name below, or browse the Plugins page in the DSH Space. Plugins installed from inside the DSH Space skip the trial start.',
    installHint: 'npm package name, optionally with a version, e.g. dsh-free-search@0.9.5',
    installTrial: 'Installing and starting it in a scratch copy first; it is added only if that works…',
    resultInstalled: 'Installed {name}.',
    resultPartial: 'Installed {name}, but part of it did not activate:',
    resultFailed: 'Not installed:',
    resultBlocked: 'The trial start failed, so nothing was installed. Installing it would stop DSH from starting:',
    resultNeedsConfirm: 'DSH starts with it, but part of {name} did not activate, so some features may be missing:',
    resultVersion: '{name} says it does not support the current DSH {dsh}.',
    resultVerified: 'This version passed the DSH2Forsion compatibility matrix.',
    confirmAnyway: 'Install anyway',
    forceAnyway: 'Force install (not recommended)',
    acceptRisk: 'Accept the risk and install',
    removed: 'Removed {name}.',
    rolledBack: 'Undid the last change. The state it replaced, including plugin settings changed since, is kept in backups/undone-* in the data folder.',
    rollbackFailed: 'Could not undo; the snapshot is kept:',
    nothingToRollBack: 'There is nothing to undo.',
    pluginError: 'Error',
    pluginOk: 'On',
    pluginOff: 'Off',
    knownOk: 'Matrix: loads',
    knownPartial: 'Matrix: partial',
    knownBad: 'Matrix: broken',
    busy: 'Working: {job}',
    tangu: "Tangu's model sees {tools} DSH tools and {sections} DSH plugin instructions.",
  },
}

const lang = () => (ctx.getLocale?.() ?? 'zh') === 'en' ? 'en' : 'zh'
const t = (key, vars = {}) => String(STRINGS[lang()][key] ?? STRINGS.zh[key] ?? key).replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''))

const CSS = `
.d2f { box-sizing: border-box; height: 100%; color: var(--text); font: 13px/1.5 var(--font-ui); }
.d2f * { box-sizing: border-box; }
.d2f-space { display: flex; flex-direction: column; height: 100%; }
.d2f-surface { flex: 1; min-height: 0; display: flex; }
.d2f-surface webview { flex: 1; width: 100%; height: 100%; border: 0; }
.d2f-center { flex: 1; display: flex; align-items: center; justify-content: center; padding: 24px; overflow: auto; }
.d2f-card { max-width: 560px; display: grid; gap: 12px; }
.d2f-card h2 { margin: 0; font-size: 17px; font-weight: 600; }
.d2f-card p { margin: 0; color: var(--text-light); line-height: var(--reading-line-height, 1.6); }
.d2f-card .d2f-warn { color: var(--text); border-left: 2px solid var(--warning); padding-left: 10px; }
.d2f-muted { color: var(--text-muted); }
.d2f-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.d2f-btn { font: inherit; padding: 5px 12px; border-radius: var(--radius-sm); border: 1px solid var(--border); background: var(--bg); color: var(--text); cursor: pointer; }
.d2f-btn:hover { background: var(--bg-hover); }
.d2f-btn[disabled] { opacity: .5; cursor: default; }
.d2f-btn.primary { background: var(--accent); border-color: var(--accent); color: var(--bg); }
.d2f-btn.danger { color: var(--danger); }
.d2f-log { margin: 0; max-height: 220px; overflow: auto; font: 11.5px/1.45 var(--font-mono); color: var(--text-muted); white-space: pre-wrap; word-break: break-all; }
.d2f-error { color: var(--danger); }
.d2f-manage { display: grid; gap: 18px; padding: 4px 0 12px; }
.d2f-section { display: grid; gap: 8px; }
.d2f-section h3 { margin: 0; font-size: 13px; font-weight: 600; }
.d2f-list { display: grid; gap: 6px; margin: 0; padding: 0; list-style: none; }
.d2f-item { display: flex; gap: 10px; align-items: flex-start; justify-content: space-between; padding: 8px 10px; border: 1px solid var(--border); border-radius: var(--radius-md); }
.d2f-item-main { display: grid; gap: 2px; min-width: 0; }
.d2f-item-name { font-weight: 500; overflow-wrap: anywhere; }
.d2f-badge { font-size: 11.5px; color: var(--text-muted); }
.d2f-badge.bad { color: var(--danger); }
.d2f-input { flex: 1; min-width: 220px; font: inherit; padding: 5px 8px; border-radius: var(--radius-sm); border: 1px solid var(--border); background: var(--bg); color: var(--text); }
.d2f-result { display: grid; gap: 6px; }
.d2f-result ul { margin: 0; padding-left: 18px; color: var(--text-muted); font: 11.5px/1.45 var(--font-mono); overflow-wrap: anywhere; }
`

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue
    if (k === 'class') el.className = v
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v)
    else el.setAttribute(k, v === true ? '' : String(v))
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) el.append(c instanceof Node ? c : String(c))
  return el
}

function withStyle(el) {
  const style = document.createElement('style')
  style.textContent = CSS
  el.append(style)
}

async function call(path, opts) {
  if (!ctx.tangu?.request) throw new Error(t('noEngine'))
  const r = await ctx.tangu.request(ENGINE, path, opts)
  if (r && typeof r === 'object' && 'error' in r && Object.keys(r).length === 1) throw new Error(r.error)
  return r
}

const sleep = ms => new Promise(r => setTimeout(r, ms))

function hostAppearance() {
  const mode = document.documentElement.getAttribute('data-mode')
  return { theme: mode === 'dark' ? 'dark' : 'light', locale: lang() }
}

// ── DSH Space ───────────────────────────────────────────────────────────────

ctx.registerView({
  id: 'space',
  title: t('spaceTitle'),
  icon: 'boxes',
  mount(el) {
    let alive = true
    let disposeSurface = null
    const root = h('div', { class: 'd2f d2f-space' })
    withStyle(root)
    const body = h('div', { class: 'd2f-surface' })
    root.append(body)
    el.append(root)

    // phase：surface = 嵌着 DSH 页面；waiting = 等它重启回来；其余（loading / onboarding / failed）由用户操作推进
    let phase = 'loading'
    let mountedBase = null
    const show = (...nodes) => {
      if (disposeSurface) { disposeSurface(); disposeSurface = null }
      mountedBase = null
      body.replaceChildren(h('div', { class: 'd2f-center' }, ...nodes))
    }

    const syncAppearance = () => { void call('/appearance', { method: 'POST', body: hostAppearance() }).catch(() => {}) }
    const modeObserver = new MutationObserver(syncAppearance)
    modeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-mode'] })
    const offLocale = ctx.subscribeLocale?.(() => syncAppearance())

    const mountSurface = (url) => {
      if (disposeSurface) { disposeSurface(); disposeSurface = null }
      phase = 'surface'
      mountedBase = new URL(url).origin
      body.replaceChildren()
      // 宿主有受控接缝就用它（焦点、键盘、销毁由宿主管）；没有就用裸 <webview>。
      // 不能用 iframe：DSH 的登录 cookie 是 SameSite=Strict，跨站 iframe 带不上（M0 实测）。
      if (ctx.ui?.mountWebSurface) {
        const handle = ctx.ui.mountWebSurface(body, { url, partition: PARTITION })
        disposeSurface = typeof handle === 'function' ? handle : () => handle?.dispose?.()
      } else {
        const wv = document.createElement('webview')
        wv.setAttribute('partition', PARTITION)
        wv.setAttribute('src', url)
        body.append(wv)
        disposeSurface = () => wv.remove()
      }
      syncAppearance()
    }

    const failed = (message, status) => {
      phase = 'failed'
      show(h('div', { class: 'd2f-card' },
        h('h2', {}, t('failed')),
        h('p', { class: 'd2f-error' }, message),
        status?.sidecar?.state === 'failed' ? h('p', { class: 'd2f-muted' }, t('sandboxNote')) : null,
        h('div', { class: 'd2f-row' },
          h('button', { class: 'd2f-btn primary', onclick: () => void open() }, t('retry')),
          h('button', { class: 'd2f-btn', onclick: () => void restoreGood() }, t('restoreGood')),
          h('button', { class: 'd2f-btn', onclick: () => ctx.app?.openSettings?.('fplugin:dsh2forsion') }, t('openManage')))))
    }

    const restoreGood = async () => {
      show(h('p', { class: 'd2f-muted' }, t('starting')))
      try { await call('/plugins/restore-last-good', { method: 'POST' }); await open() }
      catch (error) { if (alive) failed(String(error.message ?? error)) }
    }

    const onboarding = (status) => {
      const button = h('button', { class: 'd2f-btn primary' }, t('onboardButton'))
      const log = h('pre', { class: 'd2f-log' })
      const card = h('div', { class: 'd2f-card' },
        h('h2', {}, t('onboardTitle')),
        h('p', {}, t('onboardBody')),
        h('p', {}, t('onboardDownload', { node: status.nodeVersion, dsh: status.dshVersion })),
        h('p', { class: 'd2f-muted' }, t('onboardSource')),
        h('p', { class: 'd2f-warn' }, t('onboardTrust')),
        h('div', { class: 'd2f-row' }, button),
        log)
      button.addEventListener('click', async () => {
        button.disabled = true
        button.textContent = t('installing')
        try {
          await call('/runtime/install', { method: 'POST' })
          while (alive) {
            const s = await call('/status')
            log.textContent = (s.job?.lines ?? []).join('\n')
            log.scrollTop = log.scrollHeight
            if (s.job?.error) throw new Error(s.job.error)
            if (!s.job?.running && s.runtime?.installed) break
            await sleep(1000)
          }
          if (alive) await open()
        } catch (error) {
          button.disabled = false
          button.textContent = t('retry')
          log.textContent += `\n${String(error.message ?? error)}`
        }
      })
      phase = 'onboarding'
      show(card)
    }

    const open = async () => {
      phase = 'loading'
      show(h('p', { class: 'd2f-muted' }, t('loading')))
      let status
      try { status = await call('/status') } catch (error) { if (alive) failed(String(error.message ?? error)); return }
      if (!alive) return
      if (!status.runtime?.installed) { onboarding(status); return }
      if (status.sidecar?.state !== 'running') show(h('p', { class: 'd2f-muted' }, t('starting')))
      try {
        const { url } = await call('/space', { method: 'POST' })
        if (!alive) return
        if (!url) throw new Error('no url')
        mountSurface(url)
      } catch (error) {
        if (!alive) return
        let s = status
        try { s = await call('/status') } catch { /* 用旧状态 */ }
        failed(s?.sidecar?.error ?? String(error.message ?? error), s)
      }
    }

    // sidecar 重启后端口和登录 token 都会变：地址变了就重新嵌入；停了、挂了就换成对应的卡片
    let checking = false
    const watch = setInterval(async () => {
      if (!alive || checking || (phase !== 'surface' && phase !== 'waiting')) return
      checking = true
      try {
        const s = await call('/status')
        if (!alive || (phase !== 'surface' && phase !== 'waiting')) return
        const st = s.sidecar?.state
        if (st === 'running' && s.sidecar.base && s.sidecar.base !== mountedBase) await open()
        else if (st === 'failed') failed(s.sidecar.error ?? t('failed'), s)
        else if (st === 'starting' && phase === 'surface') { phase = 'waiting'; show(h('p', { class: 'd2f-muted' }, t('restarting'))) }
        else if (st === 'stopped') {
          phase = 'stopped' // 用户在管理页停的：不再盯，点「启动」再起
          show(h('div', { class: 'd2f-card' }, h('p', {}, t('stoppedNote')),
            h('div', { class: 'd2f-row' }, h('button', { class: 'd2f-btn primary', onclick: () => void open() }, t('start')))))
        }
      } catch { /* 引擎一时不通：下一轮再看 */ } finally { checking = false }
    }, WATCH_MS)

    void open()
    return () => {
      alive = false
      clearInterval(watch)
      modeObserver.disconnect()
      offLocale?.()
      if (disposeSurface) disposeSurface()
      root.remove()
    }
  },
})

// ── 管理面板（插件详情页）─────────────────────────────────────────────────

function managePanel(el) {
  let alive = true
  const root = h('div', { class: 'd2f d2f-manage' })
  withStyle(root)
  el.append(root)
  const result = h('div', { class: 'd2f-result' })
  const input = h('input', { class: 'd2f-input', placeholder: t('installHint') })

  const stateText = (s) => {
    if (!s.runtime?.installed) return t('stateMissing')
    return { running: t('stateRunning'), starting: t('stateStarting'), stopped: t('stateStopped'), failed: t('stateFailed') }[s.sidecar?.state] ?? s.sidecar?.state
  }

  const act = async (fn) => {
    try { await fn() } catch (error) { result.replaceChildren(h('p', { class: 'd2f-error' }, String(error.message ?? error))) }
    if (alive) await render()
  }

  const installResult = (r, spec) => {
    const reasons = (r.reasons ?? []).length ? h('ul', {}, ...r.reasons.map(x => h('li', {}, x))) : null
    const retryWith = (extra) => h('button', { class: 'd2f-btn', onclick: () => void runInstall(spec, extra) })
    switch (r.status) {
      case 'installed':
        return [h('p', {}, r.verdict === 'partial' ? t('resultPartial', { name: r.name }) : t('resultInstalled', { name: r.name })), reasons]
      case 'needs-confirm':
        return [h('p', {}, t('resultNeedsConfirm', { name: r.name })), reasons, h('div', { class: 'd2f-row' }, Object.assign(retryWith({ confirm: true }), { textContent: t('confirmAnyway') }))]
      case 'blocked':
        return [h('p', { class: 'd2f-error' }, t('resultBlocked')), reasons, h('div', { class: 'd2f-row' }, Object.assign(retryWith({ force: true }), { textContent: t('forceAnyway'), className: 'd2f-btn danger' }))]
      case 'version-refused':
        return [h('p', {}, t('resultVersion', { name: r.name, dsh: lastStatus?.dshVersion ?? '' })), r.verified ? h('p', {}, t('resultVerified')) : null, h('pre', { class: 'd2f-log' }, r.message ?? ''), h('div', { class: 'd2f-row' }, Object.assign(retryWith({ acceptRisk: true }), { textContent: t('acceptRisk') }))]
      default:
        return [h('p', { class: 'd2f-error' }, t('resultFailed')), h('pre', { class: 'd2f-log' }, r.message ?? r.error ?? JSON.stringify(r))]
    }
  }

  const runInstall = async (spec, extra = {}) => {
    if (!spec) return
    result.replaceChildren(h('p', { class: 'd2f-muted' }, t('installTrial')))
    try {
      const r = await call('/plugins/install', { method: 'POST', body: { spec, ...extra } })
      if (alive) result.replaceChildren(...installResult(r, spec).filter(Boolean))
    } catch (error) {
      if (alive) result.replaceChildren(h('p', { class: 'd2f-error' }, String(error.message ?? error)))
    }
    if (alive) await render()
  }

  let lastStatus = null
  const render = async () => {
    let s, plugins = [], known = {}, logs = { lines: [], sidecar: [] }
    try {
      s = await call('/status')
      lastStatus = s
      if (s.runtime?.installed) ({ plugins, known } = await call('/plugins'))
      logs = await call('/logs')
    } catch (error) {
      root.replaceChildren(h('p', { class: 'd2f-error' }, String(error.message ?? error)))
      withStyle(root)
      return
    }
    if (!alive) return
    const state = s.sidecar?.state
    const runtime = h('section', { class: 'd2f-section' },
      h('h3', {}, t('sectionRuntime')),
      h('p', { class: 'd2f-muted' }, `DSH ${s.dshVersion} · Node ${s.nodeVersion} · ${stateText(s)}${s.sidecar?.error ? ` · ${s.sidecar.error}` : ''}`),
      s.pluginJob ? h('p', { class: 'd2f-muted' }, t('busy', { job: s.pluginJob })) : null,
      h('div', { class: 'd2f-row' },
        s.runtime?.installed && state !== 'running' ? h('button', { class: 'd2f-btn primary', onclick: () => act(() => call('/sidecar/start', { method: 'POST' })) }, t('start')) : null,
        state === 'running' ? h('button', { class: 'd2f-btn', onclick: () => act(() => call('/sidecar/restart', { method: 'POST' })) }, t('restart')) : null,
        state === 'running' ? h('button', { class: 'd2f-btn', onclick: () => act(() => call('/sidecar/stop', { method: 'POST' })) }, t('stop')) : null,
        h('button', { class: 'd2f-btn', onclick: () => ctx.openView?.('space') }, t('openSpace')),
        h('button', { class: 'd2f-btn', onclick: () => void render() }, t('refresh'))),
      h('p', { class: 'd2f-muted' }, t('sandboxNote')))

    const tools = h('section', { class: 'd2f-section' },
      h('h3', {}, t('sectionTools')),
      (s.tools ?? []).length
        ? h('p', { class: 'd2f-muted' }, `${t('tangu', { tools: s.tools.length, sections: (s.promptSections ?? []).length })} ${s.tools.join(', ')}`)
        : h('p', { class: 'd2f-muted' }, t('noTools')))

    const badge = (p) => {
      if (p.error) return h('span', { class: 'd2f-badge bad' }, `${t('pluginError')}: ${p.error}`)
      const k = p.known?.grade
      const knownText = k === 'load-ok' ? t('knownOk') : k === 'yellow' ? t('knownPartial') : k === 'red' ? t('knownBad') : null
      return h('span', { class: `d2f-badge${k === 'red' ? ' bad' : ''}` }, [p.enabled === false ? t('pluginOff') : p.enabled ? t('pluginOk') : '', knownText].filter(Boolean).join(' · '))
    }
    const list = h('section', { class: 'd2f-section' },
      h('h3', {}, t('sectionPlugins')),
      plugins.length
        ? h('ul', { class: 'd2f-list' }, ...plugins.map(p => h('li', { class: 'd2f-item' },
          h('div', { class: 'd2f-item-main' },
            h('span', { class: 'd2f-item-name' }, `${resolveText(p.title) ?? p.name}${p.version ? ` ${p.version}` : ''}`),
            resolveText(p.description) ? h('span', { class: 'd2f-muted' }, resolveText(p.description)) : null,
            badge(p)),
          h('button', { class: 'd2f-btn danger', onclick: () => act(async () => { const r = await call('/plugins/remove', { method: 'POST', body: { name: p.name } }); result.replaceChildren(h('p', {}, r.status === 'removed' ? t('removed', { name: p.name }) : (r.message ?? r.status))) }) }, t('remove')))))
        : h('p', { class: 'd2f-muted' }, t('noPlugins')),
      h('div', { class: 'd2f-row' },
        h('button', { class: 'd2f-btn', onclick: () => act(async () => { const r = await call('/plugins/rollback', { method: 'POST' }); result.replaceChildren(h('p', {}, r.status === 'rolled-back' ? t('rolledBack') : r.status === 'failed' ? `${t('rollbackFailed')} ${r.message ?? ''}` : t('nothingToRollBack'))) }) }, t('rollback'))))

    const installBtn = h('button', { class: 'd2f-btn primary', onclick: () => void runInstall(input.value.trim()) }, t('install'))
    if (!s.runtime?.installed || s.pluginJob) installBtn.disabled = true
    const installer = h('section', { class: 'd2f-section' },
      h('h3', {}, t('sectionInstall')),
      h('div', { class: 'd2f-row' }, input, installBtn),
      result)

    const logBox = h('section', { class: 'd2f-section' },
      h('details', {}, h('summary', {}, t('sectionLogs')),
        h('pre', { class: 'd2f-log' }, [...(logs.lines ?? []), '', ...(logs.sidecar ?? []).slice(-60)].join('\n'))))

    const style = root.querySelector('style')
    root.replaceChildren(style, runtime, tools, list, installer, logBox)
  }

  const resolveText = (v) => {
    if (!v) return null
    if (typeof v === 'string') return v
    return v[lang()] ?? v.en ?? v.zh ?? Object.values(v)[0] ?? null
  }

  void render()
  const offLocale = ctx.subscribeLocale?.(() => void render())
  return () => { alive = false; offLocale?.(); root.remove() }
}

if (ctx.registerSettingsView) {
  ctx.registerSettingsView({ id: 'manage', title: () => t('manageTitle'), mount: managePanel })
} else {
  // 旧宿主没有设置页挂载口：退回一个普通视图
  ctx.registerView({ id: 'manage', title: t('manageTitle'), icon: 'settings', mount: managePanel })
}

ctx.registerCommand({
  id: 'dsh2forsion-open-space',
  title: () => t('cmdOpen'),
  run: () => { ctx.openView?.('space') },
})
ctx.registerCommand({
  id: 'dsh2forsion-manage',
  title: () => t('cmdManage'),
  run: () => {
    if (ctx.app?.openSettings && ctx.registerSettingsView) ctx.app.openSettings('fplugin:dsh2forsion')
    else ctx.openView?.('manage')
  },
})
