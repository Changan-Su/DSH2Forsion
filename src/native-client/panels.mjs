// Explicit, isolated client adaptations. Original UI/components/API gates remain.
import { readFile, writeFile, mkdir, rename, realpath } from 'node:fs/promises'
import { join, relative, isAbsolute } from 'node:path'
import { randomUUID } from 'node:crypto'
import { sha256 } from './patches.mjs'

const once = (source, before, after) => {
  const i = source.indexOf(before)
  if (i < 0 || source.indexOf(before, i + before.length) >= 0) throw new Error(`Native panel anchor changed: ${before.slice(0, 80)}`)
  return source.slice(0, i) + after + source.slice(i + before.length)
}
export const PANEL_PATCHES = Object.freeze({
  'skills-manager': { package: '@michengai/dsh-skills-manager', version: '1.2.24', sha256: '4bbe039830ee2fb61b624ef0b1c70973ce388bb6738ca29610db0f4d38b983ab' },
  'git-graph': { package: '@linxin666/dsh-client-ui-git-graph', version: '0.4.7', sha256: '0859b8c161a85aba803b2a3d1d68dc46109d1866733ec4b45eb02e62e6b87e3d' },
})
export function patchPanel(panel, source) {
  const spec = PANEL_PATCHES[panel]
  if (!spec || sha256(source) !== spec.sha256) throw new Error('Native panel original version/hash guard failed')
  let out = source
  if (panel === 'skills-manager') {
    out = once(out, 'var Us=["slots","locale"];', 'var Us=["slots","locale","nativeExecutionClient"];')
    // The saved preference still controls the sidebar. Explicit native open
    // needs its main entry even when that *sidebar* preference is off.
    out = once(out, 'if(b&&g){', 'if(b&&(g||globalThis.__FORSION_NATIVE_VIEW__?.descriptor.id==="skills-manager")){')
  } else {
    out = once(out, 'const inject = [\n\t\t\t"slots",', 'const inject = [\n\t\t\t"nativeExecutionClient",\n\t\t\t"slots",')
    out = once(out, 'const cwdOf = (sessionId) => sessionId === void 0 ? void 0 : sessions.list.getSnapshot().byId[sessionId]?.cwd;', 'const cwdOf = (sessionId) => scope.get("nativeExecutionClient")?.enabled ? scope.get("nativeExecutionClient").currentCwd() : sessionId === void 0 ? void 0 : sessions.list.getSnapshot().byId[sessionId]?.cwd;')
    out = once(out, 'let mounted = false;', `if (globalThis.__FORSION_NATIVE_VIEW__) scope.slots.inject("main", () => scope.slots.register({
      name:"main", key:"forsion-git-graph", locale:NS, inject:()=>({nativeGit:injected()})
    }, function ForsionNativeGitGraph({nativeGit,t}) {
      const ReactNative=require("react"); const native=scope.get("nativeExecutionClient");
      const graph=ReactNative.useCallback(async limit=>{await native.refresh();return nativeGit.graph(void 0,limit);},[nativeGit.graph]);
      return ReactNative.createElement("section",{"data-forsion-git-graph":""},ReactNative.createElement(GraphDialog,{graph,onClose:()=>native.openCurrentSession(),t}));
    }));
    let mounted = false;`)
  }
  return `// Modified by DSH2Forsion 2026-10-31: explicit public-slot native context adapter; original UI retained (Apache-2.0).\n` + out.replace(/^\/\/[#@]\s*sourceMappingURL=.*(?:\r?\n)?/gm, '')
}
async function atomic(file, value) { const tmp = `${file}.forsion-${randomUUID()}.tmp`; await writeFile(tmp, value); await rename(tmp, file) }
export async function prepareNativePanels({ profileDir, log = () => {} }) {
  const prepared = []
  for (const [panel, spec] of Object.entries(PANEL_PATCHES)) {
    let root
    try { root = await realpath(join(profileDir, 'node_modules', ...spec.package.split('/'))) } catch (e) { if (e.code === 'ENOENT') continue; throw e }
    const rel = relative(await realpath(profileDir), root)
    if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('Native panel package is outside the isolated profile')
    const pkgFile = join(root, 'package.json'), pkg = JSON.parse(await readFile(pkgFile, 'utf8'))
    if (pkg.name !== spec.package || pkg.version !== spec.version) throw new Error(`Unsupported ${panel} native panel version: ${pkg.version}`)
    if (!Array.isArray(pkg.dsh?.client?.inject)) throw new Error('Native panel client metadata changed')
    const backup = join(root, '.forsion-native-original'), saved = join(backup, 'client.js'), target = join(root, 'lib/client.js')
    let original
    try { original = await readFile(saved, 'utf8') } catch (e) { if (e.code !== 'ENOENT') throw e; original = await readFile(target, 'utf8') }
    const patched = patchPanel(panel, original), current = await readFile(target, 'utf8')
    if (sha256(current) !== spec.sha256 && sha256(current) !== sha256(patched)) throw new Error(`Unknown ${panel} modifications; refusing native adaptation`)
    await mkdir(backup, { recursive: true })
    await writeFile(saved, original, { flag: 'wx' }).catch(e => { if (e.code !== 'EEXIST') throw e })
    await atomic(target, patched)
    if (!pkg.dsh.client.inject.includes('dsh2forsion-bridge')) pkg.dsh.client.inject.push('dsh2forsion-bridge')
    await atomic(pkgFile, JSON.stringify(pkg, null, 2) + '\n')
    const noticeFile = join(root, 'NOTICE'), existing = await readFile(noticeFile, 'utf8').catch(e => { if (e.code === 'ENOENT') return ''; throw e })
    const note = `DSH2Forsion native compatibility adapter (2026-10-31): modified lib/client.js for a public main-slot entry and verified native context. Original ${spec.package}@${spec.version} UI and source retained under Apache-2.0; see LICENSE. Original authors do not endorse this adaptation.`
    if (!existing.includes(note)) await atomic(noticeFile, existing + (existing ? '\n' : '') + note + '\n')
    await atomic(join(root, '.forsion-native-compat.json'), JSON.stringify({ package: spec.package, version: spec.version, patchVersion: 1, clientSha256: sha256(patched) }, null, 2) + '\n')
    log(`native panel prepared: ${spec.package}@${spec.version}`)
    prepared.push({ panel, package: spec.package, version: spec.version })
  }
  return prepared
}
