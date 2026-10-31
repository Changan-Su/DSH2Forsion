// 运行时安装：官方 Node（SHASUMS256 校验）→ 钉死的 @deepseek-ai/dsh（--ignore-scripts，
// 只给 DSH 自己的三个原生依赖跑构建）→ pnpm（DSH 装插件要它）。M0 实测体积约 1.1 GB。
import { createHash } from 'node:crypto'
import { createReadStream, existsSync, readFileSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { DSH_VERSION, NODE_MIRRORS, NODE_SHA256, NODE_VERSION, NPM_REGISTRIES, PNPM_VERSION, TRUSTED_NATIVE_PACKAGES } from './constants.mjs'
import { childEnv } from './env.mjs'
import { nodePlatform } from './layout.mjs'
import { run, tail } from './proc.mjs'

export function runtimeInstalled(paths) {
  try {
    const marker = JSON.parse(readFileSync(paths.runtimeMarker, 'utf8'))
    return marker.dsh === DSH_VERSION && marker.node === NODE_VERSION && marker.pnpm === PNPM_VERSION
      && existsSync(paths.nodeBin) && existsSync(paths.dshBin)
      && existsSync(marker.lockSha256 ? paths.pnpmBin : paths.legacyPnpmBin)
  } catch { return false }
}

/** 下载源顺序：auto = 官方优先、失败退国内镜像。 */
export function sources(choice = 'auto') {
  if (choice === 'official') return ['official']
  if (choice === 'mirror') return ['mirror']
  return ['official', 'mirror']
}

async function sha256(file) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest('hex')
}

const PROXY_VARS = ['HTTPS_PROXY', 'https_proxy', 'ALL_PROXY', 'all_proxy']

