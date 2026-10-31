// Profile-local, hash-guarded adaptation. Never write pnpm's shared hardlink inode.
import { readFile, writeFile, mkdir, rename, realpath } from 'node:fs/promises'
import { join, relative, isAbsolute } from 'node:path'
import { randomUUID } from 'node:crypto'
import { patchClient, patchHost, sha256, SPEC } from './patches.mjs'
import { prepareNativePanels } from './panels.mjs'

async function atomicFile(file, value) {
  const tmp = `${file}.forsion-${randomUUID()}.tmp`
  await writeFile(tmp, value)
  await rename(tmp, file)
}
async function prepareTaskBoard({ profileDir, log = () => {} }) {
  const entry = join(profileDir, 'node_modules', '@linxin666', 'dsh-client-ui-task-board')
  let root
  try { root = await realpath(entry) } catch (error) { if (error.code === 'ENOENT') return { patched: false }; throw error }
  const rel = relative(await realpath(profileDir), root)
  if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('Native compatibility refuses a package outside the isolated profile')
  const pkgFile = join(root, 'package.json')
  const pkg = JSON.parse(await readFile(pkgFile, 'utf8'))
  if (pkg.name !== SPEC.package || pkg.version !== SPEC.version) throw new Error(`Task Board native adapter supports only ${SPEC.version}; found ${pkg.version}`)
  const injection = pkg.dsh?.client?.inject
  if (!Array.isArray(injection)) throw new Error('Task Board client metadata changed')
  const backup = join(root, '.forsion-native-original')
  await mkdir(backup, { recursive: true })
  const plans = []
  for (const [file, name, transform, expected] of [['lib/index.js', 'host.js', patchHost, SPEC.host], ['lib/client.js', 'client.js', patchClient, SPEC.client]]) {
    const target = join(root, file), saved = join(backup, name)
    let original
    try { original = await readFile(saved, 'utf8') } catch (error) {
      if (error.code !== 'ENOENT') throw error
      original = await readFile(target, 'utf8')
    }
    if (sha256(original) !== expected) throw new Error(`Task Board ${file} is not the audited original artifact`)
    const patched = transform(original), current = await readFile(target, 'utf8')
    const previous = file === 'lib/client.js' ? SPEC.previousClient : []
    if (sha256(current) !== expected && sha256(current) !== sha256(patched) && !previous.includes(sha256(current))) throw new Error(`Task Board ${file} has unknown modifications; refusing native patch`)
    plans.push({ target, saved, original, patched })
  }
  // Both artifacts verified before the first replacement. A partial interrupted
  // application is repairable only from these separately hash-checked originals.
  for (const plan of plans) {
    await writeFile(plan.saved, plan.original, { flag: 'wx' }).catch(error => { if (error.code !== 'EEXIST') throw error })
    await atomicFile(plan.target, plan.patched)
  }
  if (!injection.includes('dsh2forsion-bridge')) injection.push('dsh2forsion-bridge')
  await atomicFile(pkgFile, JSON.stringify(pkg, null, 2) + '\n')
  const noticeFile = join(root, 'NOTICE')
  const existing = await readFile(noticeFile, 'utf8').catch(error => { if (error.code === 'ENOENT') return ''; throw error })
  const notice = 'DSH2Forsion native compatibility adapter (2026-10-31): modified lib/index.js and lib/client.js to add optional public execution/context adapters. Original Task Board remains Apache-2.0; see LICENSE. Original source and verified pre-patch artifacts are retained. No original authors endorse this adaptation.'
  if (!existing.includes(notice)) await atomicFile(noticeFile, existing + (existing ? '\n' : '') + notice + '\n')
  const record = { package: SPEC.package, version: SPEC.version, patchVersion: SPEC.patchVersion, files: Object.fromEntries(plans.map(p => [relative(root, p.target).replaceAll('\\', '/'), sha256(p.patched)])) }
  await atomicFile(join(root, '.forsion-native-compat.json'), JSON.stringify(record, null, 2) + '\n')
  log(`native adapter prepared: ${SPEC.package}@${SPEC.version}`)
  return { patched: true, root, ...record }
}
export async function prepareNativeCompatibility(options) {
  const taskBoard = await prepareTaskBoard(options)
  const panels = await prepareNativePanels(options)
  return { ...taskBoard, panels }
}
