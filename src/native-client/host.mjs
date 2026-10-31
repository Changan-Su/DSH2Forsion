// Dedicated public DSH client/slot carrier. This file is bundled into the bridge.
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { NativeTaskBoardRunner } from './runner.mjs'
import { patchLayout, patchClient, sha256, SPEC } from './patches.mjs'
import { patchPanel, PANEL_PATCHES } from './panels.mjs'

export const VIEW_ADAPTERS = Object.freeze({
  'task-board': Object.freeze({ id: 'task-board', package: '@linxin666/dsh-client-ui-task-board', version: '0.4.7', slot: 'main', entryKey: 'task-board', owner: {} }),
  'skills-manager': Object.freeze({ id: 'skills-manager', package: '@michengai/dsh-skills-manager', version: '1.2.24', slot: 'main', entryKey: 'skills-manager', owner: {} }),
  'git-graph': Object.freeze({ id: 'git-graph', package: '@linxin666/dsh-client-ui-git-graph', version: '0.4.7', slot: 'main', entryKey: 'forsion-git-graph', owner: {} }),
})
const browserOps = new Set(['context', 'cancel', 'createWorkspace', 'openSession'])
const json = (res, status, data) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(data)) }
const inline = value => JSON.stringify(value).replaceAll('<', '\\u003c')
const preparedSource = text => {
  // Match rc.2 clientModules.prepareSource, including the preceding newline.
  const clean = text.replace(/(?:\r?\n)?\/\/# sourceURL=([^\r\n]+)(?:\r?\n)?$/, '').replace(/(?:\r?\n)?\/\/# sourceMappingURL=[^\r\n]*(?:\r?\n)?$/, '')
  return clean.endsWith('\n') ? clean : clean + '\n'
}
async function readJson(req) {
  let size = 0
  const parts = []
  for await (const part of req) { size += part.length; if (size > 1_048_576) throw new Error('Native request is too large'); parts.push(Buffer.from(part)) }
  const value = JSON.parse(Buffer.concat(parts).toString('utf8') || '{}')
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Native request must be an object')
  return value
}
function resourceUrls(graph) { return new Set([...graph.entries, ...graph.batches].map(row => '/' + row.url.replace(/^\//, ''))) }
async function verifiedClient(modules, descriptor) {
  const file = modules.clientPath(descriptor.package)
  if (!file) throw new Error('The native panel client is unavailable')
  const root = dirname(dirname(file)), installed = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  if (installed.name !== descriptor.package || installed.version !== descriptor.version) throw new Error('The requested native panel version is not verified')
  const original = await readFile(join(root, '.forsion-native-original/client.js'), 'utf8')
  const expected = descriptor.package === SPEC.package ? patchClient(original) : patchPanel(descriptor.id, original)
  const current = await readFile(file, 'utf8')
  if (sha256(current) !== sha256(expected)) throw new Error('The native panel client changed after installation; refusing unverified code')
  return expected
}

/** invoke(op,payload) is a host-authenticated JSON-v1 callback, never browser auth. */
export function installNativeAdapters(ctx, { invoke, log = () => {}, frontendDir, layoutPath } = {}) {
  if (typeof invoke !== 'function') throw new Error('Native execution callback is required')
  let disposed = false
  const views = new Map()
  const call = async (op, payload) => {
    if (disposed) throw new Error('Native adapter is disabled')
    let value = await invoke(op, payload)
    if (disposed) throw new Error('Native adapter was disabled during the request')
    if (op === 'context' || op === 'createWorkspace') {
      value = structuredClone(value)
      const registry = ctx.get('workspaceRegistry')
      const workspaces = op === 'context' ? value.workspaces || (value.workspace ? [value.workspace] : []) : [value]
      if (workspaces.length && typeof registry?.create !== 'function') throw new Error('DSH public workspace registry is unavailable')
      for (const workspace of workspaces) {
        if (typeof workspace?.path !== 'string') throw new Error('Native workspace has no verified path')
        // Keep the third-party Git/Skills workspace-membership gates intact.
        // This registers real approved directories, never artificial DSH sessions.
        const registered = registry.list().find(item => item.path === workspace.path) || await registry.create(workspace.path, workspace.name)
        // Old board cards may pin the DSH workspace id. Resolve that alias only
        // through the same approved real directory, without rewriting their data.
        if (registered?.id) workspace.dshWorkspaceId = registered.id
        if (disposed) throw new Error('Native adapter was disabled during workspace synchronization')
      }
    }
    return value
  }
  ctx.provide('nativeExecutionAdapters', {
    create(consumer) {
      if (consumer !== 'task-board') throw new Error('Unknown native execution consumer')
      return helpers => new NativeTaskBoardRunner(call, helpers)
    },
  })
  const handle = async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1')
    const ticket = req.headers['x-forsion-native-view'] || url.searchParams.get('ticket') || url.pathname.match(/^\/forsion-native\/view\/([a-f0-9]{48})\/$/)?.[1]
    const view = typeof ticket === 'string' ? views.get(ticket) : undefined
    if (!view || view.expires < Date.now()) return json(res, 403, { error: 'Native view authorization expired; reopen the Forsion view' })
    if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) return json(res, 403, { error: 'Native view origin mismatch' })
    if (req.method === 'POST' && url.pathname.startsWith('/forsion-native/api/')) {
      const op = url.pathname.slice('/forsion-native/api/'.length)
      if (!browserOps.has(op)) return json(res, 404, { error: 'Unknown native view operation' })
      return json(res, 200, await call(op, await readJson(req)))
    }
    if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' })
    const modules = ctx.get('clientModules')
    if (!modules) throw new Error('DSH public clientModules service is unavailable')
    if (url.pathname === '/forsion-native/bundle') {
      const src = url.searchParams.get('src') || ''
      const graph = modules.graph()
      if (!resourceUrls(graph).has(src)) return json(res, 403, { error: 'Bundle is outside the active public client graph' })
      const response = await modules.fetchBundle(new Request('http://127.0.0.1' + src))
      if (!response.ok) return json(res, response.status, { error: 'DSH client bundle is unavailable' })
      let source = await response.text()
      const ids = graph.batches.find(row => '/' + row.url.replace(/^\//, '') === src)?.entries || graph.entries.filter(row => '/' + row.url.replace(/^\//, '') === src).map(row => row.id)
      for (const descriptor of Object.values(VIEW_ADAPTERS)) if (ids.includes(descriptor.package)) {
        const expected = preparedSource(await verifiedClient(modules, descriptor))
        if (!source.includes(expected)) throw new Error('DSH served a stale or unverified native panel artifact')
      }
      if (source.includes('id: "@deepseek-ai/dsh-client-ui-layout"')) {
        const original = await readFile(layoutPath || modules.clientPath('@deepseek-ai/dsh-client-ui-layout'), 'utf8')
        const needle = preparedSource(original), patched = preparedSource(patchLayout(original))
        if (!source.includes(needle) || source.indexOf(needle) !== source.lastIndexOf(needle)) throw new Error('DSH layout combo artifact changed; refusing native view shim')
        source = source.replace(needle, patched)
      }
      res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' }); res.end(source); return
    }
    if (url.pathname !== `/forsion-native/view/${ticket}/`) return json(res, 404, { error: 'Native view route not found' })
    if (!modules.graph().entries.some(e => e.id === view.descriptor.package)) throw new Error('The requested panel package is not installed or active')
    await verifiedClient(modules, view.descriptor)
    // Exchange the already authenticated native-view capability server-side for
    // DSH's official signed HttpOnly cookie. The process token never enters HTML,
    // a redirect URL, page JS, logs, or the renderer process.
    const connection = ctx.get('connection')
    if (typeof connection?.authenticatedUrl !== 'function' || typeof connection.authorizeIndex !== 'function') throw new Error('DSH public browser authentication is unavailable')
    const authorization = new URL(connection.authenticatedUrl(`http://${req.headers.host}/`))
    let browserCookie
    connection.authorizeIndex({ method: 'GET', url: authorization.pathname + authorization.search, headers: req.headers }, {
      writeHead(status, headers) { if (status === 303) browserCookie = headers?.['set-cookie'] }, end() {},
    })
    if (typeof browserCookie !== 'string' || !browserCookie.includes('HttpOnly')) throw new Error('DSH refused the native view browser cookie exchange')
    // Guard at mount as well as bundle delivery; never render the unadapted shell.
    patchLayout(await readFile(layoutPath || modules.clientPath('@deepseek-ai/dsh-client-ui-layout'), 'utf8'))
    const layoutFile = layoutPath || modules.clientPath('@deepseek-ai/dsh-client-ui-layout')
    const dist = frontendDir || join(dirname(dirname(dirname(layoutFile))), 'dsh-web-frontend', 'dist')
    const originalIndex = await readFile(join(dist, 'index.html'), 'utf8')
    const assets = [...originalIndex.matchAll(/<script\b[^>]*src="\.\/assets\/[^"\s]+"[^>]*><\/script>|<link\b[^>]*href="\.\/assets\/[^"\s]+"[^>]*>/g)].map(match => match[0].replaceAll('"./assets/', '"/assets/')).join('\n')
    if (!assets.includes('type="module"')) throw new Error('DSH official Web entry is unavailable')
    const setup = `globalThis.__FORSION_NATIVE_VIEW__=${inline({ descriptor: view.descriptor, ticket })};
globalThis.__DSH_TRANSPORT__={loadBundle(src){return new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='/forsion-native/bundle?ticket='+encodeURIComponent(${inline(ticket)})+'&src='+encodeURIComponent('/'+src.replace(/^\\//,''));s.onload=()=>resolve();s.onerror=()=>reject(new Error('Native DSH bundle failed: '+src));document.head.append(s);});}};`
    let html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><base href="/"><link rel="icon" href="data:,"><title>Forsion · ${view.descriptor.id}</title><style>html,body,#root{height:100%;margin:0;min-height:0}#root{display:flex;flex-direction:column}</style><script>${setup}</script>${assets}</head><body><div id="root"></div></body></html>`
    html = ctx.webServer.renderIndex(html)
    // The public injection table is prepended to <head>. Put base before those
    // rows so document-relative preloads never resolve below this view's ticket.
    html = html.replace('<base href="/">', '').replace('<head>', '<head><base href="/">')
    // Bootstrap batches also travel through the public, per-view guarded carrier.
    const allowed = resourceUrls(modules.graph())
    html = html.replace(/(<(?:script|link)\b[^>]*(?:src|href)=")([^"#]+)(")/g, (all, before, src, after) => {
      const path = '/' + src.replaceAll('&amp;', '&').replace(/^\//, '')
      return allowed.has(path) ? before + '/forsion-native/bundle?ticket=' + ticket + '&amp;src=' + encodeURIComponent(path) + after : all
    })
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'set-cookie': browserCookie }); res.end(html)
  }
  const off = ctx.webServer.register({ kind: 'prefix', path: '/forsion-native', handler: (req, res) => handle(req, res).catch(error => { log(`native view failed: ${error.message}`); if (!res.headersSent && !res.destroyed) json(res, 500, { error: String(error.message || error) }) }) })
  const api = {
    openView({ panelKey = 'task-board' } = {}) {
      if (disposed) throw new Error('Native view adapter is disabled')
      const descriptor = VIEW_ADAPTERS[panelKey]
      if (!descriptor) throw new Error('This panel has no verified native view adapter')
      views.clear() // First delivery is intentionally one native view instance.
      const ticket = randomBytes(24).toString('hex')
      views.set(ticket, { descriptor, expires: Date.now() + 12 * 60 * 60 * 1000 })
      return { path: `/forsion-native/view/${ticket}/`, panelKey, descriptor }
    },
    dispose() { if (disposed) return; disposed = true; views.clear(); off() },
  }
  ctx.effect(() => () => api.dispose())
  return api
}
