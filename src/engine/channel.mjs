// 跟版通道（第 1 档）：DSH2Forsion 的 CI 每天看上游的发布标签、在新版上跑融合自检，过了就出一份带校验值的运行时清单
// （runtime-manifest.json：DSH 版本 + 运行时的 package.json / package-lock.json 原文 + 两份的 sha256）。
// 客户端按清单装新版，旧版的运行时目录留着（runtime/<版本>/），对不上时能「先退回上一版 DSH」。
//
// 只认两种版本：这个插件版本随包带的那一版（DSH_VERSION），和清单里校验过、又声明支持这个插件版本的。
// 当前在用哪一版记在 <数据目录>/active-runtime.json；读不出来就当不知道，回到随包那一版（它是这个插件版本验过的）。
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DSH_VERSION, NODE_VERSION, PNPM_VERSION } from './constants.mjs'

// CI 的发布那一步还没打开（见仓库 README「跟版通道」）：在那之前取不到清单，通道停在随包那一版。
export const CHANNEL_URL = 'https://github.com/Changan-Su/DSH2Forsion/releases/download/dsh-channel/runtime-manifest.json'
export const PLUGIN_VERSION = '0.2.0'
const VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/

const sha256 = text => createHash('sha256').update(text).digest('hex')

/** semver 比较（含预发布段）：a<b → 负数。 */
export function compareVersions(a, b) {
  const [ma, pa = ''] = String(a).split('-', 2)
  const [mb, pb = ''] = String(b).split('-', 2)
  const na = ma.split('.').map(Number), nb = mb.split('.').map(Number)
  for (let i = 0; i < 3; i++) if ((na[i] ?? 0) !== (nb[i] ?? 0)) return (na[i] ?? 0) - (nb[i] ?? 0)
  if (pa === pb) return 0
  if (!pa) return 1
  if (!pb) return -1
  const xa = pa.split('.'), xb = pb.split('.')
  for (let i = 0; i < Math.max(xa.length, xb.length); i++) {
    if (xa[i] === undefined) return -1
    if (xb[i] === undefined) return 1
    const da = /^\d+$/.test(xa[i]), db = /^\d+$/.test(xb[i])
    if (da && db && Number(xa[i]) !== Number(xb[i])) return Number(xa[i]) - Number(xb[i])
    if (da !== db) return da ? -1 : 1
    if (xa[i] !== xb[i]) return xa[i] < xb[i] ? -1 : 1
  }
  return 0
}

/** 清单的形状和校验值（纯函数，单测覆盖）。不过关抛错。 */
export function validateManifest(m, { pluginVersion = PLUGIN_VERSION } = {}) {
  if (!m || typeof m !== 'object' || m.schema !== 1) throw new Error('Unknown runtime manifest format')
  if (!VERSION_RE.test(String(m.dsh))) throw new Error('Runtime manifest names no valid DSH version')
  if (m.node !== NODE_VERSION || m.pnpm !== PNPM_VERSION) throw new Error(`Runtime manifest needs Node ${m.node} / pnpm ${m.pnpm}; this DSH2Forsion ships Node ${NODE_VERSION} / pnpm ${PNPM_VERSION}`)
  if (typeof m.files?.packageJson !== 'string' || typeof m.files?.lock !== 'string') throw new Error('Runtime manifest has no runtime files')
  if (sha256(m.files.packageJson) !== m.sha256?.packageJson || sha256(m.files.lock) !== m.sha256?.lock) throw new Error('Runtime manifest checksum mismatch')
  const pkg = JSON.parse(m.files.packageJson)
  if (pkg?.dependencies?.['@deepseek-ai/dsh'] !== m.dsh) throw new Error('Runtime manifest files do not pin the DSH version it names')
  if (m.plugin?.min && compareVersions(pluginVersion, m.plugin.min) < 0) throw new Error(`DSH ${m.dsh} needs DSH2Forsion ${m.plugin.min} or newer`)
  if (m.selfCheck?.ok !== true) throw new Error(`DSH ${m.dsh} did not pass the fusion self-check`)
  return m
}

const channelDir = root => join(root, 'channel')
const activeFile = root => join(root, 'active-runtime.json')

/** 当前在用的 DSH 版本：记下的那一版（必须是认得的），否则随包那一版。 */
export function activeVersion(root, log = () => {}) {
  const file = activeFile(root)
  if (!existsSync(file)) return DSH_VERSION
  try {
    const v = JSON.parse(readFileSync(file, 'utf8')).dsh
    if (v === DSH_VERSION || verifiedSync(root).includes(v)) return v
    log(`active runtime ${v} is not verified for this DSH2Forsion; using ${DSH_VERSION}`)
  } catch (error) { log(`cannot read active-runtime.json (${error.message}); using ${DSH_VERSION}`) }
  return DSH_VERSION
}

export async function setActiveVersion(root, version) {
  await mkdir(root, { recursive: true })
  await writeFile(activeFile(root), JSON.stringify({ dsh: version, at: new Date().toISOString() }) + '\n')
}

function verifiedSync(root) {
  const out = [DSH_VERSION]
  try {
    for (const f of readdirSync(channelDir(root))) {
      const m = /^manifest-(.+)\.json$/.exec(f)
      if (!m) continue
      try { validateManifest(JSON.parse(readFileSync(join(channelDir(root), f), 'utf8'))); out.push(m[1]) } catch { /* 坏的清单不算 */ }
    }
  } catch { /* 还没有通道目录 */ }
  return [...new Set(out)]
}

/** 这个插件版本认的版本：随包那一版 + 存下来的、校验过的清单。 */
export function verifiedVersions(root) { return verifiedSync(root) }

/** 盘上装好了的运行时版本（标记文件里的 Node / pnpm 也得对）。 */
export async function installedVersions(root) {
  let names = []
  try { names = await readdir(join(root, 'runtime')) } catch { return [] }
  const out = []
  for (const v of names) {
    try {
      const marker = JSON.parse(await readFile(join(root, 'runtime', v, '.dsh2forsion-ready'), 'utf8'))
      if (marker.dsh === v && marker.node === NODE_VERSION && marker.pnpm === PNPM_VERSION) out.push(v)
    } catch { /* 没装完 */ }
  }
  return out.sort(compareVersions)
}

/** 「先退回上一版 DSH」能退到哪一版：盘上装好了、这个插件版本认、又比当前旧的里最新的那一版；没有 → null。 */
export async function previousVersion(root, active) {
  const verified = new Set(verifiedVersions(root))
  const older = (await installedVersions(root)).filter(v => verified.has(v) && compareVersions(v, active) < 0)
  return older.at(-1) ?? null
}

/** 已存下的那一版清单（装那一版要用里面的 package.json / lock）。 */
export async function storedManifest(root, version) {
  if (version === DSH_VERSION) return null
  return validateManifest(JSON.parse(await readFile(join(channelDir(root), `manifest-${version}.json`), 'utf8')))
}

/** 取通道上的清单；校验过就存下来。取不到 / 不对就抛错（调用方当「没有新版」）。 */
export async function fetchChannel(root, { url = CHANNEL_URL, signal } = {}) {
  const res = await fetch(url, { signal: signal ?? AbortSignal.timeout(20_000), redirect: 'follow' })
  if (res.status === 404) return { published: false }
  if (!res.ok) throw new Error(`runtime manifest → ${res.status}`)
  const m = validateManifest(await res.json())
  await mkdir(channelDir(root), { recursive: true })
  await writeFile(join(channelDir(root), `manifest-${m.dsh}.json`), JSON.stringify(m) + '\n')
  return { published: true, manifest: m }
}
