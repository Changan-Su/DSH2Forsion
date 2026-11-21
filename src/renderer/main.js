// DSH2Forsion 界面半身。宿主用 new Function('ctx', source) 求值：本文件就是 setup 体，不许顶层 import / export。
// 第 1 档（融合）：DSH 工作台（主区页签，里面是常驻那个 DSH 自己的网页界面）、DSH Agent 的 Harness 卡上的几行、
// 对话右键菜单「在 DSH 工作台里打开」、工作台里装插件前的体检报告、运行时管理页。
// 所有动作都经 ctx.tangu.request 交给包里的引擎半身（tangu-plugins/dsh2forsion）。
const ENGINE = 'dsh2forsion'
const ENGINE_ID = 'dsh'
// 工作台盯常驻 DSH 的间隔：重启后端口和登录令牌都会变，旧页面就死了
const WATCH_MS = 2000
const REVIEW_MS = 1000
const SETTLE_MS = 1500

const STRINGS = {
  zh: {
    workbenchTitle: 'DSH 工作台',
    manageTitle: 'DeepSeek Harness 运行时',
    cmdOpen: 'DSH2Forsion：打开 DSH 工作台',
    cmdManage: 'DSH2Forsion：管理运行时',
    loading: '正在连接 DSH…',
    starting: '正在启动 DSH…',
    restarting: 'DSH 正在重启…',
    failed: 'DSH 没有启动起来',
    retry: '重试',
    start: '启动 DSH',
    restart: '重启 DSH',
    stop: '停止 DSH',
    refresh: '刷新',
    openManage: '运行时设置',
    openWorkbench: '打开工作台',
    restoreGood: '退回上次能启动的插件组合',
    stoppedNote: 'DSH 已停止。下一次和 DSH 对话或点下面的按钮时会再启动。',
    noHost: '这个版本的 Forsion 还不能在页签里打开网页界面，请更新 Forsion。',
    noEngine: '本插件需要 Forsion 桌面版的本机引擎。',
    onboardTitle: '准备 DSH 运行时',
    onboardBody: '工作台和 DSH 这个 Agent 的对话都连一个常驻在后台的 DeepSeek Harness。第一次使用要下载它的运行时。',
    onboardDownload: '会下载 Node {node} 和 DSH {dsh}，约 1.1 GB 磁盘。',
    onboardSource: '来源：nodejs.org 与 npm 官方源，失败时用国内镜像。可在运行时设置里改。',
    onboardTrust: 'DSH 用你自己的 DSH 目录（{home}），会话和技能与你自己的 DSH 是同一批；它另用一份名叫 forsion 的组合，你原来装的 DSH 插件不会自动出现在这里。',
    onboardButton: '下载并启动',
    installing: '正在下载…',
    incompatibleTitle: '等插件更新',
    incompatibleBody: 'DSH {dsh} 和这个版本的 DSH2Forsion 对不上（{reason}）。工作台先停用。',
    incompatibleChat: 'DSH 这个 Agent 的对话暂时退回每轮起一个 DSH 的方式：还能聊，但依赖网页界面的 DSH 插件在这条路上不生效。',
    rollbackRuntime: '先退回上一版 DSH',
    noPrevious: '这台电脑上没有装过 DSH2Forsion 验过的更早版本，退不了。',
    foreignProfile: '你的 DSH 目录里已经有一份叫 forsion 的组合，不是 DSH2Forsion 建的，所以没有碰它。在 DSH 里把它改个名再重试。',
    reviewChecking: '正在体检 {spec}：在临时目录里试启动两次，大约要半分钟…',
    reviewTitle: '要装 {name} 吗？',
    reviewTools: '加了 {n} 个工具',
    reviewNoTools: '没有加工具',
    reviewPrompt: '提示词多了 {n} 字',
    reviewPromptLess: '提示词少了 {n} 字',
    reviewPromptSame: '提示词没有变',
    reviewInactive: '有没启动的部分',
    reviewAllActive: '各部分都启动了',
    reviewHosts: '启动时连了这些外部主机',
    reviewNoHosts: '启动时没有连外部主机',
    reviewBlocked: '装上以后 DSH 起不来或有核心包被盖掉，不建议装。',
    reviewVersion: 'DSH 说这个插件没写明支持当前版本。放行后 DSH 会自己再问一次要不要承担风险。',
    reviewFailed: '体检没做完：{reason}',
    reviewMeasured: '在临时目录里装前、装后各试启动一次比出来的，外连主机是实际量到的。',
    reviewAllow: '装',
    reviewDeny: '不装',
    reviewTimeout: '15 分钟内不回答就按不装处理。',
    reviewBuildsNeeded: '要跑原生构建脚本',
    reviewBuildsHow: 'DSH 不跑你没允许过的构建脚本：点「装」后这次会装不上，DSH 插件页会提示「允许这些脚本并重试」。在那里允许后会再体检一次（体检本身不跑这些脚本）。',
    reviewBuildsApproved: '你在 DSH 里允许了这些构建脚本（装的时候跑，体检时没跑）',
    reviewBuildsAllowed: '这个组合之前允许过这些构建脚本（装的时候跑，体检时没跑）',
    reviewBuildsSkipped: '按组合设置不跑这些构建脚本（靠它们的功能可能用不了）',
    reviewBuildsUnknown: '要跑原生构建脚本（组合设置读不懂，判断不了允没允许过）',
    reviewBuildsUnread: '没读出它要不要跑构建脚本',
    reviewBuildsHowMaybe: '没允许过的话，点「装」后这次会装不上，DSH 插件页会提示「允许这些脚本并重试」。',
    reviewRestart: '装好后 DSH 插件页如果写「下次启动后加载」，到 Harness 卡上点「重启 DSH」。',
    rowRuntime: '运行时',
    rowChannel: '更新通道',
    rowPlugins: 'DSH 插件',
    stateRunning: 'DSH {dsh} · 在运行',
    stateStarting: 'DSH {dsh} · 正在启动',
    stateStopped: 'DSH {dsh} · 已停止',
    stateFailed: 'DSH {dsh} · 启动失败',
    stateMissing: '还没有下载',
    stateIncompatible: 'DSH {dsh} · 和插件对不上',
    channelPinned: '固定（插件验过的 {dsh}）',
    channelFollow: '跟版（每天自检过的新版）',
    channelUnpublished: '跟版通道还没开放，先停在 {dsh}。',
    channelLatest: '通道上最新的是 {dsh}。',
    pluginsCount: '{n} 个',
    pluginsNone: '还没装',
    pluginsReading: '正在读取…',
    pluginsManage: '管理',
    pluginsHint: '在工作台里 DSH 自己的「插件」页装；装之前会先体检。',
    openInWorkbench: '在 DSH 工作台里打开',
    holdNoSession: '这场对话还没在 DSH 上跑过，先打开工作台。',
    holdBusy: '这场对话正在跑或正在 DSH 里别处开着，先打开工作台。',
    holdFailed: '没能把这场对话交给工作台：{reason}',
    sectionRuntime: '运行时',
    sectionPlugins: 'DSH 插件',
    sectionLogs: '日志',
    sectionTools: '交给 Tangu 的工具',
    versionsLine: '在用 DSH {dsh} · 这个插件版本验过 {pinned} · 盘上装着 {installed}',
    homeLine: 'DSH 目录 {home} · 组合 {profile}',
    checkChannel: '检查新版',
    noPlugins: '这份组合里还没有装 DSH 插件。在工作台里 DSH 自己的「插件」页装。',
    remove: '卸载',
    removed: '已卸载 {name}。',
    rollback: '撤回上一次插件改动',
    rolledBack: '已撤回。',
    nothingToRollBack: '没有可撤回的改动。',
    rollbackFailed: '撤回失败：',
    pluginOk: '已启用',
    pluginOff: '已停用',
    pluginError: '出错',
    toolsOff: '缺省不把 DSH 插件的工具交给 Tangu：要用 DSH 插件做的事交给 DSH 这个 Agent。可在插件设置里打开。',
    toolsOn: '交给 Tangu 的工具 {n} 个：{list}',
    busy: '正在处理：{job}',
    restartNote: '重启 DSH 会中断正在跑的 DSH 对话。',
    oldHostResident: '这个版本的 Forsion 还不能让 DSH 的对话连这个常驻的 DSH：对话照旧每轮起一个 DSH，工作台里看不到它们。更新 Forsion 后连得上。',
    oldHostSurfaceTitle: '要更新 Forsion',
    oldHostSurface: '这个版本的 Forsion 没有给插件用的受控网页容器，DSH 工作台打不开。更新 Forsion 后再打开；DSH 的对话照旧能用。',
    railTitle: 'DSH',
    railNoSessionTitle: '还没开始',
    railNoSession: '发一句之后，这里显示 DSH 的页面。',
    railStoppedTitle: 'DSH 没在运行',
    railStopped: '启动之后，这里显示这场对话在 DSH 里的页面。',
    railStart: '启动 DSH',
    railMismatchTitle: '这一版 DSH 对不上右栏页',
    railMismatch: 'DSH 更新后改了右侧栏的接口，融合插件还没跟上。先在工作台里看。',
    railNotInstalledTitle: 'DSH 还没装好',
    railNotInstalled: '先在工作台里把 DSH 装好，这里就显示它的页面。',
    railFailedTitle: '右栏里打不开 DSH 的页面',
    railFailed: '{reason}',
    railTimeout: 'DSH 的页面一直没有回应。',
    railOpenWorkbench: '打开工作台',
    railOldHost: '这个版本的 Forsion 还不能让右栏跟着当前对话走。更新 Forsion 后再用；工作台照旧能用。',
  },
  en: {
    workbenchTitle: 'DSH workbench',
    manageTitle: 'DeepSeek Harness runtime',
    cmdOpen: 'DSH2Forsion: Open the DSH workbench',
    cmdManage: 'DSH2Forsion: Manage the runtime',
    loading: 'Connecting to DSH…',
    starting: 'Starting DSH…',
    restarting: 'DSH is restarting…',
    failed: 'DSH did not start',
    retry: 'Retry',
    start: 'Start DSH',
    restart: 'Restart DSH',
    stop: 'Stop DSH',
    refresh: 'Refresh',
    openManage: 'Runtime settings',
    openWorkbench: 'Open workbench',
    restoreGood: 'Go back to the last plugin set that started',
    stoppedNote: 'DSH is stopped. It starts again the next time you chat with DSH or press the button below.',
    noHost: 'This version of Forsion cannot open web pages in a tab yet. Update Forsion.',
    noEngine: 'This plugin needs the local engine of Forsion Desktop.',
    onboardTitle: 'Prepare the DSH runtime',
    onboardBody: 'The workbench and chats with the DSH agent connect to one DeepSeek Harness that keeps running in the background. First use downloads its runtime.',
    onboardDownload: 'Downloads Node {node} and DSH {dsh}, about 1.1 GB of disk.',
    onboardSource: 'Source: nodejs.org and the official npm registry, then the China mirror if they fail. You can change this in runtime settings.',
    onboardTrust: 'DSH uses your own DSH folder ({home}), so sessions and skills are the same as in your own DSH. It uses a separate profile named forsion, so plugins you installed in DSH before do not appear here automatically.',
    onboardButton: 'Download and start',
    installing: 'Downloading…',
    incompatibleTitle: 'Waiting for a plugin update',
    incompatibleBody: 'DSH {dsh} does not match this version of DSH2Forsion ({reason}). The workbench is turned off for now.',
    incompatibleChat: 'Chats with the DSH agent fall back to starting DSH for each turn: you can still chat, but DSH plugins that rely on its web interface do not work that way.',
    rollbackRuntime: 'Go back to the previous DSH',
    noPrevious: 'No earlier DSH version that DSH2Forsion has checked is installed on this computer.',
    foreignProfile: 'Your DSH folder already has a profile named forsion that DSH2Forsion did not create, so it was left alone. Rename it in DSH, then try again.',
    reviewChecking: 'Checking {spec}: starting it twice in a scratch folder, about half a minute…',
    reviewTitle: 'Install {name}?',
    reviewTools: 'Adds {n} tools',
    reviewNoTools: 'Adds no tools',
    reviewPrompt: 'Adds {n} characters to the prompt',
    reviewPromptLess: 'Removes {n} characters from the prompt',
    reviewPromptSame: 'Does not change the prompt',
    reviewInactive: 'Some parts did not start',
    reviewAllActive: 'All parts started',
    reviewHosts: 'Connected to these outside hosts while starting',
    reviewNoHosts: 'Connected to no outside hosts while starting',
    reviewBlocked: 'With it, DSH does not start or a core package is overridden. Not recommended.',
    reviewVersion: 'DSH says this plugin does not state support for the current version. If you allow it, DSH asks once more whether to accept the risk.',
    reviewFailed: 'The check did not finish: {reason}',
    reviewMeasured: 'Measured by starting DSH in a scratch folder before and after adding it; the hosts are what it actually connected to.',
    reviewAllow: 'Install',
    reviewDeny: 'Don\'t install',
    reviewTimeout: 'No answer in 15 minutes counts as don\'t install.',
    reviewBuildsNeeded: 'Needs native build scripts',
    reviewBuildsHow: 'DSH does not run build scripts you have not allowed: this install will fail, and DSH\'s plugin page then offers "Allow these scripts and retry". Allowing them there brings this check back once more (the check itself does not run them).',
    reviewBuildsApproved: 'You allowed these build scripts in DSH (they run during the install, not during the check)',
    reviewBuildsAllowed: 'This profile already allows these build scripts (they run during the install, not during the check)',
    reviewBuildsSkipped: 'The profile settings skip these build scripts (features that need them may not work)',
    reviewBuildsUnknown: 'Needs native build scripts (the profile settings could not be read, so whether they are allowed is unknown)',
    reviewBuildsUnread: 'Could not tell whether it needs build scripts',
    reviewBuildsHowMaybe: 'If they were never allowed, this install fails and DSH\'s plugin page offers "Allow these scripts and retry".',
    reviewRestart: 'If DSH\'s plugin page then says it loads at the next start, click "Restart DSH" on the Harness card.',
    rowRuntime: 'Runtime',
    rowChannel: 'Update channel',
    rowPlugins: 'DSH plugins',
    stateRunning: 'DSH {dsh} · running',
    stateStarting: 'DSH {dsh} · starting',
    stateStopped: 'DSH {dsh} · stopped',
    stateFailed: 'DSH {dsh} · failed to start',
    stateMissing: 'Not downloaded yet',
    stateIncompatible: 'DSH {dsh} · does not match the plugin',
    channelPinned: 'Pinned (checked {dsh})',
    channelFollow: 'Follow (newer versions checked daily)',
    channelUnpublished: 'The follow channel is not open yet; staying on {dsh}.',
    channelLatest: 'The newest on the channel is {dsh}.',
    pluginsCount: '{n}',
    pluginsNone: 'None yet',
    pluginsReading: 'Reading…',
    pluginsManage: 'Manage',
    pluginsHint: 'Install them on DSH\'s own Plugins page in the workbench; each is checked first.',
    openInWorkbench: 'Open in the DSH workbench',
    holdNoSession: 'This conversation has not run on DSH yet. Opening the workbench.',
    holdBusy: 'This conversation is running or open elsewhere in DSH. Opening the workbench.',
    holdFailed: 'Could not hand this conversation to the workbench: {reason}',
    sectionRuntime: 'Runtime',
    sectionPlugins: 'DSH plugins',
    sectionLogs: 'Logs',
    sectionTools: 'Tools offered to Tangu',
    versionsLine: 'Using DSH {dsh} · this plugin version checked {pinned} · installed: {installed}',
    homeLine: 'DSH folder {home} · profile {profile}',
    checkChannel: 'Check for a newer DSH',
    noPlugins: 'No DSH plugins in this profile yet. Install them on DSH\'s own Plugins page in the workbench.',
    remove: 'Uninstall',
    removed: 'Uninstalled {name}.',
    rollback: 'Undo the last plugin change',
    rolledBack: 'Undone.',
    nothingToRollBack: 'Nothing to undo.',
    rollbackFailed: 'Undo failed: ',
    pluginOk: 'On',
    pluginOff: 'Off',
    pluginError: 'Error',
    toolsOff: 'DSH plugin tools are not offered to Tangu by default: hand work that needs a DSH plugin to the DSH agent. You can turn this on in the plugin settings.',
    toolsOn: '{n} tools offered to Tangu: {list}',
    busy: 'Working on: {job}',
    restartNote: 'Restarting DSH interrupts DSH chats that are running.',
    oldHostResident: 'This version of Forsion cannot connect DSH chats to this DSH yet: each turn still starts its own DSH, and the workbench does not show those chats. Update Forsion to connect them.',
    oldHostSurfaceTitle: 'Update Forsion',
    oldHostSurface: 'This version of Forsion has no controlled web surface for plugins, so the DSH workbench cannot open. Update Forsion, then open it again; DSH chats still work.',
    railTitle: 'DSH',
    railNoSessionTitle: 'Not started yet',
    railNoSession: 'Send a message, and DSH\'s pages show up here.',
    railStoppedTitle: 'DSH isn\'t running',
    railStopped: 'Start it, and this conversation\'s pages in DSH show up here.',
    railStart: 'Start DSH',
    railMismatchTitle: 'This DSH version doesn\'t fit the right sidebar',
    railMismatch: 'A DSH update changed its right sidebar, and the fusion plugin hasn\'t caught up yet. Use the workbench for now.',
    railNotInstalledTitle: 'DSH isn\'t set up yet',
    railNotInstalled: 'Set up DSH in the workbench, and its pages show up here.',
    railFailedTitle: 'DSH\'s page can\'t open here',
    railFailed: '{reason}',
    railTimeout: 'DSH\'s page never answered.',
    railOpenWorkbench: 'Open the workbench',
    railOldHost: 'This version of Forsion can\'t make the sidebar follow the conversation yet. Update Forsion to use it; the workbench still works.',
  },
}