async function download(url, file, signal) {
  // Node 的 fetch 不认 HTTPS_PROXY：设了代理就先交给 curl（macOS、Windows 10+ 自带），没有 curl 再退回 fetch
  if (PROXY_VARS.some(k => process.env[k])) {
    try {
      const r = await run('curl', ['-fsSL', '--retry', '2', '-o', file, url], { env: childEnv(process.env, { binDir: '' }), timeoutMs: 900_000, signal })
      if (r.code === 0) return
      throw new Error(`GET ${url} (curl): ${tail(r.out, 3)}`)
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
  }
  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}`)
  await writeFile(file, Buffer.from(await res.arrayBuffer()))
}

function tarBin() {
  if (process.platform !== 'win32') return 'tar'
  const system = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')
  return existsSync(system) ? system : 'tar'
}

async function installNode(paths, { source, log, signal }) {
  if (existsSync(paths.nodeBin)) return
  const plat = nodePlatform()
  if (!plat) throw new Error(`unsupported platform ${process.platform}-${process.arch}`)
  const name = `node-${NODE_VERSION}-${plat.id}`
  const file = `${name}.${plat.ext}`
  const tmp = join(paths.root, 'downloads')
  await mkdir(tmp, { recursive: true })
  let lastError
  for (const which of sources(source)) {
    const base = `${NODE_MIRRORS[which]}/${NODE_VERSION}`
    try {
      log(`download ${file} (${which})`)
      let expected = NODE_SHA256[file]
      if (!expected) {
        await download(`${base}/SHASUMS256.txt`, join(tmp, 'SHASUMS256.txt'), signal)
        const sums = await readFile(join(tmp, 'SHASUMS256.txt'), 'utf8')
        expected = sums.split('\n').map(l => l.trim().split(/\s+/)).find(([, f]) => f === file)?.[0]
      }
      if (!expected) throw new Error(`${file} missing from SHASUMS256.txt`)
      await download(`${base}/${file}`, join(tmp, file), signal)
      const actual = await sha256(join(tmp, file))
      if (actual !== expected) throw new Error(`checksum mismatch for ${file}`)
      log(`checksum ok ${actual.slice(0, 12)}…`)
      const stage = `${paths.nodeDir}.partial`
      await rm(stage, { recursive: true, force: true })
      await mkdir(stage, { recursive: true })
      // tar 解 .tar.gz；Windows 用系统自带的 bsdtar 解 .zip（PATH 上的 tar 可能是 Git 带的 GNU tar，解不了 zip）
      const r = await run(tarBin(), ['-xf', join(tmp, file), '-C', stage, '--strip-components=1'], { timeoutMs: 300_000, signal })
      if (r.code !== 0) throw new Error(`extract failed: ${tail(r.out, 5)}`)
      await rm(paths.nodeDir, { recursive: true, force: true })
      await rename(stage, paths.nodeDir)
      await rm(tmp, { recursive: true, force: true })
      return
    } catch (error) {
      lastError = error
      log(`node download from ${which} failed: ${error.message}`)
      if (signal?.aborted) break
    }
  }
  throw lastError ?? new Error('node download failed')
}

function npm(paths, args, { registry, log, signal, cwd }) {
  signal?.throwIfAborted()
  const env = childEnv(process.env, {
    binDir: paths.nodeBinDir,
    extra: { npm_config_cache: join(paths.cache, 'npm'), npm_config_registry: registry, npm_config_update_notifier: 'false', npm_config_fund: 'false', npm_config_audit: 'false' },
  })
  return run(paths.nodeBin, [paths.npmCli, ...args], { cwd, env, timeoutMs: 1_200_000, onLine: log, signal })
}

async function installDsh(paths, { source, log, signal }) {
  await mkdir(paths.runtimeDir, { recursive: true })
  const manifest = await readFile(new URL('../runtime/package.json', import.meta.url))
  const lock = await readFile(new URL('../runtime/package-lock.json', import.meta.url))
  // Read the shipped files before invalidating an incomplete installation. Never resolve a new tree here.
  signal?.throwIfAborted()
  await rm(paths.runtimeMarker, { force: true })
  await writeFile(join(paths.runtimeDir, 'package.json'), manifest)
  await writeFile(join(paths.runtimeDir, 'package-lock.json'), lock)
  let lastError
  for (const which of sources(source)) {
    signal?.throwIfAborted()
    const registry = NPM_REGISTRIES[which]
    log(`npm ci @deepseek-ai/dsh@${DSH_VERSION}, pnpm@${PNPM_VERSION} (${which})`)
    const r = await npm(paths, ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], { registry, log, signal, cwd: paths.runtimeDir })
    signal?.throwIfAborted()
    if (r.code !== 0) { lastError = new Error(`npm ci failed (${which}): ${tail(r.out, 5)}`); log(lastError.message); continue }
    // npm 11 的 allowScripts：不先批准，rebuild 会静默跳过这三个包的脚本
    // （macOS 上 node-pty 的 spawn-helper 就缺执行位，终端类工具起不来）。老 npm 没这个子命令，失败就照旧 rebuild。
    const approve = await npm(paths, ['install-scripts', 'approve', ...TRUSTED_NATIVE_PACKAGES], { registry, log, signal, cwd: paths.runtimeDir })
    if (approve.code !== 0) log('npm install-scripts approve unavailable; rebuilding anyway')
    log('build DSH native dependencies')
    const b = await npm(paths, ['rebuild', ...TRUSTED_NATIVE_PACKAGES], { registry, log, signal, cwd: paths.runtimeDir })
    if (b.code !== 0) { lastError = new Error(`native rebuild failed: ${tail(b.out, 5)}`); log(lastError.message); continue }
    signal?.throwIfAborted()
    return { registry, lockSha256: createHash('sha256').update(lock).digest('hex') }
  }
  throw lastError ?? new Error('runtime install failed')
}

/** 整套安装；可重复调用，已装好的部分跳过。 */
export async function installRuntime(paths, { source = 'auto', log = () => {}, signal } = {}) {
  signal?.throwIfAborted()
  // Includes pre-lock v0.1 installations: do not overwrite a working runtime on retry.
  if (runtimeInstalled(paths)) { log('runtime already installed'); return }
  await mkdir(paths.root, { recursive: true })
  await installNode(paths, { source, log, signal })
  const { registry, lockSha256 } = await installDsh(paths, { source, log, signal })
  signal?.throwIfAborted()
  await writeFile(paths.runtimeMarker, JSON.stringify({ dsh: DSH_VERSION, node: NODE_VERSION, pnpm: PNPM_VERSION, registry, lockSha256, at: new Date().toISOString() }) + '\n')
  // npm 的下载缓存装完就没用了（约 260 MB）；装 DSH 插件用的是 pnpm 的 store，不在这里
  await rm(join(paths.cache, 'npm'), { recursive: true, force: true }).catch(() => {})
  log('runtime ready')
}
