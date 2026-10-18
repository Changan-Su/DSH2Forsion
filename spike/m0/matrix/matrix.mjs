// DSH2Forsion M0 装载矩阵：前 30 名插件逐个装进独立 profile，再逐个启动、探测、定级。
//
// 分两段跑，第三方代码只在第二段执行：
//   install  有网络。`dsh plugin add --ignore-scripts`，不跑任何安装脚本；
//            版本被拒时记一笔，再按 DSH 的精确豁免（allow-version）重装一次。
//   probe    在无网络的命名空间里、以非 root 用户运行（见 run-matrix.sh）。
//            每个插件起一个 sidecar，读桥的工具表、DSH 的 listBundles、首页启动图、
//            用 Chromium 打开界面收集报错并截图，记内存，然后关掉。
//
// 用法：node matrix.mjs install|probe <corpus.json> <工作目录> <runtime 目录> <bridge 目录> [--only=序号,…]
import { spawn, spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const [mode, corpusPath, work, runtimeDir, bridgeDir, ...rest] = process.argv.slice(2)
const only = rest.find(a => a.startsWith('--only='))?.slice(7).split(',').map(Number)
const DSH_VERSION = JSON.parse(readFileSync(join(runtimeDir, 'node_modules/@deepseek-ai/dsh/package.json'), 'utf8')).version
const BIN = join(runtimeDir, 'node_modules/@deepseek-ai/dsh/lib/bin.js')
const corpus = JSON.parse(readFileSync(corpusPath, 'utf8')).plugins.filter(p => !only || only.includes(p.rank))
const resultsPath = join(work, 'results.json')
const results = existsSync(resultsPath) ? JSON.parse(readFileSync(resultsPath, 'utf8')) : {}
const save = () => writeFileSync(resultsPath, JSON.stringify(results, null, 1))

function dsh(home, args, timeout = 300_000) {
  const r = spawnSync(process.execPath, [BIN, ...args], {
    cwd: home, env: { ...process.env, DSH_HOME: home }, encoding: 'utf8', timeout, maxBuffer: 32 << 20,
  })
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}`, timedOut: r.error?.code === 'ETIMEDOUT' }
}

const tail = (s, n = 12) => s.split('\n').filter(Boolean).slice(-n).join('\n')

async function install() {
  for (const p of corpus) {
    const home = join(work, `home-${String(p.rank).padStart(2, '0')}`)
    mkdirSync(home, { recursive: true })
    const rec = { rank: p.rank, name: p.name, version: p.version, category: p.category, install: {} }
    const init = dsh(home, ['p', '--from-default-profile', 'web', '--dump-config'])
    if (init.code !== 0) { rec.install = { status: 'profile-init-failed', log: tail(init.out) }; results[p.rank] = rec; save(); continue }
    const spec = `${p.name}@${p.version}`
    const t0 = Date.now()
    let add = dsh(home, ['plugin', '--profile', 'p', 'add', '--ignore-scripts', `file:${bridgeDir}`, spec])
    rec.install.ms = Date.now() - t0
    if (add.code === 0) rec.install.status = 'installed'
    else if (/compatib|engines|exempt|allow-version/i.test(add.out)) {
      rec.install.refusal = tail(add.out, 6)
      const grant = dsh(home, ['plugin', '--profile', 'p', 'allow-version', spec, '--dsh-version', DSH_VERSION, '--accept-risk'])
      add = dsh(home, ['plugin', '--profile', 'p', 'add', '--ignore-scripts', `file:${bridgeDir}`, spec])
      rec.install.status = grant.code === 0 && add.code === 0 ? 'installed-with-exemption' : 'version-refused'
      if (add.code !== 0) rec.install.log = tail(add.out)
    } else {
      rec.install.status = add.timedOut ? 'install-timeout' : 'install-failed'
      rec.install.log = tail(add.out)
    }
    results[p.rank] = rec
    save()
    console.log(`${p.rank}\t${spec}\t${rec.install.status}`)
  }
}

function startSidecar(home, secret) {
  const child = spawn(process.execPath, [BIN, '--profile', 'p', '--host', '127.0.0.1', '--port', '0', '--no-open'], {
    cwd: home, env: { ...process.env, DSH_HOME: home, DSH2FORSION_SECRET: secret }, stdio: ['ignore', 'pipe', 'pipe'],
  })
  let log = ''
  child.stdout.on('data', d => { log += d })
  child.stderr.on('data', d => { log += d })
  const ready = new Promise(resolve => {
    const t0 = Date.now()
    const timer = setInterval(() => {
      const m = log.match(/dsh web: (http:\/\/127\.0\.0\.1:\d+)\/\?token=(\S+)/)
      if (m) { clearInterval(timer); resolve({ base: m[1], token: m[2], ms: Date.now() - t0 }) }
      else if (child.exitCode !== null || Date.now() - t0 > 60_000) { clearInterval(timer); resolve(null) }
    }, 200)
  })
  return { child, ready, log: () => log }
}

function stop(child) {
  return new Promise(resolve => {
    if (child.exitCode !== null) return resolve(child.exitCode)
    const kill = setTimeout(() => child.kill('SIGKILL'), 8_000)
    child.once('exit', code => { clearTimeout(kill); resolve(code) })
    child.kill('SIGTERM')
  })
}

function rssKb(pid) {
  try { return Number(readFileSync(`/proc/${pid}/status`, 'utf8').match(/VmRSS:\s+(\d+)/)[1]) } catch { return null }
}

async function rpc(base, cookie, method, args = {}) {
  const res = await fetch(`${base}/api/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: base, cookie },
    body: JSON.stringify({ type: 'client-request', rpcId: 'm0', method, payload: { args } }),
  })
  return (await res.json()).result
}