const lang = () => (ctx.getLocale?.() ?? 'zh') === 'en' ? 'en' : 'zh'
const t = (key, vars = {}) => String(STRINGS[lang()][key] ?? STRINGS.zh[key] ?? key).replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''))
// 给宿主画的文案（Harness 行、右键菜单）：两种语言都给，宿主画的那一刻挑
const both = (key, vars = {}) => ({ zh: String(STRINGS.zh[key]).replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? '')), en: String(STRINGS.en[key]).replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? '')) })

const CSS = `
.d2f { box-sizing: border-box; height: 100%; color: var(--text); font: 13px/1.5 var(--font-ui); }
.d2f * { box-sizing: border-box; }
.d2f-space { display: flex; flex-direction: column; height: 100%; position: relative; }
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
.d2f-review { position: absolute; right: 16px; bottom: 16px; width: min(420px, calc(100% - 32px)); max-height: calc(100% - 32px); overflow: auto; display: grid; gap: 10px; padding: 14px 16px; border-radius: var(--radius-lg, 10px); border: 1px solid var(--border); background: var(--surface-overlay, var(--bg)); box-shadow: var(--shadow-overlay, 0 8px 28px rgba(0,0,0,.18)); z-index: 2; }
.d2f-review[hidden] { display: none; }
.d2f-review h3 { margin: 0; font-size: 14px; font-weight: 600; overflow-wrap: anywhere; }
.d2f-review ul { margin: 0; padding-left: 18px; display: grid; gap: 4px; }
.d2f-review code { font: 11.5px/1.45 var(--font-mono); overflow-wrap: anywhere; }
.d2f-review .d2f-row { justify-content: flex-end; }
.d2f-rail-box { flex: 1; min-height: 0; display: flex; }
.d2f-rail-box[hidden] { display: none; }
.d2f-rail-note { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; padding: 28px; text-align: center; color: var(--text-faint); }
.d2f-rail-note[hidden] { display: none; }
.d2f-rail-note-title { font-family: var(--font-body); font-size: var(--ui-font-heading, 14px); color: var(--text-muted); }
.d2f-rail-note-body { font-size: var(--ui-font-body, 13px); line-height: 1.6; max-width: 280px; color: var(--text-muted); overflow-wrap: anywhere; }
.d2f-rail-note .d2f-btn { padding: 4px 10px; font-size: var(--ui-font-meta, 12px); background: transparent; border-color: var(--overlay-strong, var(--border)); }
.d2f-rail-note .d2f-btn:hover { background: transparent; border-color: var(--accent-ink, var(--accent)); color: var(--accent-ink, var(--accent)); }
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

const openWorkbench = () => ctx.openView?.('workbench', { location: 'main' })

// 工作台落点：右键「在 DSH 工作台里打开」拿到 DSH 那边的会话 id 后，让工作台落到这一场。
// 地址 # 后面带 d2f-session=<id>&n=<序号>，由桥的网页端小模块（dsh-bridge/client.js）读到后调 DSH 自己的 openSession。
let landing = null
let landSeq = 0
const landers = new Set()
const landingHash = (l) => `#d2f-session=${encodeURIComponent(l.id)}&n=${l.n}`
const landOn = (id) => {
  landing = { id, n: ++landSeq, at: Date.now() }
  for (const land of landers) land()
}
// 一分钟内没用上（工作台没开成）就作废，免得下次随手打开工作台时跳到很早以前点过的那一场
const takeLanding = () => {
  const l = landing
  landing = null
  return l && Date.now() - l.at < 60_000 ? l : null
}

