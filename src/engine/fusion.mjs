// 融合组合（第 1 档）：用户自己的 DSH 目录里一份叫 forsion 的组合 —— 官方的「网页界面 + 对话入口」两个 bundle 拼在一起，
// 一个进程两头都开（Forsion 的对话连对话入口，工作台开网页界面）。只用官方包，靠下面几行接线。
//
// 写盘纪律（用的是用户真实的 DSH 目录）：
//  - 只写自己那份组合的目录（<DSH_HOME>/profiles/forsion）；DSH 目录顶层的 cordis.patch.yml 是用户所有组合共用的，只读不写。
//  - 目录在、却没有 FUSION_MARKER → 是用户自己建的同名组合：不接管，报错。
//  - 组合的 cordis.patch.yml 只在没有时写一次：之后 DSH 自己的插件页会往里写开关（启用 / 停用某一行），不能盖掉。
//  - package.json 读不出来（坏了）就报错，不当空的重写（读失败 ≠ 空）。
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { FUSION_BUNDLES, FUSION_MARKER, FUSION_REENABLE, PROFILE } from './constants.mjs'

export const FUSION_PATCH_VERSION = 1

/** 组合的 cordis.patch.yml。不弹浏览器、只听本机随机端口：ACP 那个入口不认网页界面的命令行参数，所以写在配置里。 */
export function fusionPatch() {
  return `# dsh2forsion-fusion: ${FUSION_PATCH_VERSION}
# DSH2Forsion 建的组合：同一个进程里既开网页界面（Forsion 的 DSH 工作台），又开对话入口（Forsion 的对话连它）。
# 不弹浏览器、只听本机随机端口。下面几行可以在 DSH 自己的插件页里开关；本文件只在没有时由 DSH2Forsion 写一次。
- id: web-runtime
  config:
    openBrowser: false
    printUrl: true
    publicUrl: !!js ctx.webStartup.publicUrl
    surfaceContext: true
- id: webserver
  config:
    host: 127.0.0.1
    port: 0
    tls: !!js ctx.webStartup.tls
    compression: gzip
    compressionLevel: 1
    compressionThresholdBytes: 1024
# 网页界面那份接线把这些关了、改由「预设」按会话挂；对话入口建的会话不挂预设，所以在全局重新打开
${FUSION_REENABLE.map(id => `- id: ${id}\n  disabled: false\n`).join('')}`
}

export class ForeignProfileError extends Error {}

/**
 * 建 / 核对融合组合。返回 { created, path }。
 * @param {{ home: string, profileDir: string }} paths
 */
export async function ensureFusedProfile(paths, { log = () => {} } = {}) {
  const dir = paths.profileDir
  const marker = join(dir, FUSION_MARKER)
  const created = !existsSync(dir)
  if (!created && !existsSync(marker)) {
    throw new ForeignProfileError(`A DSH profile named "${PROFILE}" already exists in ${paths.home} and was not created by DSH2Forsion. Rename it in DSH, then try again.`)
  }
  await mkdir(dir, { recursive: true })
  if (created) {
    await writeFile(marker, JSON.stringify({ createdBy: 'dsh2forsion', patch: FUSION_PATCH_VERSION, at: new Date().toISOString() }, null, 2) + '\n')
    log(`created DSH profile "${PROFILE}" in ${paths.home}`)
  }
  const pkgFile = join(dir, 'package.json')
  let pkg = {}
  if (existsSync(pkgFile)) {
    try { pkg = JSON.parse(await readFile(pkgFile, 'utf8')) }
    catch (error) { throw new Error(`Cannot read ${pkgFile}: ${error.message}. Fix or remove the file, then try again.`) }
  }
  // bundles 里除了这三个官方 bundle，还有 `dsh plugin add` 追加的（桥、用户装的插件）：只补缺的，别的原样留着
  const bundles = Array.isArray(pkg?.dsh?.profile?.bundles) ? pkg.dsh.profile.bundles : []
  if (!FUSION_BUNDLES.every(b => bundles.includes(b))) {
    const next = { name: pkg.name ?? `dsh-profile-${PROFILE}`, private: true, ...pkg,
      dsh: { ...(pkg.dsh ?? {}), profile: { ...(pkg.dsh?.profile ?? {}), bundles: [...FUSION_BUNDLES, ...bundles.filter(b => !FUSION_BUNDLES.includes(b))] } } }
    await writeFile(pkgFile, JSON.stringify(next, null, 2) + '\n')
  }
  const patchFile = join(dir, 'cordis.patch.yml')
  if (!existsSync(patchFile)) await writeFile(patchFile, fusionPatch())
  return { created, path: dir }
}
