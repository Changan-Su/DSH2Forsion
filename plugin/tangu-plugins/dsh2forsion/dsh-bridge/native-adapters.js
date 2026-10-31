// src/native-client/host.mjs
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";

// src/native-client/runner.mjs
var REF_PREFIX = "forsion-task:";
function executionRef(id) {
  if (typeof id !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(id)) throw new Error("Invalid execution id");
  return REF_PREFIX + id;
}
function referencePayload(ref) {
  if (typeof ref !== "string" || !ref.startsWith(REF_PREFIX)) throw new Error("This is not a native task execution reference");
  const executionId = ref.slice(REF_PREFIX.length);
  executionRef(executionId);
  return { executionId };
}
var NativeTaskBoardRunner = class {
  constructor(invoke, { promptText }) {
    this.invoke = invoke;
    this.promptText = promptText;
  }
  async launch(task, options = {}) {
    const ref = executionRef(options.executionId);
    const context = await this.invoke("context", {});
    const target = task.handover?.workspaceId ?? task.workspaceId;
    const workspace = target ? context.workspaces?.find((w) => w.id === target || w.dshWorkspaceId === target) : context.workspace ?? context.workspaces?.find((w) => w.path === context.cwd);
    if (target && !workspace) throw new Error("Native workspace is not registered");
    const cwd = workspace?.path ?? context.cwd;
    if (!cwd) throw new Error("Open a Forsion project before running this task");
    const mode = task.handover?.mode ?? task.mode;
    if (mode && mode !== "tangu") throw new Error("This DSH Agent preset is not a native Tangu execution mode");
    if (options.goalEnabled) throw new Error("DSH native /goal is not a Tangu execution capability");
    options.onSession?.(ref);
    options.onGoalArmed?.(false);
    const result = await this.invoke("launch", {
      taskId: task.id,
      executionId: options.executionId,
      prompt: this.promptText(task, options.promptContext),
      title: task.title,
      cwd,
      ...target ? { workspaceId: workspace.id } : {},
      ...task.model ? { modelId: task.model } : {},
      mode: "tangu",
      ...task.handover?.permission ?? task.permission ? { permission: task.handover?.permission ?? task.permission } : {},
      ...task.reasoningEffort ? { reasoningEffort: task.reasoningEffort } : {},
      ...options.reuseSessionId ? { resumeExecutionId: referencePayload(options.reuseSessionId).executionId } : {}
    });
    if (!result?.sessionId || !result.runId) throw new Error("Native launch returned no owned Tangu run");
    return ref;
  }
  async listRunning() {
    const result = await this.invoke("list", {});
    if (result?.known !== true || !Array.isArray(result.items)) return { known: false };
    const items = result.items.map((item) => ({ sessionId: executionRef(item.executionId), running: ["queued", "running", "waiting"].includes(item.state), title: item.title ?? "", updatedAt: item.updatedAt ?? 0 }));
    return { known: true, items, count: items.filter((item) => item.running).length };
  }
  async inspect(ref) {
    const result = await this.invoke("status", referencePayload(ref));
    if (result.state === "succeeded") return { outcome: "succeeded" };
    if (result.state === "failed") return { outcome: "failed", error: result.error || "Tangu execution failed" };
    if (result.state === "cancelled") return { outcome: "cancelled", error: result.error || "Cancelled in Tangu" };
    if (["queued", "running", "waiting"].includes(result.state)) return { outcome: "pending" };
    return { outcome: "pending", unreadable: true, reason: result.error || "Native execution state is unknown" };
  }
  async modelCatalog() {
    const context = await this.invoke("context", {});
    return { groups: [{ id: "tangu", models: (context.models || []).map((m) => ({ ...m, reasoning: void 0 })) }] };
  }
};

