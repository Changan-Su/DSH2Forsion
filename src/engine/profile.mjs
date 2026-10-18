// profile 层：建 `forsion` profile、装 / 升级桥、跑 `dsh plugin …`（DSH 自己转给 pnpm）。
import { existsSync, readFileSync } from 'node:fs'
import { cp, mkdir, readdir, readFile, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { BRIDGE_PACKAGE, PROFILE } from './constants.mjs'
import { childEnv } from './env.mjs'
import { run } from './proc.mjs'

/** 跑一条 `dsh …`；DSH_HOME 指向给定的 home（主 profile 或试启动用的临时 home）。 */
export function dsh(paths, home, args, { log, signal, timeoutMs = 900_000 } = {}) {
  const env = childEnv(process.env, {
    binDir: paths.nodeBinDir,
    extra: { DSH_HOME: home, npm_config_store_dir: join(paths.cache, 'pnpm-store'), npm_config_update_notifier: 'false' },
  })
  return run(paths.nodeBin, [paths.dshBin, ...args], { cwd: home, env, timeoutMs, onLine: log, signal })
}

export function profileDir(home) {
  return join(home, 'profiles', PROFILE)
}

export async function ensureProfile(paths, home, opts = {}) {
  if (existsSync(join(profileDir(home), 'package.json'))) return
  await mkdir(home, { recursive: true })
  const r = await dsh(paths, home, [PROFILE, '--from-default-profile', 'web', '--dump-config'], opts)
  if (r.code !== 0 || !existsSync(join(profileDir(home), 'package.json'))) throw new Error(`profile init failed: ${r.out.slice(-600)}`)
}

function installedVersion(home, name) {
  try { return JSON.parse(readFileSync(join(profileDir(home), 'node_modules', ...name.split('/'), 'package.json'), 'utf8')).version } catch { return null }
}

/**
 * 桥随插件包发（bridgeDir），装成 file: 依赖。同版本号的 file: 包 pnpm 判「已是最新」不更新，
 * 所以版本不同就先 remove 再 add（M0 踩过）。
 */
export async function ensureBridge(paths, home, bridgeDir, opts = {}) {
  const want = JSON.parse(await readFile(join(bridgeDir, 'package.json'), 'utf8')).version
  const have = installedVersion(home, BRIDGE_PACKAGE)
  if (have === want) return false
  if (have) await dsh(paths, home, ['plugin', '--profile', PROFILE, 'remove', BRIDGE_PACKAGE], opts)
  const r = await dsh(paths, home, ['plugin', '--profile', PROFILE, 'add', '--ignore-scripts', `file:${bridgeDir}`], opts)
  if (r.code !== 0) throw new Error(`bridge install failed: ${r.out.slice(-600)}`)
  return true
}

/** profile 里用户装的插件（package.json 的依赖，去掉桥）。 */
export async function userPlugins(home) {
  try {
    const pkg = JSON.parse(await readFile(join(profileDir(home), 'package.json'), 'utf8'))
    return Object.entries(pkg.dependencies ?? {})
      .filter(([name]) => name !== BRIDGE_PACKAGE)
      .map(([name, spec]) => ({ name, spec, version: installedVersion(home, name) }))
  } catch { return [] }
}

/**
 * 夹带核心包：插件把 `@deepseek-ai/*` 当普通依赖带进 profile，版本又和运行时不一样，
 * 就会盖掉运行时那份（M0 随机样本里一个插件因此让整个 sidecar 起不来）。
 */
export async function shadowedCorePackages(paths, home) {
  const scope = join(profileDir(home), 'node_modules', '@deepseek-ai')
  let names = []
  try { names = await readdir(scope) } catch { return [] }
  const out = []
  for (const n of names) {
    let v
    try { v = JSON.parse(await readFile(join(scope, n, 'package.json'), 'utf8')).version } catch { continue }
    let runtimeV = null
    try { runtimeV = JSON.parse(await readFile(join(paths.runtimeDir, 'node_modules', '@deepseek-ai', n, 'package.json'), 'utf8')).version } catch { /* 运行时里没有这个包 */ }
    // 只有运行时里也有、而版本不同才算盖掉；运行时没有的包（实验包等）不算
    if (runtimeV && runtimeV !== v) out.push({ name: `@deepseek-ai/${n}`, version: v, runtime: runtimeV })
  }
  return out
}

/** 每次 sidecar 成功启动后存的那份；在 DSH Space 里自己装坏了也能回到这里。 */
export const LAST_GOOD = 'last-good'

const PROFILE_FILES = ['package.json', 'cordis.patch.yml', 'cordis.yml', 'pnpm-workspace.yaml', 'pnpm-lock.yaml', 'compatibility.json']

/** 只拷 profile 的声明文件（不拷 node_modules）；试启动和回滚都用它。 */
export async function copyProfileFiles(fromDir, toDir) {
  await mkdir(toDir, { recursive: true })
  for (const f of PROFILE_FILES) {
    const src = join(fromDir, f)
    if (existsSync(src)) await cp(src, join(toDir, f))
    else await rm(join(toDir, f), { force: true })
  }
}

export async function newestBackup(backupsDir) {
  let entries = []
  try { entries = await readdir(backupsDir) } catch { return null }
  const dirs = []
  for (const e of entries) {
    if (e === LAST_GOOD) continue
    try { if ((await stat(join(backupsDir, e))).isDirectory()) dirs.push(e) } catch { /* 忽略 */ }
  }
  dirs.sort()
  return dirs.length ? join(backupsDir, dirs[dirs.length - 1]) : null
}