// ── DSH 工作台：主区页签，里面是常驻那个 DSH 自己的网页界面（不换肤、不藏元素）。关掉页签不停 DSH。──────────

ctx.registerView({
  id: 'workbench',
  title: t('workbenchTitle'),
  icon: 'boxes',
  mount(el) {
    let alive = true
    let surface = null
    const root = h('div', { class: 'd2f d2f-space', 'data-d2f': 'workbench' })
    withStyle(root)
    const body = h('div', { class: 'd2f-surface' })
    const review = h('div', { class: 'd2f-review', hidden: true, 'data-d2f': 'review' })
    root.append(body, review)
    el.append(root)

    // phase：surface = 嵌着 DSH 页面；waiting = 等它重启回来；其余（loading / onboarding / failed / incompatible）由用户操作推进
    let phase = 'loading'
    let mountedBase = null
    let seenSeq = 0
    const maxSeq = (events) => events.reduce((n, e) => Math.max(n, Number(e.seq) || 0), 0)
    let mountedUrl = null
    const dropSurface = () => { if (surface) { surface.dispose(); surface = null } mountedBase = null; mountedUrl = null }
    const show = (...nodes) => { dropSurface(); body.replaceChildren(h('div', { class: 'd2f-center' }, ...nodes)) }

    const syncAppearance = () => { void call('/appearance', { method: 'POST', body: hostAppearance() }).catch(() => {}) }
    const modeObserver = new MutationObserver(syncAppearance)
    modeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-mode'] })
    const offLocale = ctx.subscribeLocale?.(() => syncAppearance())

    const mountSurface = (url) => {
      dropSurface()
      body.replaceChildren()
      // 旧宿主没有受控网页容器：不退回裸 <webview>（那会进内置浏览器的分区、还能跳出本机），请用户更新 Forsion
      if (!ctx.ui?.mountWebSurface) {
        phase = 'old-host'
        show(h('div', { class: 'd2f-card', 'data-d2f': 'old-host' }, h('h2', {}, t('oldHostSurfaceTitle')), h('p', {}, t('oldHostSurface'))))
        return
      }
      const first = takeLanding()
      const src = first ? url + landingHash(first) : url
      // 受控网页容器（宿主管分区、导航只许回环、权限、销毁）。不能用 iframe：DSH 的登录 cookie 是 SameSite=Strict。
      const handle = ctx.ui.mountWebSurface(body, { url: src, partition: 'workbench', onLoadFail: () => { if (alive && phase === 'surface') void open() } })
      surface = { dispose: () => handle?.dispose?.(), reload: () => handle?.reload?.(), navigate: (u) => handle?.navigate?.(u), focus: () => handle?.focus?.() }
      phase = 'surface'
      mountedBase = new URL(url).origin
      mountedUrl = url
      syncAppearance()
    }

    const failed = (message) => {
      phase = 'failed'
      show(h('div', { class: 'd2f-card' },
        h('h2', {}, t('failed')),
        h('p', { class: 'd2f-error' }, message),
        h('div', { class: 'd2f-row' },
          h('button', { class: 'd2f-btn primary', onclick: () => void open() }, t('retry')),
          h('button', { class: 'd2f-btn', onclick: () => void restoreGood() }, t('restoreGood')),
          h('button', { class: 'd2f-btn', onclick: () => openManage() }, t('openManage')))))
    }

    const restoreGood = async () => {
      show(h('p', { class: 'd2f-muted' }, t('starting')))
      try { await call('/plugins/restore-last-good', { method: 'POST' }); await open() }
      catch (error) { if (alive) failed(String(error.message ?? error)) }
    }

    const incompatibleCard = (inc, previous) => {
      phase = 'incompatible'
      const back = h('button', { class: 'd2f-btn primary', 'data-act': 'runtime-previous', onclick: async () => {
        back.disabled = true
        try { await call('/runtime/previous', { method: 'POST' }); await open() } catch (error) { if (alive) failed(String(error.message ?? error)) }
      } }, t('rollbackRuntime'))
      if (!previous) back.disabled = true
      show(h('div', { class: 'd2f-card', 'data-d2f': 'incompatible' },
        h('h2', {}, t('incompatibleTitle')),
        h('p', {}, t('incompatibleBody', { dsh: inc.dshVersion, reason: inc.reason })),
        h('p', { class: 'd2f-warn' }, t('incompatibleChat')),
        h('div', { class: 'd2f-row' }, back, h('button', { class: 'd2f-btn', onclick: () => openManage() }, t('openManage'))),
        previous ? null : h('p', { class: 'd2f-muted' }, t('noPrevious'))))
    }

    const onboarding = (status) => {
      const button = h('button', { class: 'd2f-btn primary' }, t('onboardButton'))
      const log = h('pre', { class: 'd2f-log' })
      const card = h('div', { class: 'd2f-card' },
        h('h2', {}, t('onboardTitle')),
        h('p', {}, t('onboardBody')),
        h('p', {}, t('onboardDownload', { node: status.nodeVersion, dsh: status.dshVersion })),
        h('p', { class: 'd2f-muted' }, t('onboardSource')),
        h('p', { class: 'd2f-warn' }, t('onboardTrust', { home: status.fusion?.home ?? '~/.dsh' })),
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
      seenSeq = Math.max(seenSeq, maxSeq(status.fusion?.events ?? []))
      if (!status.runtime?.installed) { onboarding(status); return }
      if (status.fusion?.profileError) { failed(t('foreignProfile')); return }
      if (status.sidecar?.state !== 'running') show(h('p', { class: 'd2f-muted' }, t('starting')))
      try {
        const r = await call('/workbench', { method: 'POST' })
        if (!alive) return
        if (r.incompatible) { incompatibleCard(r.incompatible, r.previous); return }
        if (!r.url) throw new Error('no url')
        mountSurface(r.url)
      } catch (error) {
        if (!alive) return
        let s = status
        try { s = await call('/status') } catch { /* 用旧状态 */ }
        if (s?.fusion?.incompatible) { incompatibleCard(s.fusion.incompatible, s.runtime?.previous); return }
        failed(s?.fusion?.profileError ? t('foreignProfile') : (s?.sidecar?.error ?? String(error.message ?? error)))
      }
    }

    // 常驻 DSH 重启后端口和登录令牌都会变：地址变了就重新嵌入；停了、挂了就换成对应的卡片。
    // 宿主替对话关掉重开了一场会话（交接内容变了）：网页界面里开着的那一场要重载才接得上。
    let checking = false
    const watch = setInterval(async () => {
      if (!alive || checking || (phase !== 'surface' && phase !== 'waiting')) return
      checking = true
      try {
        const s = await call('/status')
        notePlugins(s)
        if (!alive || (phase !== 'surface' && phase !== 'waiting')) return
        const st = s.sidecar?.state
        const events = s.fusion?.events ?? []
        if (st === 'running' && s.sidecar.base && s.sidecar.base !== mountedBase) await open()
        else if (s.fusion?.incompatible) incompatibleCard(s.fusion.incompatible, s.runtime?.previous)
        else if (st === 'failed') failed(s.sidecar.error ?? t('failed'))
        else if (st === 'starting' && phase === 'surface') { phase = 'waiting'; show(h('p', { class: 'd2f-muted' }, t('restarting'))) }
        else if (st === 'stopped') {
          phase = 'stopped'
          show(h('div', { class: 'd2f-card' }, h('p', {}, t('stoppedNote')),
            h('div', { class: 'd2f-row' }, h('button', { class: 'd2f-btn primary', onclick: () => void open() }, t('start')))))
        } else if (phase === 'surface' && maxSeq(events) > seenSeq) {
          const fresh = events.filter(e => (Number(e.seq) || 0) > seenSeq)
          seenSeq = maxSeq(events)
          if (fresh.some(e => e.type === 'reopened')) surface?.reload()
        }
      } catch { /* 引擎一时不通：下一轮再看 */ } finally { checking = false }
    }, WATCH_MS)

    // 装插件体检：工作台里 DSH 自己的插件页点了安装 → 桥停住 → 这里显示体检进度和报告 → 用户决定
    let decided = new Set()
    const renderReview = (items) => {
      const live = items.filter(r => (r.state === 'checking' || r.state === 'ready') && !decided.has(r.id))
      if (!live.length) { review.hidden = true; review.replaceChildren(); return }
      const r = live[0]
      if (review.dataset.id === r.id && review.dataset.state === r.state) return
      review.dataset.id = r.id
      review.dataset.state = r.state
      review.hidden = false
      if (r.state === 'checking') {
        review.replaceChildren(h('p', { class: 'd2f-muted' }, t('reviewChecking', { spec: r.spec })))
        return
      }
      const rep = r.report ?? {}
      const name = rep.name ? `${rep.name}${rep.version ? ` ${rep.version}` : ''}` : r.spec
      const decide = allow => async () => {
        decided.add(r.id)
        review.hidden = true
        try { await call('/reviews/decide', { method: 'POST', body: { id: r.id, allow } }) }
        catch (error) { ctx.notify?.(String(error.message ?? error), { level: 'error' }) }
      }
      const lines = []
      if (r.error || rep.verdict === 'failed') lines.push(h('li', { class: 'd2f-error' }, t('reviewFailed', { reason: r.error ?? (rep.reasons ?? []).join('; ') })))
      else if (rep.verdict === 'version-refused') lines.push(h('li', {}, t('reviewVersion')))
      else {
        if (rep.verdict === 'blocked') lines.push(h('li', { class: 'd2f-error' }, t('reviewBlocked')))
        lines.push(h('li', {}, rep.tools?.length ? [t('reviewTools', { n: rep.tools.length }), ': ', h('code', {}, rep.tools.join(', '))] : t('reviewNoTools')))
        const pc = rep.promptChars ?? 0
        lines.push(h('li', {}, pc > 0 ? t('reviewPrompt', { n: pc }) : pc < 0 ? t('reviewPromptLess', { n: -pc }) : t('reviewPromptSame')))
        lines.push(h('li', { class: rep.inactive?.length ? 'd2f-error' : '' }, rep.inactive?.length ? [t('reviewInactive'), ': ', h('code', {}, rep.inactive.join(' · '))] : t('reviewAllActive')))
        lines.push(h('li', {}, rep.hosts?.length ? [t('reviewHosts'), ': ', h('code', {}, rep.hosts.join(', '))] : t('reviewNoHosts')))
        // 要跑构建脚本的依赖（体检不跑）：没人允许过的，真装时 DSH 会报错；允许的入口在 DSH 自己的插件页
        if (rep.builds === null) lines.push(h('li', {}, t('reviewBuildsUnread')))
        for (const [state, key, cls] of [['needs', 'reviewBuildsNeeded', 'd2f-error'], ['unknown', 'reviewBuildsUnknown', ''], ['approved', 'reviewBuildsApproved', ''], ['allowed', 'reviewBuildsAllowed', ''], ['skipped', 'reviewBuildsSkipped', '']]) {
          const keys = (rep.builds ?? []).filter(b => b.state === state).map(b => b.key)
          if (keys.length) lines.push(h('li', { class: cls, 'data-builds': state }, [t(key), ': ', h('code', {}, keys.join(', '))]))
        }
      }
      const needsBuilds = (rep.builds ?? []).some(b => b.state === 'needs')
      const maybeBuilds = !needsBuilds && (rep.builds ?? []).some(b => b.state === 'unknown')
      const failed = !!(r.error || rep.verdict === 'failed')
      // 有的段落按条件才有（null）：replaceChildren 会把 null 当成文字「null」，先滤掉
      review.replaceChildren(...[
        h('h3', {}, t('reviewTitle', { name })),
        h('ul', {}, ...lines),
        needsBuilds ? h('p', { class: 'd2f-muted', 'data-builds-how': '' }, t('reviewBuildsHow')) : null,
        maybeBuilds ? h('p', { class: 'd2f-muted', 'data-builds-how': 'maybe' }, t('reviewBuildsHowMaybe')) : null,
        h('p', { class: 'd2f-muted' }, t('reviewMeasured')),
        failed ? null : h('p', { class: 'd2f-muted' }, t('reviewRestart')),
        h('p', { class: 'd2f-muted' }, t('reviewTimeout')),
        h('div', { class: 'd2f-row' },
          h('button', { class: 'd2f-btn', 'data-act': 'review-deny', onclick: decide(false) }, t('reviewDeny')),
          h('button', { class: `d2f-btn ${rep.verdict === 'blocked' ? 'danger' : 'primary'}`, 'data-act': 'review-allow', onclick: decide(true) }, t('reviewAllow'))),
      ].filter(Boolean))
    }
    let reviewTimer = null
    const pollReviews = async () => {
      if (!alive) return
      try { if (phase === 'surface') renderReview((await call('/reviews')).reviews ?? []) } catch { /* 下一轮再看 */ }
      if (alive) reviewTimer = setTimeout(pollReviews, REVIEW_MS)
    }
    reviewTimer = setTimeout(pollReviews, REVIEW_MS)

    // 已经开着的工作台：只换地址 # 那段（宿主照页面此刻的地址算，同一个页面里跳，不重载）；还没嵌好页面的，等 mountSurface 带上
    const land = () => {
      if (phase !== 'surface' || !surface?.navigate || !mountedUrl || !landing) { if (landing) console.info('[dsh2forsion] landing waits for the page', phase); return }
      const l = takeLanding()
      if (l) { console.info('[dsh2forsion] landing on', l.id); surface.navigate(landingHash(l)) }
      surface.focus?.()
    }
    landers.add(land)

    void open()
    return () => {
      alive = false
      landers.delete(land)
      clearInterval(watch)
      clearTimeout(reviewTimer)
      modeObserver.disconnect()
      offLocale?.()
      dropSurface()
      root.remove()
    }
  },
})

// ── Harness 卡上的几行 + 对话右键菜单（宿主画，插件给数据）────────────────────────────────

const openManage = () => {
  if (ctx.app?.openSettings && ctx.registerSettingsView) ctx.app.openSettings('fplugin:dsh2forsion')
  else ctx.openView?.('manage')
}

let harness = null
// 用户装的 DSH 插件变了(工作台里装 / 卸):开着的 Harness 卡别停在旧的个数上,让宿主重取一次行
let pluginsKey = null
// 第一次只记下；之后谁先看到变了（工作台的轮询或某张卡取行）都让宿主把所有卡重取一次，重取时指纹不变就停
const notePlugins = (s) => {
  const key = s?.plugins?.key
  if (typeof key !== 'string') return
  const changed = pluginsKey !== null && key !== pluginsKey
  pluginsKey = key
  if (changed) harness?.refresh()
}
const stateKey = s => {
  if (!s.runtime?.installed) return ['stateMissing', 'neutral']
  if (s.fusion?.incompatible) return ['stateIncompatible', 'danger']
  return ({ running: ['stateRunning', 'ok'], starting: ['stateStarting', 'neutral'], stopped: ['stateStopped', 'neutral'], failed: ['stateFailed', 'danger'] })[s.sidecar?.state] ?? ['stateStopped', 'neutral']
}

// 宿主只在画卡片时取一次行数据：还在过渡（正在启动、正在下载）就过一会儿再让它取一次，直到稳定下来
let settleTimer = null
const settleLater = () => {
  if (settleTimer) return
  settleTimer = setTimeout(() => { settleTimer = null; harness?.refresh() }, SETTLE_MS)
}

// 宿主取行有 5 秒上限，超时或抛错就当这次没有行、之后不会自己再取：每一步都限时，取不到就过一会儿让它再取（有上限）
const within = (promise, ms) => Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error('timed out')), ms))])
let rowMisses = 0
async function harnessRows() {
  let s
  try { s = await within(call('/status'), 3000) } catch {
    if (++rowMisses <= 20) settleLater()
    return []
  }
  rowMisses = 0
  notePlugins(s)
  if (s.sidecar?.state === 'starting' || s.job?.running) settleLater()
  let plugins = []
  if (s.runtime?.installed && s.sidecar?.state === 'running') {
    try { plugins = (await within(call('/plugins'), 1500)).plugins ?? [] } catch { plugins = null; settleLater() }
  }
  const [key, tone] = stateKey(s)
  const refresh = () => harness?.refresh()
  const runtime = {
    id: 'runtime', label: both('rowRuntime'), text: both(key, { dsh: s.dshVersion }), tone,
    actions: s.fusion?.incompatible
      ? [{ id: 'runtime-previous', label: both('rollbackRuntime'), primary: true, disabled: !s.runtime?.previous, run: () => { void call('/runtime/previous', { method: 'POST' }).catch(e => ctx.notify?.(String(e.message ?? e), { level: 'error' })).finally(refresh) } }]
      : [
        { id: 'open-workbench', label: both('openWorkbench'), primary: true, run: openWorkbench },
        ...(s.runtime?.installed ? [{ id: 'restart-dsh', label: both('restart'), run: () => { void call('/sidecar/restart', { method: 'POST' }).catch(e => ctx.notify?.(String(e.message ?? e), { level: 'error' })).finally(refresh) } }] : []),
      ],
    hint: s.fusion?.incompatible ? { zh: `${STRINGS.zh.incompatibleTitle}。${STRINGS.zh.incompatibleChat}${s.runtime?.previous ? '' : STRINGS.zh.noPrevious}`, en: `${STRINGS.en.incompatibleTitle}. ${STRINGS.en.incompatibleChat}${s.runtime?.previous ? '' : ` ${STRINGS.en.noPrevious}`}` } : undefined,
  }
  const channel = {
    id: 'channel', label: both('rowChannel'),
    select: {
      value: s.settings?.updateChannel ?? 'pinned',
      options: [{ value: 'pinned', label: both('channelPinned', { dsh: s.pinnedVersion }) }, { value: 'follow', label: both('channelFollow') }],
      onChange: (value) => { void call('/channel/set', { method: 'POST', body: { updateChannel: value } }).catch(e => ctx.notify?.(String(e.message ?? e), { level: 'error' })).finally(refresh) },
    },
    hint: s.settings?.updateChannel === 'follow'
      ? (s.channel?.published === false ? both('channelUnpublished', { dsh: s.dshVersion }) : s.channel?.latest ? both('channelLatest', { dsh: s.channel.latest }) : undefined)
      : undefined,
  }
  const pluginsRow = {
    id: 'dsh-plugins', label: both('rowPlugins'), text: plugins === null ? both('pluginsReading') : plugins.length ? both('pluginsCount', { n: plugins.length }) : both('pluginsNone'),
    actions: [{ id: 'manage-plugins', label: both('pluginsManage'), run: openWorkbench }],
    hint: both('pluginsHint'),
  }
  return [runtime, channel, pluginsRow]
}

