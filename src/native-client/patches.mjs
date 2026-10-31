// Explicit compatibility changes for Apache-2.0 Task Board 0.4.7.
// Original packages and their licenses remain intact. No private object mutation.
import { createHash } from 'node:crypto'

export const SPEC = Object.freeze({
  package: '@linxin666/dsh-client-ui-task-board', version: '0.4.7', patchVersion: 2,
  host: '863c7a195748802c7a54e099efef14c73af98477ad83aa4a56b8d0c490c9e209',
  client: '364bad5afc8e770ed09bbfe1f320b7514229f85e050b62bf540a1949dbf62fe9',
  layout: '686fb83c91c8ff8d03c365bb666ef34dacc3dd110eb768deacbc7998b885c8c1',
  previousClient: Object.freeze(['d4ee137c2086d851d42c2c372c79860d4329e80fa0611a05d033c3b14f2359b6']),
})
export const sha256 = value => createHash('sha256').update(value).digest('hex')
function replaceOne(source, before, after) {
  const first = source.indexOf(before)
  if (first < 0 || source.indexOf(before, first + before.length) >= 0) throw new Error(`Native compatibility anchor mismatch: ${before.slice(0, 85)}`)
  return source.slice(0, first) + after + source.slice(first + before.length)
}
export function patchHost(source) {
  if (sha256(source) !== SPEC.host) throw new Error('Unsupported Task Board host artifact (version/hash guard)')
  let out = replaceOne(source,
    'this.runner = new HostExecutionRunner(gateway, options.commandDispatcher, options.workspaceRegistry, void 0, options.ownerPeer);',
    'this.runner = options.runnerFactory ? options.runnerFactory({ promptText }) : new HostExecutionRunner(gateway, options.commandDispatcher, options.workspaceRegistry, void 0, options.ownerPeer);')
  out = replaceOne(out, 'const inject = [\n\t"systemPrompt",', 'const inject = [\n\t"nativeExecutionAdapters",\n\t"systemPrompt",')
  out = replaceOne(out, 'const host = new TaskBoardHostService(ctx.typertGateway, {', 'const host = new TaskBoardHostService(ctx.typertGateway, {\nrunnerFactory: ctx.get("nativeExecutionAdapters")?.create("task-board"),')
  out = replaceOne(out, 'this.runner.launch(opened.task, {', 'this.runner.launch(opened.task, {\nexecutionId: opened.execution.id,')
  return '// Modified by DSH2Forsion: optional public native execution runner factory, 2026-10-31.\n' + out.replace(/^\/\/[#@]\s*sourceMappingURL=.*(?:\r?\n)?/gm, '')
}
export function patchClient(source) {
  if (sha256(source) !== SPEC.client) throw new Error('Unsupported Task Board client artifact (version/hash guard)')
  let out = replaceOne(source, 'const controller = new BoardController({', 'const native = ctx.get("nativeExecutionClient");\nconst controller = new BoardController({')
  out = replaceOne(out, 'const inject = [\n\t\t\t"slots",', 'const inject = [\n\t\t\t"nativeExecutionClient",\n\t\t\t"slots",')
  out = replaceOne(out, 'current: () => mainViewSessionId(sessions.list.getSnapshot().byId),', 'current: () => native?.enabled ? native.currentSession() : mainViewSessionId(sessions.list.getSnapshot().byId),')
  out = replaceOne(out, 'open: (id) => ctx.uiWorkspace.openSession(id),', 'open: (id) => native?.enabled ? native.openSession(id) : ctx.uiWorkspace.openSession(id),')
  out = replaceOne(out, 'panel: { select: (panelId) => {', 'panel: { select: (panelId) => {\nif (native?.enabled && panelId === null) { native.openCurrentSession(); return; }')
  out = replaceOne(out, 'const pushWorkspaceOptions = () => {', 'const pushWorkspaceOptions = () => {\nif (native?.enabled) { void native.refresh(controller); return; }')
  out = replaceOne(out, 'const pushModelOptions = async () => {', 'const pushModelOptions = async () => {\nif (native?.enabled) { await native.refresh(controller); return; }')
  out = replaceOne(out, 'return { workspaceId: (await workspaces.create({ path })).workspaceId };', 'return { workspaceId: native?.enabled ? (await native.createWorkspace(path)).id : (await workspaces.create({ path })).workspaceId };')
  out = replaceOne(out, 'const pushPresetOptions = async (presetRemote) => {', 'const pushPresetOptions = async (presetRemote) => {\nif (ctx.get("nativeExecutionClient")?.enabled) return;')
  out = replaceOne(out, 'controller.start();\n\t\t\t\tclientService.attach(controller);\n\t\t\t\tconst disposers = [];', 'controller.start();\n\t\t\t\tclientService.attach(controller);\n\t\t\t\tconst disposers = [];\nif (native?.enabled) { native.bind(controller); disposers.push(() => native.unbind(controller)); }')
  return '// Modified by DSH2Forsion: public native context and navigation feed, 2026-10-31.\n' + out.replace(/^\/\/[#@]\s*sourceMappingURL=.*(?:\r?\n)?/gm, '')
}

// Per-view boot transport shim. Keep the *original* root registration, its child
// declarations, store and LayoutController. Only choose its component at build time.
export function patchLayout(source) {
  if (sha256(source) !== SPEC.layout) throw new Error('Unsupported DSH layout artifact (version/hash guard)')
  return replaceOne(source, '}, AppFrame);', `}, globalThis.__FORSION_NATIVE_VIEW__ ? function ForsionNativeRoot(props) {
    const React = require("react");
    const view = globalThis.__FORSION_NATIVE_VIEW__.descriptor;
    return React.createElement("main", {"data-forsion-native-panel":view.id,style:{height:"100vh",minHeight:0,display:"flex",flexDirection:"column"}},
      React.createElement("div", {id:"forsion-native-error",role:"alert",style:{color:"var(--text-error,#b42318)",whiteSpace:"pre-wrap"}}),
      props.renderSlot(view.slot, view.owner || {}, {entryKey:view.entryKey}));
  } : AppFrame);`)
}