async function probe() {
  const { chromium } = await import(process.env.PLAYWRIGHT_CORE ?? 'playwright-core')
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM, args: ['--no-sandbox'] })
  for (const p of corpus) {
    const rec = results[p.rank]
    if (!rec || !String(rec.install?.status).startsWith('installed')) continue
    const home = join(work, `home-${String(p.rank).padStart(2, '0')}`)
    const secret = randomBytes(24).toString('hex')
    const sc = startSidecar(home, secret)
    const ready = await sc.ready
    const pr = (rec.probe = { boot: ready ? 'ready' : 'no-ready', bootMs: ready?.ms })
    if (ready) {
      try {
        const login = await fetch(`${ready.base}/?token=${ready.token}`, { redirect: 'manual' })
        const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0]
        const tools = await (await fetch(`${ready.base}/forsion-bridge/tools`, { headers: { 'x-dsh2forsion-secret': secret } })).json()
        pr.tools = (tools.tools ?? []).map(t => t.name).filter(n => n !== 'working_directory')
        const bundles = await rpc(ready.base, cookie, 'pluginManager/listBundles')
        const mine = bundles.ok ? bundles.value.find(b => b.name === p.name) : undefined
        pr.bundle = mine ? { enabled: mine.enabled, error: mine.error ?? null, rows: (mine.rows ?? []).length } : { missing: true, rpcError: bundles.ok ? null : bundles.error }
        const index = await (await fetch(`${ready.base}/`, { headers: { cookie } })).text()
        pr.clientInBootGraph = index.includes(p.name)
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
        // 无网络命名空间里 Chromium 判自己离线，DSH 客户端会挂起连接并显示 Disconnected；
        // 这是测试环境的假象，把 navigator.onLine 钉成 true。
        await ctx.addInitScript(() => Object.defineProperty(Navigator.prototype, 'onLine', { get: () => true }))
        const page = await ctx.newPage()
        const errors = []
        page.on('pageerror', e => errors.push(`pageerror: ${e.message}`.slice(0, 300)))
        page.on('console', m => { if (m.type() === 'error' || (process.env.M0_DEBUG && m.type() === 'warning')) errors.push(`console.${m.type()}: ${m.text()}`.slice(0, 300)) })
        const sockets = []
        page.on('websocket', w => {
          const path = new URL(w.url()).pathname
          sockets.push(`open ${path}`)
          w.on('close', () => sockets.push(`close ${path}`))
          w.on('socketerror', e => sockets.push(`error ${path} ${String(e).slice(0, 120)}`))
        })
        await page.goto(`${ready.base}/?token=${ready.token}`, { waitUntil: 'load', timeout: 30_000 }).catch(e => errors.push(`goto: ${e.message}`))
        await page.waitForTimeout(7_000)
        pr.uiText = (await page.evaluate(() => document.body.innerText).catch(() => '')).replace(/\s+/g, ' ').slice(0, 160)
        pr.uiErrors = errors.slice(0, 12)
        pr.sockets = sockets.slice(0, 8)
        pr.disconnected = /Disconnected/.test(pr.uiText)
        await page.screenshot({ path: join(work, `shot-${String(p.rank).padStart(2, '0')}.png`) }).catch(() => {})
        await ctx.close()
        pr.rssKb = rssKb(sc.child.pid)
      } catch (e) {
        pr.probeError = String(e.message ?? e).slice(0, 300)
      }
    }
    pr.exitCode = await stop(sc.child)
    const log = sc.log()
    pr.logIssues = log.split('\n').filter(l => /error|fail|warn|exception|pending|cannot|missing/i.test(l)).map(l => l.slice(0, 300)).slice(0, 15)
    writeFileSync(join(work, `boot-${String(p.rank).padStart(2, '0')}.log`), log)
    save()
    console.log(`${p.rank}\t${p.name}\tboot=${pr.boot}\ttools=${(pr.tools ?? []).length}\tbundleErr=${pr.bundle?.error ? 'yes' : 'no'}\tuiErr=${(pr.uiErrors ?? []).length}`)
  }
  await browser.close()
}

if (mode === 'install') await install()
else if (mode === 'probe') await probe()
else { console.error('usage: matrix.mjs install|probe …'); process.exit(2) }