// ── 右栏页（第 2 档）：DSH 跑的对话，右栏「详情 / 文件 / 大纲」后面多一页，里面是 DSH 右侧栏本来的样子 ──────────
// 宿主按 registerEngineHarness 的 railView 补上 / 关掉这一页（换到别处跑的对话就关），这里只管跟着当前对话：
// 先在常驻 DSH 里接上这一场（hold），再拿登录地址和回报口令，嵌 DSH 的网页、地址 # 带「哪一页、哪一场、口令、序号」，
// 由桥的网页端小模块（dsh-bridge/client.js 的右栏模式）只画右侧栏那一页，并把开没开成报回来。
const RAIL_WAIT_MS = 16_000 // 比网页那边的时限（会话上屏 8 秒 + 等页登记 5 秒）多留一点
// 这一程里右栏开过的 DSH 会话：头一次开「文件」，之后不指定页（*），留着 DSH 为这一场记住的那页
const railShown = new Set()

ctx.registerView({
  id: 'rail',
  title: both('railTitle'),
  icon: 'boxes',
  mount(el) {
    let alive = true
    let gen = 0 // 每次换场 / 重来加一：晚回来的旧请求不许改界面
    let surface = null
    let base = null
    let seq = 0
    let state = 'loading'
    let current // 正在跟的 Forsion 会话（null = 新对话还没发）
    const root = h('div', { class: 'd2f d2f-space', 'data-d2f': 'rail' })
    withStyle(root)
    const box = h('div', { class: 'd2f-rail-box', hidden: true })
    const note = h('div', { class: 'd2f-rail-note', 'data-d2f': 'rail-note' })
    root.append(box, note)
    el.append(root)

    const drop = () => { if (surface) { surface.dispose?.(); surface = null } base = null }
    // 说明：标题 + 一句 + 至多一个按钮。网页容器只在 DSH 那页作废时才拆（没开始的对话、DSH 停了），换回来不用重登
    const say = (st, title, body, button) => {
      state = st
      note.dataset.state = st
      note.replaceChildren(h('div', { class: 'd2f-rail-note-title' }, title), h('div', { class: 'd2f-rail-note-body' }, body), ...(button ? [button] : []))
      note.hidden = false
      box.hidden = true
    }
    const wbButton = () => h('button', { class: 'd2f-btn', 'data-act': 'rail-workbench', onclick: () => openWorkbench() }, t('railOpenWorkbench'))
    const failed = (reason) => { drop(); say('failed', t('railFailedTitle'), t('railFailed', { reason }), wbButton()) }
    const mismatch = () => { drop(); say('mismatch', t('railMismatchTitle'), t('railMismatch'), wbButton()) }
    const stopped = () => {
      drop()
      const start = h('button', { class: 'd2f-btn', 'data-act': 'rail-start', onclick: async () => {
        start.disabled = true
        try { await call('/sidecar/start', { method: 'POST' }) } catch (error) { if (alive) failed(String(error.message ?? error)); return }
        if (alive) void show(current)
      } }, t('railStart'))
      say('stopped', t('railStoppedTitle'), t('railStopped'), start)
    }

    const syncAppearance = () => { void call('/appearance', { method: 'POST', body: hostAppearance() }).catch(() => {}) }
    const modeObserver = new MutationObserver(syncAppearance)
    modeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-mode'] })
    const offLocale = ctx.subscribeLocale?.(() => syncAppearance())

    // 等这一次导航的回报（同一口令、同一序号）：开成了就亮出网页，别的都换成说明，不自己重试
    const awaitReport = async (my, nonce, n) => {
      const until = Date.now() + RAIL_WAIT_MS
      while (alive && my === gen && Date.now() < until) {
        await sleep(300)
        if (!alive || my !== gen) return
        let r
        try { r = await call('/rail/report', { method: 'POST', body: { nonce } }) } catch { continue }
        if (!alive || my !== gen) return
        if (r?.stopped) { stopped(); return }
        const rep = r?.report
        if (!rep || rep.n !== String(n)) continue
        if (rep.state === 'ok') { state = 'surface'; note.hidden = true; box.hidden = false; box.style.visibility = ''; return }
        if (rep.state === 'incompatible') { mismatch(); return }
        if (rep.state === 'no-session') { say('no-session', t('railNoSessionTitle'), t('railNoSession')); return }
        failed(rep.reason || rep.state)
        return
      }
      if (alive && my === gen) failed(t('railTimeout'))
    }

    const show = async (sid) => {
      const my = ++gen
      // 换场 / 重来:上一场的网页先遮住(不拆,同一页只换 #),这一次的回报说开成了再亮出来 —— 中途点不到上一场的文件
      if (state === 'surface') { state = 'loading'; box.style.visibility = 'hidden' }
      if (!sid) { say('no-session', t('railNoSessionTitle'), t('railNoSession')); return }
      if (!ctx.ui?.mountWebSurface) { say('old-host', t('oldHostSurfaceTitle'), t('oldHostSurface')); return }
      let status
      try { status = await call('/status') } catch (error) { if (alive && my === gen) failed(String(error.message ?? error)); return }
      if (!alive || my !== gen) return
      if (!status.runtime?.installed) { drop(); say('not-installed', t('railNotInstalledTitle'), t('railNotInstalled'), wbButton()); return }
      if (status.fusion?.incompatible) { mismatch(); return }
      if (status.sidecar?.state !== 'running') { stopped(); return }
      let held
      try { held = await call('/hold', { method: 'POST', body: { sessionId: sid } }) } catch (error) { if (alive && my === gen) failed(String(error.message ?? error)); return }
      if (!alive || my !== gen) return
      if (held?.ok !== true || !held.engineSessionId) {
        // DSH 那边还没有这一场（还没发过话）：不替它建，等发了再来
        if (held?.code === 'no_engine_session') say('no-session', t('railNoSessionTitle'), t('railNoSession'))
        else failed(held?.detail ?? held?.code ?? 'hold failed')
        return
      }
      const esid = String(held.engineSessionId)
      let rail
      try { rail = await call('/rail', { method: 'POST' }) } catch (error) { if (alive && my === gen) failed(String(error.message ?? error)); return }
      if (!alive || my !== gen) return
      if (rail?.incompatible) { mismatch(); return }
      if (!rail?.url || !rail.nonce) { failed('no url'); return }
      const kind = railShown.has(esid) ? '*' : 'files'
      railShown.add(esid)
      const n = ++seq
      const hash = `#d2f-rail=${encodeURIComponent(kind)}&d2f-session=${encodeURIComponent(esid)}&d2f-nonce=${encodeURIComponent(rail.nonce)}&n=${n}`
      if (surface && base === rail.base) {
        surface.navigate?.(hash) // 同一页只换 #：不重载、不重登
      } else {
        drop()
        box.replaceChildren()
        const handle = ctx.ui.mountWebSurface(box, { url: rail.url + hash, partition: 'rail', onLoadFail: () => { if (alive && state === 'surface') void show(current) } })
        surface = handle
        base = rail.base
        syncAppearance()
      }
      await awaitReport(my, rail.nonce, n)
    }

    // 跟着当前对话：换了一场就重来；还没开始的那场每次状态变了（发出第一句）再试
    const follow = () => {
      const st = ctx.tangu?.agentStatus?.()
      const sid = st?.sessionId ?? null
      if (sid === current && state !== 'no-session') return
      if (sid === current && state === 'no-session' && (!sid || st?.phase === 'idle')) return
      current = sid
      void show(sid)
    }
    const offStatus = ctx.tangu?.subscribeAgentStatus?.(() => follow())
    if (!ctx.tangu?.agentStatus) say('old-host', t('oldHostSurfaceTitle'), t('railOldHost'))
    else { current = undefined; follow() }

    // 常驻 DSH 重启（端口和令牌都换了）/ 停了 / 对不上：跟工作台同一套盯法
    let checking = false
    const watch = setInterval(async () => {
      if (!alive || checking || state !== 'surface') return
      checking = true
      try {
        const s = await call('/status')
        if (!alive || state !== 'surface') return
        const st = s.sidecar?.state
        if (s.fusion?.incompatible) mismatch()
        else if (st === 'stopped' || st === 'failed') stopped()
        else if (st === 'running' && s.sidecar.base && s.sidecar.base !== base) { drop(); void show(current) }
      } catch { /* 一时不通：下一轮再看 */ } finally { checking = false }
    }, WATCH_MS)

    return () => {
      alive = false
      gen++
      clearInterval(watch)
      offStatus?.()
      offLocale?.()
      modeObserver.disconnect()
      drop()
      root.remove()
    }
  },
})