// src/native-client/patches.mjs
import { createHash } from "node:crypto";
var SPEC = Object.freeze({
  package: "@linxin666/dsh-client-ui-task-board",
  version: "0.4.7",
  patchVersion: 2,
  host: "863c7a195748802c7a54e099efef14c73af98477ad83aa4a56b8d0c490c9e209",
  client: "364bad5afc8e770ed09bbfe1f320b7514229f85e050b62bf540a1949dbf62fe9",
  layout: "686fb83c91c8ff8d03c365bb666ef34dacc3dd110eb768deacbc7998b885c8c1",
  previousClient: Object.freeze(["d4ee137c2086d851d42c2c372c79860d4329e80fa0611a05d033c3b14f2359b6"])
});
var sha256 = (value) => createHash("sha256").update(value).digest("hex");
function replaceOne(source, before, after) {
  const first = source.indexOf(before);
  if (first < 0 || source.indexOf(before, first + before.length) >= 0) throw new Error(`Native compatibility anchor mismatch: ${before.slice(0, 85)}`);
  return source.slice(0, first) + after + source.slice(first + before.length);
}
function patchClient(source) {
  if (sha256(source) !== SPEC.client) throw new Error("Unsupported Task Board client artifact (version/hash guard)");
  let out = replaceOne(source, "const controller = new BoardController({", 'const native = ctx.get("nativeExecutionClient");\nconst controller = new BoardController({');
  out = replaceOne(out, 'const inject = [\n			"slots",', 'const inject = [\n			"nativeExecutionClient",\n			"slots",');
  out = replaceOne(out, "current: () => mainViewSessionId(sessions.list.getSnapshot().byId),", "current: () => native?.enabled ? native.currentSession() : mainViewSessionId(sessions.list.getSnapshot().byId),");
  out = replaceOne(out, "open: (id) => ctx.uiWorkspace.openSession(id),", "open: (id) => native?.enabled ? native.openSession(id) : ctx.uiWorkspace.openSession(id),");
  out = replaceOne(out, "panel: { select: (panelId) => {", "panel: { select: (panelId) => {\nif (native?.enabled && panelId === null) { native.openCurrentSession(); return; }");
  out = replaceOne(out, "const pushWorkspaceOptions = () => {", "const pushWorkspaceOptions = () => {\nif (native?.enabled) { void native.refresh(controller); return; }");
  out = replaceOne(out, "const pushModelOptions = async () => {", "const pushModelOptions = async () => {\nif (native?.enabled) { await native.refresh(controller); return; }");
  out = replaceOne(out, "return { workspaceId: (await workspaces.create({ path })).workspaceId };", "return { workspaceId: native?.enabled ? (await native.createWorkspace(path)).id : (await workspaces.create({ path })).workspaceId };");
  out = replaceOne(out, "const pushPresetOptions = async (presetRemote) => {", 'const pushPresetOptions = async (presetRemote) => {\nif (ctx.get("nativeExecutionClient")?.enabled) return;');
  out = replaceOne(out, "controller.start();\n				clientService.attach(controller);\n				const disposers = [];", "controller.start();\n				clientService.attach(controller);\n				const disposers = [];\nif (native?.enabled) { native.bind(controller); disposers.push(() => native.unbind(controller)); }");
  return "// Modified by DSH2Forsion: public native context and navigation feed, 2026-10-31.\n" + out.replace(/^\/\/[#@]\s*sourceMappingURL=.*(?:\r?\n)?/gm, "");
}
function patchLayout(source) {
  if (sha256(source) !== SPEC.layout) throw new Error("Unsupported DSH layout artifact (version/hash guard)");
  return replaceOne(source, "}, AppFrame);", `}, globalThis.__FORSION_NATIVE_VIEW__ ? function ForsionNativeRoot(props) {
    const React = require("react");
    const view = globalThis.__FORSION_NATIVE_VIEW__.descriptor;
    return React.createElement("main", {"data-forsion-native-panel":view.id,style:{height:"100vh",minHeight:0,display:"flex",flexDirection:"column"}},
      React.createElement("div", {id:"forsion-native-error",role:"alert",style:{color:"var(--text-error,#b42318)",whiteSpace:"pre-wrap"}}),
      props.renderSlot(view.slot, view.owner || {}, {entryKey:view.entryKey}));
  } : AppFrame);`);
}

// src/native-client/panels.mjs
var once = (source, before, after) => {
  const i = source.indexOf(before);
  if (i < 0 || source.indexOf(before, i + before.length) >= 0) throw new Error(`Native panel anchor changed: ${before.slice(0, 80)}`);
  return source.slice(0, i) + after + source.slice(i + before.length);
};
var PANEL_PATCHES = Object.freeze({
  "skills-manager": { package: "@michengai/dsh-skills-manager", version: "1.2.24", sha256: "4bbe039830ee2fb61b624ef0b1c70973ce388bb6738ca29610db0f4d38b983ab" },
  "git-graph": { package: "@linxin666/dsh-client-ui-git-graph", version: "0.4.7", sha256: "0859b8c161a85aba803b2a3d1d68dc46109d1866733ec4b45eb02e62e6b87e3d" }
});
function patchPanel(panel, source) {
  const spec = PANEL_PATCHES[panel];
  if (!spec || sha256(source) !== spec.sha256) throw new Error("Native panel original version/hash guard failed");
  let out = source;
  if (panel === "skills-manager") {
    out = once(out, 'var Us=["slots","locale"];', 'var Us=["slots","locale","nativeExecutionClient"];');
    out = once(out, "if(b&&g){", 'if(b&&(g||globalThis.__FORSION_NATIVE_VIEW__?.descriptor.id==="skills-manager")){');
  } else {
    out = once(out, 'const inject = [\n			"slots",', 'const inject = [\n			"nativeExecutionClient",\n			"slots",');
    out = once(out, "const cwdOf = (sessionId) => sessionId === void 0 ? void 0 : sessions.list.getSnapshot().byId[sessionId]?.cwd;", 'const cwdOf = (sessionId) => scope.get("nativeExecutionClient")?.enabled ? scope.get("nativeExecutionClient").currentCwd() : sessionId === void 0 ? void 0 : sessions.list.getSnapshot().byId[sessionId]?.cwd;');
    out = once(out, "let mounted = false;", `if (globalThis.__FORSION_NATIVE_VIEW__) scope.slots.inject("main", () => scope.slots.register({
      name:"main", key:"forsion-git-graph", locale:NS, inject:()=>({nativeGit:injected()})
    }, function ForsionNativeGitGraph({nativeGit,t}) {
      const ReactNative=require("react"); const native=scope.get("nativeExecutionClient");
      const graph=ReactNative.useCallback(async limit=>{await native.refresh();return nativeGit.graph(void 0,limit);},[nativeGit.graph]);
      return ReactNative.createElement("section",{"data-forsion-git-graph":""},ReactNative.createElement(GraphDialog,{graph,onClose:()=>native.openCurrentSession(),t}));
    }));
    let mounted = false;`);
  }
  return `// Modified by DSH2Forsion 2026-10-31: explicit public-slot native context adapter; original UI retained (Apache-2.0).
` + out.replace(/^\/\/[#@]\s*sourceMappingURL=.*(?:\r?\n)?/gm, "");
}

// src/native-client/host.mjs
var VIEW_ADAPTERS = Object.freeze({
  "task-board": Object.freeze({ id: "task-board", package: "@linxin666/dsh-client-ui-task-board", version: "0.4.7", slot: "main", entryKey: "task-board", owner: {} }),
  "skills-manager": Object.freeze({ id: "skills-manager", package: "@michengai/dsh-skills-manager", version: "1.2.24", slot: "main", entryKey: "skills-manager", owner: {} }),
  "git-graph": Object.freeze({ id: "git-graph", package: "@linxin666/dsh-client-ui-git-graph", version: "0.4.7", slot: "main", entryKey: "forsion-git-graph", owner: {} })
});
var browserOps = /* @__PURE__ */ new Set(["context", "cancel", "createWorkspace", "openSession"]);
var json = (res, status, data) => {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(data));
};
var inline = (value) => JSON.stringify(value).replaceAll("<", "\\u003c");
var preparedSource = (text) => {
  const clean = text.replace(/(?:\r?\n)?\/\/# sourceURL=([^\r\n]+)(?:\r?\n)?$/, "").replace(/(?:\r?\n)?\/\/# sourceMappingURL=[^\r\n]*(?:\r?\n)?$/, "");
  return clean.endsWith("\n") ? clean : clean + "\n";
};
async function readJson(req) {
  let size = 0;
  const parts = [];
  for await (const part of req) {
    size += part.length;
    if (size > 1048576) throw new Error("Native request is too large");
    parts.push(Buffer.from(part));
  }
  const value = JSON.parse(Buffer.concat(parts).toString("utf8") || "{}");
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Native request must be an object");
  return value;
}
function resourceUrls(graph) {
  return new Set([...graph.entries, ...graph.batches].map((row) => "/" + row.url.replace(/^\//, "")));
}
async function verifiedClient(modules, descriptor) {
  const file = modules.clientPath(descriptor.package);
  if (!file) throw new Error("The native panel client is unavailable");
  const root = dirname(dirname(file)), installed = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  if (installed.name !== descriptor.package || installed.version !== descriptor.version) throw new Error("The requested native panel version is not verified");
  const original = await readFile(join(root, ".forsion-native-original/client.js"), "utf8");
  const expected = descriptor.package === SPEC.package ? patchClient(original) : patchPanel(descriptor.id, original);
  const current = await readFile(file, "utf8");
  if (sha256(current) !== sha256(expected)) throw new Error("The native panel client changed after installation; refusing unverified code");
  return expected;
}
function installNativeAdapters(ctx, { invoke, log = () => {
}, frontendDir, layoutPath } = {}) {
  if (typeof invoke !== "function") throw new Error("Native execution callback is required");
  let disposed = false;
  const views = /* @__PURE__ */ new Map();
  const call = async (op, payload) => {
    if (disposed) throw new Error("Native adapter is disabled");
    let value = await invoke(op, payload);
    if (disposed) throw new Error("Native adapter was disabled during the request");
    if (op === "context" || op === "createWorkspace") {
      value = structuredClone(value);
      const registry = ctx.get("workspaceRegistry");
      const workspaces = op === "context" ? value.workspaces || (value.workspace ? [value.workspace] : []) : [value];
      if (workspaces.length && typeof registry?.create !== "function") throw new Error("DSH public workspace registry is unavailable");
      for (const workspace of workspaces) {
        if (typeof workspace?.path !== "string") throw new Error("Native workspace has no verified path");
        const registered = registry.list().find((item) => item.path === workspace.path) || await registry.create(workspace.path, workspace.name);
        if (registered?.id) workspace.dshWorkspaceId = registered.id;
        if (disposed) throw new Error("Native adapter was disabled during workspace synchronization");
      }
    }
    return value;
  };
  ctx.provide("nativeExecutionAdapters", {
    create(consumer) {
      if (consumer !== "task-board") throw new Error("Unknown native execution consumer");
      return (helpers) => new NativeTaskBoardRunner(call, helpers);
    }
  });
  const handle = async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    const ticket = req.headers["x-forsion-native-view"] || url.searchParams.get("ticket") || url.pathname.match(/^\/forsion-native\/view\/([a-f0-9]{48})\/$/)?.[1];
    const view = typeof ticket === "string" ? views.get(ticket) : void 0;
    if (!view || view.expires < Date.now()) return json(res, 403, { error: "Native view authorization expired; reopen the Forsion view" });
    if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) return json(res, 403, { error: "Native view origin mismatch" });
    if (req.method === "POST" && url.pathname.startsWith("/forsion-native/api/")) {
      const op = url.pathname.slice("/forsion-native/api/".length);
      if (!browserOps.has(op)) return json(res, 404, { error: "Unknown native view operation" });
      return json(res, 200, await call(op, await readJson(req)));
    }
    if (req.method !== "GET") return json(res, 405, { error: "Method not allowed" });
    const modules = ctx.get("clientModules");
    if (!modules) throw new Error("DSH public clientModules service is unavailable");
    if (url.pathname === "/forsion-native/bundle") {
      const src = url.searchParams.get("src") || "";
      const graph = modules.graph();
      if (!resourceUrls(graph).has(src)) return json(res, 403, { error: "Bundle is outside the active public client graph" });
      const response = await modules.fetchBundle(new Request("http://127.0.0.1" + src));
      if (!response.ok) return json(res, response.status, { error: "DSH client bundle is unavailable" });
      let source = await response.text();
      const ids = graph.batches.find((row) => "/" + row.url.replace(/^\//, "") === src)?.entries || graph.entries.filter((row) => "/" + row.url.replace(/^\//, "") === src).map((row) => row.id);
      for (const descriptor of Object.values(VIEW_ADAPTERS)) if (ids.includes(descriptor.package)) {
        const expected = preparedSource(await verifiedClient(modules, descriptor));
        if (!source.includes(expected)) throw new Error("DSH served a stale or unverified native panel artifact");
      }
      if (source.includes('id: "@deepseek-ai/dsh-client-ui-layout"')) {
        const original = await readFile(layoutPath || modules.clientPath("@deepseek-ai/dsh-client-ui-layout"), "utf8");
        const needle = preparedSource(original), patched = preparedSource(patchLayout(original));
        if (!source.includes(needle) || source.indexOf(needle) !== source.lastIndexOf(needle)) throw new Error("DSH layout combo artifact changed; refusing native view shim");
        source = source.replace(needle, patched);
      }
      res.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store" });
      res.end(source);
      return;
    }
    if (url.pathname !== `/forsion-native/view/${ticket}/`) return json(res, 404, { error: "Native view route not found" });
    if (!modules.graph().entries.some((e) => e.id === view.descriptor.package)) throw new Error("The requested panel package is not installed or active");
    await verifiedClient(modules, view.descriptor);
    const connection = ctx.get("connection");
    if (typeof connection?.authenticatedUrl !== "function" || typeof connection.authorizeIndex !== "function") throw new Error("DSH public browser authentication is unavailable");
    const authorization = new URL(connection.authenticatedUrl(`http://${req.headers.host}/`));
    let browserCookie;
    connection.authorizeIndex({ method: "GET", url: authorization.pathname + authorization.search, headers: req.headers }, {
      writeHead(status, headers) {
        if (status === 303) browserCookie = headers?.["set-cookie"];
      },
      end() {
      }
    });
    if (typeof browserCookie !== "string" || !browserCookie.includes("HttpOnly")) throw new Error("DSH refused the native view browser cookie exchange");
    patchLayout(await readFile(layoutPath || modules.clientPath("@deepseek-ai/dsh-client-ui-layout"), "utf8"));
    const layoutFile = layoutPath || modules.clientPath("@deepseek-ai/dsh-client-ui-layout");
    const dist = frontendDir || join(dirname(dirname(dirname(layoutFile))), "dsh-web-frontend", "dist");
    const originalIndex = await readFile(join(dist, "index.html"), "utf8");
    const assets = [...originalIndex.matchAll(/<script\b[^>]*src="\.\/assets\/[^"\s]+"[^>]*><\/script>|<link\b[^>]*href="\.\/assets\/[^"\s]+"[^>]*>/g)].map((match) => match[0].replaceAll('"./assets/', '"/assets/')).join("\n");
    if (!assets.includes('type="module"')) throw new Error("DSH official Web entry is unavailable");
    const setup = `globalThis.__FORSION_NATIVE_VIEW__=${inline({ descriptor: view.descriptor, ticket })};
globalThis.__DSH_TRANSPORT__={loadBundle(src){return new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='/forsion-native/bundle?ticket='+encodeURIComponent(${inline(ticket)})+'&src='+encodeURIComponent('/'+src.replace(/^\\//,''));s.onload=()=>resolve();s.onerror=()=>reject(new Error('Native DSH bundle failed: '+src));document.head.append(s);});}};`;
    let html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><base href="/"><link rel="icon" href="data:,"><title>Forsion \xB7 ${view.descriptor.id}</title><style>html,body,#root{height:100%;margin:0;min-height:0}#root{display:flex;flex-direction:column}</style><script>${setup}</script>${assets}</head><body><div id="root"></div></body></html>`;
    html = ctx.webServer.renderIndex(html);
    html = html.replace('<base href="/">', "").replace("<head>", '<head><base href="/">');
    const allowed = resourceUrls(modules.graph());
    html = html.replace(/(<(?:script|link)\b[^>]*(?:src|href)=")([^"#]+)(")/g, (all, before, src, after) => {
      const path = "/" + src.replaceAll("&amp;", "&").replace(/^\//, "");
      return allowed.has(path) ? before + "/forsion-native/bundle?ticket=" + ticket + "&amp;src=" + encodeURIComponent(path) + after : all;
    });
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer", "set-cookie": browserCookie });
    res.end(html);
  };
  const off = ctx.webServer.register({ kind: "prefix", path: "/forsion-native", handler: (req, res) => handle(req, res).catch((error) => {
    log(`native view failed: ${error.message}`);
    if (!res.headersSent && !res.destroyed) json(res, 500, { error: String(error.message || error) });
  }) });
  const api = {
    openView({ panelKey = "task-board" } = {}) {
      if (disposed) throw new Error("Native view adapter is disabled");
      const descriptor = VIEW_ADAPTERS[panelKey];
      if (!descriptor) throw new Error("This panel has no verified native view adapter");
      views.clear();
      const ticket = randomBytes(24).toString("hex");
      views.set(ticket, { descriptor, expires: Date.now() + 12 * 60 * 60 * 1e3 });
      return { path: `/forsion-native/view/${ticket}/`, panelKey, descriptor };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      views.clear();
      off();
    }
  };
  ctx.effect(() => () => api.dispose());
  return api;
}
export {
  VIEW_ADAPTERS,
  installNativeAdapters
};