// 先后右键了两场：只认最后点的那一场（先点的那场晚回来，不能把落点改回去）
let holdGen = 0
const holdThenOpen = async ({ sessionId }) => {
  const gen = ++holdGen
  landing = null // 前一场还没用上的落点作废：这次 hold 没成功时，工作台不能落到上一场
  try {
    const r = await call('/hold', { method: 'POST', body: { sessionId } })
    if (gen !== holdGen) return
    console.info('[dsh2forsion] hold', r?.ok === true ? `ok ${r.engineSessionId}` : r?.code ?? 'error', `landers ${landers.size}`)
    if (r?.ok === true && r.engineSessionId) landOn(String(r.engineSessionId))
    if (r && r.ok === false) {
      const key = r.code === 'no_engine_session' ? 'holdNoSession' : r.code === 'busy' || r.code === 'gone' ? 'holdBusy' : null
      ctx.notify?.(key ? t(key) : t('holdFailed', { reason: r.detail ?? r.code }), { level: key ? 'info' : 'warning' })
    }
  } catch (error) {
    if (gen !== holdGen) return
    ctx.notify?.(t('holdFailed', { reason: String(error.message ?? error) }), { level: 'warning' })
  }
  openWorkbench()
}

if (ctx.registerEngineHarness) {
  harness = ctx.registerEngineHarness({
    engineId: ENGINE_ID,
    rows: () => harnessRows(),
    sessionActions: [{ id: 'open-in-workbench', label: both('openInWorkbench'), icon: 'boxes', run: (target) => { void holdThenOpen(target) } }],
    // 第 2 档：DSH 跑的对话右栏多一页（上面的 rail 视图）。不认这一项的旧宿主忽略它
    railView: 'rail',
  })
}

// ── 运行时管理页（插件详情页）─────────────────────────────────────────────────

function managePanel(el) {
  let alive = true
  const root = h('div', { class: 'd2f d2f-manage' })
  withStyle(root)
  el.append(root)
  const result = h('div', { class: 'd2f-result' })

  const act = async (fn) => {
    try { await fn() } catch (error) { result.replaceChildren(h('p', { class: 'd2f-error' }, String(error.message ?? error))) }
    harness?.refresh() // 卸载 / 回滚之后 Harness 卡上的个数跟着变
    if (alive) await render()
  }

  const resolveText = (v) => {
    if (!v) return null
    if (typeof v === 'string') return v
    return v[lang()] ?? v.en ?? v.zh ?? Object.values(v)[0] ?? null
  }

  const render = async () => {
    let s, plugins = [], logs = { lines: [], sidecar: [] }
    try {
      s = await call('/status')
      if (s.runtime?.installed && s.sidecar?.state === 'running') ({ plugins } = await call('/plugins'))
      logs = await call('/logs')
    } catch (error) {
      root.replaceChildren(h('p', { class: 'd2f-error' }, String(error.message ?? error)))
      withStyle(root)
      return
    }
    if (!alive) return
    const state = s.sidecar?.state
    const [key] = stateKey(s)
    const runtime = h('section', { class: 'd2f-section' },
      h('h3', {}, t('sectionRuntime')),
      h('p', {}, t(key, { dsh: s.dshVersion }) + (s.sidecar?.error ? ` · ${s.sidecar.error}` : '')),
      h('p', { class: 'd2f-muted' }, t('versionsLine', { dsh: s.dshVersion, pinned: s.pinnedVersion, installed: (s.runtime?.installedVersions ?? []).join(', ') || '—' })),
      h('p', { class: 'd2f-muted' }, t('homeLine', { home: s.fusion?.home ?? '', profile: s.fusion?.profile ?? '' })),
      s.fusion?.incompatible ? h('p', { class: 'd2f-error' }, t('incompatibleBody', { dsh: s.fusion.incompatible.dshVersion, reason: s.fusion.incompatible.reason })) : null,
      s.fusion?.profileError ? h('p', { class: 'd2f-error' }, t('foreignProfile')) : null,
      s.fusion && s.fusion.resident === false ? h('p', { class: 'd2f-warn' }, t('oldHostResident')) : null,
      s.pluginJob ? h('p', { class: 'd2f-muted' }, t('busy', { job: s.pluginJob })) : null,
      h('div', { class: 'd2f-row' },
        s.runtime?.installed && state !== 'running' ? h('button', { class: 'd2f-btn primary', onclick: () => act(() => call('/sidecar/start', { method: 'POST' })) }, t('start')) : null,
        state === 'running' ? h('button', { class: 'd2f-btn', onclick: () => act(() => call('/sidecar/restart', { method: 'POST' })) }, t('restart')) : null,
        state === 'running' ? h('button', { class: 'd2f-btn', onclick: () => act(() => call('/sidecar/stop', { method: 'POST' })) }, t('stop')) : null,
        h('button', { class: 'd2f-btn', onclick: () => openWorkbench() }, t('openWorkbench')),
        h('button', { class: 'd2f-btn', onclick: () => act(() => call('/channel/check', { method: 'POST' })) }, t('checkChannel')),
        h('button', { class: 'd2f-btn', disabled: !s.runtime?.previous, onclick: () => act(() => call('/runtime/previous', { method: 'POST' })) }, t('rollbackRuntime')),
        h('button', { class: 'd2f-btn', onclick: () => void render() }, t('refresh'))),
      h('p', { class: 'd2f-muted' }, t('restartNote')))

    const badge = (p) => {
      if (p.error) return h('span', { class: 'd2f-badge bad' }, `${t('pluginError')}: ${p.error}`)
      return h('span', { class: 'd2f-badge' }, p.enabled === false ? t('pluginOff') : p.enabled ? t('pluginOk') : '')
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
        h('button', { class: 'd2f-btn', onclick: () => act(async () => { const r = await call('/plugins/rollback', { method: 'POST' }); result.replaceChildren(h('p', {}, r.status === 'rolled-back' ? t('rolledBack') : r.status === 'failed' ? `${t('rollbackFailed')} ${r.message ?? ''}` : t('nothingToRollBack'))) }) }, t('rollback'))),
      result)

    const tools = h('section', { class: 'd2f-section' },
      h('h3', {}, t('sectionTools')),
      h('p', { class: 'd2f-muted' }, s.settings?.exposeTools && (s.tools ?? []).length ? t('toolsOn', { n: s.tools.length, list: s.tools.join(', ') }) : t('toolsOff')))

    const logBox = h('section', { class: 'd2f-section' },
      h('details', {}, h('summary', {}, t('sectionLogs')),
        h('pre', { class: 'd2f-log' }, [...(logs.lines ?? []), '', ...(logs.sidecar ?? []).slice(-60)].join('\n'))))

    const style = root.querySelector('style')
    root.replaceChildren(style, runtime, list, tools, logBox)
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
  id: 'dsh2forsion-open-workbench',
  title: () => t('cmdOpen'),
  run: () => openWorkbench(),
})
ctx.registerCommand({
  id: 'dsh2forsion-manage',
  title: () => t('cmdManage'),
  run: () => openManage(),
})
