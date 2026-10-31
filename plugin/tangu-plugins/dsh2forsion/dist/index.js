// DSH2Forsion engine half (built from src/engine by build.mjs; do not edit)

// src/engine/index.mjs
import { existsSync as existsSync4, readFileSync as readFileSync3 } from "node:fs";
import { join as join8 } from "node:path";

// src/engine/constants.mjs
var DSH_VERSION = "0.2.1-rc.2";
var NODE_VERSION = "v24.22.0";
var PNPM_VERSION = "11.28.6";
var NODE_SHA256 = {
  "node-v24.22.0-darwin-arm64.tar.gz": "6a9724d9b50a5f22b4816cded441b5a8d9ddae546191a5e5b7efa5a5e2ee26d5",
  "node-v24.22.0-darwin-x64.tar.gz": "495e3f273c645f3c4677d438304cdfc701729ea5dec5728f5c8e76a2dece4b91",
  "node-v24.22.0-linux-arm64.tar.gz": "b7e7991d5407815adfa74a2a9cd4db683552c8ce32ff4a295c22e972849c3f5d",
  "node-v24.22.0-linux-x64.tar.gz": "28ea0a438de9a13bd7891fd758eee6c7819ee8af5442dfd8d45bd65e56d4228c",
  "node-v24.22.0-win-arm64.zip": "3a5c209a5bc59e65b3bc0fa13ed5e166a26bd3d55332847f498b76b037408d61",
  "node-v24.22.0-win-x64.zip": "f9683a19877e12a9b167305c8db71040d812876359de21f0d2e97c3f321f80c3"
};
var TRUSTED_NATIVE_PACKAGES = ["koffi", "node-pty", "@deepseek-ai/dsh-subprocess-local"];
var PROFILE = "forsion";
var BRIDGE_PACKAGE = "dsh2forsion-bridge";
var PLUGIN_ID = "dsh2forsion";
var NODE_MIRRORS = {
  official: "https://nodejs.org/dist",
  mirror: "https://npmmirror.com/mirrors/node"
};
var NPM_REGISTRIES = {
  official: "https://registry.npmjs.org/",
  mirror: "https://registry.npmmirror.com/"
};
var READY_TIMEOUT_MS = 9e4;
var PROMPT_SECTION_CAP = 4e3;

// src/engine/layout.mjs
import { join } from "node:path";
function nodePlatform(platform = process.platform, arch = process.arch) {
  const a = arch === "arm64" ? "arm64" : arch === "x64" ? "x64" : null;
  if (!a) return null;
  if (platform === "darwin") return { id: `darwin-${a}`, ext: "tar.gz" };
  if (platform === "linux") return { id: `linux-${a}`, ext: "tar.gz" };
  if (platform === "win32") return { id: `win-${a}`, ext: "zip" };
  return null;
}
function layout(root, platform = process.platform) {
  const win = platform === "win32";
  const nodeDir = join(root, "node", NODE_VERSION);
  const runtimeDir = join(root, "runtime", DSH_VERSION);
  const home = join(root, "home");
  return {
    root,
    nodeDir,
    nodeBin: win ? join(nodeDir, "node.exe") : join(nodeDir, "bin", "node"),
    nodeBinDir: win ? nodeDir : join(nodeDir, "bin"),
    // Locked pnpm wins over a leftover global copy; old v0.1 installations still fall back to it.
    runtimePath: [join(runtimeDir, "node_modules", ".bin"), win ? nodeDir : join(nodeDir, "bin")].join(win ? ";" : ":"),
    npmCli: win ? join(nodeDir, "node_modules", "npm", "bin", "npm-cli.js") : join(nodeDir, "lib", "node_modules", "npm", "bin", "npm-cli.js"),
    pnpmBin: join(runtimeDir, "node_modules", ".bin", win ? "pnpm.cmd" : "pnpm"),
    legacyPnpmBin: win ? join(nodeDir, "pnpm.cmd") : join(nodeDir, "bin", "pnpm"),
    runtimeDir,
    dshBin: join(runtimeDir, "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js"),
    home,
    profileDir: join(home, "profiles", PROFILE),
    trialHome: join(root, "trial"),
    backups: join(root, "backups"),
    cache: join(root, "cache"),
    runtimeMarker: join(runtimeDir, ".dsh2forsion-ready")
  };
}

// src/engine/plugins.mjs
import { existsSync as existsSync2 } from "node:fs";
import { cp as cp2, mkdir as mkdir2, readFile as readFile2, readdir as readdir2, rm as rm2, writeFile } from "node:fs/promises";
import { join as join4 } from "node:path";

// src/engine/profile.mjs
import { existsSync, readFileSync } from "node:fs";
import { cp, mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import { join as join2 } from "node:path";

// src/engine/env.mjs
var EXACT = /* @__PURE__ */ new Set([
  "PATH",
  "Path",
  "HOME",
  "USERPROFILE",
  "USER",
  "USERNAME",
  "LOGNAME",
  "SHELL",
  "TERM",
  "LANG",
  "LANGUAGE",
  "TMPDIR",
  "TEMP",
  "TMP",
  "SystemRoot",
  "SYSTEMROOT",
  "windir",
  "WINDIR",
  "ComSpec",
  "COMSPEC",
  "PATHEXT",
  "SystemDrive",
  "APPDATA",
  "LOCALAPPDATA",
  "ProgramData",
  "ProgramFiles",
  "ProgramFiles(x86)",
  "CommonProgramFiles",
  "HOMEDRIVE",
  "HOMEPATH",
  "NUMBER_OF_PROCESSORS",
  "PROCESSOR_ARCHITECTURE",
  "OS",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "ALL_PROXY",
  "http_proxy",
  "https_proxy",
  "no_proxy",
  "all_proxy",
  "NODE_EXTRA_CA_CERTS",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "DISPLAY",
  "WAYLAND_DISPLAY",
  "XAUTHORITY",
  "DBUS_SESSION_BUS_ADDRESS"
]);
var PREFIXES = ["LC_", "XDG_"];
function childEnv(parent, { binDir, extra = {} }) {
  const env = {};
  for (const [key, value] of Object.entries(parent)) {
    if (value === void 0) continue;
    if (EXACT.has(key) || PREFIXES.some((p) => key.startsWith(p))) env[key] = value;
  }
  const pathKey = Object.keys(env).find((k) => k.toUpperCase() === "PATH") ?? "PATH";
  const sep = process.platform === "win32" ? ";" : ":";
  env[pathKey] = [binDir, env[pathKey]].filter(Boolean).join(sep);
  return { ...env, ...extra };
}

// src/engine/proc.mjs
import { spawn } from "node:child_process";
function run(cmd, args, { cwd, env, timeoutMs = 6e5, onLine, signal } = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(cmd, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    } catch (error) {
      reject(error);
      return;
    }
    let out = "";
    let pending = "";
    let timedOut = false;
    const take = (chunk) => {
      const text = chunk.toString("utf8");
      out += text;
      if (out.length > 4 << 20) out = out.slice(-(2 << 20));
      if (!onLine) return;
      pending += text;
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() ?? "";
      for (const line of lines) if (line.trim()) onLine(line);
    };
    child.stdout.on("data", take);
    child.stderr.on("data", take);
    const kill = () => {
      try {
        child.kill("SIGKILL");
      } catch {
      }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, timeoutMs);
    const onAbort = () => kill();
    signal?.addEventListener("abort", onAbort, { once: true });
    child.once("error", (error) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      if (pending.trim() && onLine) onLine(pending);
      resolve({ code, out, timedOut });
    });
  });
}
function tail(text, n = 20) {
  return text.split(/\r?\n/).filter((l) => l.trim()).slice(-n).join("\n");
}

// src/engine/profile.mjs
function dsh(paths, home, args, { log, signal, timeoutMs = 9e5 } = {}) {
  const env = childEnv(process.env, {
    binDir: paths.runtimePath,
    extra: { DSH_HOME: home, npm_config_store_dir: join2(paths.cache, "pnpm-store"), npm_config_update_notifier: "false" }
  });
  return run(paths.nodeBin, [paths.dshBin, ...args], { cwd: home, env, timeoutMs, onLine: log, signal });
}
function profileDir(home) {
  return join2(home, "profiles", PROFILE);
}
async function ensureProfile(paths, home, opts = {}) {
  if (existsSync(join2(profileDir(home), "package.json"))) return;
  await mkdir(home, { recursive: true });
  const r = await dsh(paths, home, [PROFILE, "--from-default-profile", "web", "--dump-config"], opts);
  if (r.code !== 0 || !existsSync(join2(profileDir(home), "package.json"))) throw new Error(`profile init failed: ${r.out.slice(-600)}`);
}
function installedVersion(home, name) {
  try {
    return JSON.parse(readFileSync(join2(profileDir(home), "node_modules", ...name.split("/"), "package.json"), "utf8")).version;
  } catch {
    return null;
  }
}
async function bridgeFilesMatch(source, installed) {
  for (const entry of await readdir(source, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const from = join2(source, entry.name), to = join2(installed, entry.name);
    if (entry.isDirectory()) {
      if (!await bridgeFilesMatch(from, to)) return false;
    } else if (entry.isFile()) {
      let actual;
      try {
        actual = await readFile(to);
      } catch (error) {
        if (error.code === "ENOENT") return false;
        throw error;
      }
      if (!(await readFile(from)).equals(actual)) return false;
    }
  }
  return true;
}
async function ensureBridge(paths, home, bridgeDir, opts = {}) {
  const want = JSON.parse(await readFile(join2(bridgeDir, "package.json"), "utf8")).version;
  const have = installedVersion(home, BRIDGE_PACKAGE);
  const installed = join2(profileDir(home), "node_modules", BRIDGE_PACKAGE);
  if (have === want && await bridgeFilesMatch(bridgeDir, installed)) return false;
  if (have) await dsh(paths, home, ["plugin", "--profile", PROFILE, "remove", BRIDGE_PACKAGE], opts);
  const r = await dsh(paths, home, ["plugin", "--profile", PROFILE, "add", "--ignore-scripts", `file:${bridgeDir}`], opts);
  if (r.code !== 0) throw new Error(`bridge install failed: ${r.out.slice(-600)}`);
  if (!await bridgeFilesMatch(bridgeDir, installed)) throw new Error("Installed bridge differs from the shipped build");
  return true;
}
async function userPlugins(home) {
  try {
    const pkg = JSON.parse(await readFile(join2(profileDir(home), "package.json"), "utf8"));
    return Object.entries(pkg.dependencies ?? {}).filter(([name]) => name !== BRIDGE_PACKAGE).map(([name, spec]) => ({ name, spec, version: installedVersion(home, name) }));
  } catch {
    return [];
  }
}
async function shadowedCorePackages(paths, home) {
  const scope = join2(profileDir(home), "node_modules", "@deepseek-ai");
  let names = [];
  try {
    names = await readdir(scope);
  } catch {
    return [];
  }
  const out = [];
  for (const n of names) {
    let v;
    try {
      v = JSON.parse(await readFile(join2(scope, n, "package.json"), "utf8")).version;
    } catch {
      continue;
    }
    let runtimeV = null;
    try {
      runtimeV = JSON.parse(await readFile(join2(paths.runtimeDir, "node_modules", "@deepseek-ai", n, "package.json"), "utf8")).version;
    } catch {
    }
    if (runtimeV && runtimeV !== v) out.push({ name: `@deepseek-ai/${n}`, version: v, runtime: runtimeV });
  }
  return out;
}
var LAST_GOOD = "last-good";
var PROFILE_FILES = ["package.json", "cordis.patch.yml", "cordis.yml", "pnpm-workspace.yaml", "pnpm-lock.yaml", "compatibility.json"];
async function copyProfileFiles(fromDir, toDir) {
  await mkdir(toDir, { recursive: true });
  for (const f of PROFILE_FILES) {
    const src = join2(fromDir, f);
    if (existsSync(src)) await cp(src, join2(toDir, f));
    else await rm(join2(toDir, f), { force: true });
  }
}
async function newestBackup(backupsDir) {
  let entries = [];
  try {
    entries = await readdir(backupsDir);
  } catch {
    return null;
  }
  const dirs = [];
  for (const e of entries) {
    if (e === LAST_GOOD || e.startsWith("undone-")) continue;
    try {
      if ((await stat(join2(backupsDir, e))).isDirectory()) dirs.push(e);
    } catch {
    }
  }
  dirs.sort();
  return dirs.length ? join2(backupsDir, dirs[dirs.length - 1]) : null;
}

// src/engine/sidecar.mjs
import { spawn as spawn2 } from "node:child_process";
import { randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { join as join3 } from "node:path";
var READY = /dsh web: (http:\/\/127\.0\.0\.1:\d+)\/\?token=(\S+)/;
var LOG_LIMIT = 400;
var BRIDGE_TIMEOUT_MS = 15e3;
var Sidecar = class {
  /** @param {ReturnType<import('./layout.mjs').layout>} paths */
  constructor(paths, { home = paths.home, onState = () => {
  }, label = "main" } = {}) {
    this.paths = paths;
    this.home = home;
    this.onState = onState;
    this.label = label;
    this.state = "stopped";
    this.child = null;
    this.base = null;
    this.token = null;
    this.secret = null;
    this.error = null;
    this.lines = [];
    this.startedAt = null;
    this.readyMs = null;
    this.starting = null;
  }
  snapshot() {
    return { state: this.state, pid: this.child?.pid ?? null, base: this.base, startedAt: this.startedAt, readyMs: this.readyMs, error: this.error };
  }
  log(line) {
    this.lines.push(line);
    if (this.lines.length > LOG_LIMIT) this.lines.splice(0, this.lines.length - LOG_LIMIT);
  }
  setState(state, error = null) {
    this.state = state;
    this.error = error;
    this.onState(this.snapshot());
  }
  /** 已在跑就直接返回；正在启动就等同一次。 */
  start() {
    if (this.state === "running") return Promise.resolve(this.snapshot());
    if (this.starting) return this.starting;
    this.starting = this.spawnOnce().finally(() => {
      this.starting = null;
    });
    return this.starting;
  }
  spawnOnce() {
    return new Promise((resolve, reject) => {
      this.secret = randomBytes(32).toString("hex");
      this.lines = [];
      this.base = null;
      this.token = null;
      this.setState("starting");
      const t0 = Date.now();
      const env = childEnv(process.env, {
        binDir: this.paths.runtimePath,
        extra: { DSH_HOME: this.home, DSH2FORSION_SECRET: this.secret, DSH2FORSION_PARENT_PID: String(process.pid), npm_config_store_dir: join3(this.paths.cache, "pnpm-store"), npm_config_update_notifier: "false" }
      });
      let child;
      try {
        child = spawn2(this.paths.nodeBin, [this.paths.dshBin, "--profile", PROFILE, "--host", "127.0.0.1", "--port", "0", "--no-open"], {
          cwd: homedir(),
          env,
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true
        });
      } catch (error) {
        this.setState("failed", String(error.message ?? error));
        reject(error);
        return;
      }
      this.child = child;
      let settled = false;
      let pending = "";
      const onData = (chunk) => {
        pending += chunk.toString("utf8");
        const parts = pending.split(/\r?\n/);
        pending = parts.pop() ?? "";
        for (const line of parts) {
          if (!line.trim()) continue;
          this.log(line);
          const m = !settled && line.match(READY);
          if (m) {
            settled = true;
            clearTimeout(timer);
            this.base = m[1];
            this.token = m[2];
            this.startedAt = (/* @__PURE__ */ new Date()).toISOString();
            this.readyMs = Date.now() - t0;
            this.setState("running");
            resolve(this.snapshot());
          }
        }
      };
      child.stdout.on("data", onData);
      child.stderr.on("data", onData);
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        this.setState("failed", "DSH did not become ready in time");
        try {
          child.kill("SIGKILL");
        } catch {
        }
        reject(new Error(this.error));
      }, READY_TIMEOUT_MS);
      child.once("error", (error) => {
        if (this.child === child) this.child = null;
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.setState("failed", String(error.message ?? error));
        reject(error);
      });
      child.once("exit", (code, signal) => {
        if (pending.trim()) this.log(pending);
        this.child = null;
        this.base = null;
        this.token = null;
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          const why = this.lines.find((l) => /startup failed|fatal|SyntaxError|Error:/.test(l)) ?? `exited with ${code ?? signal}`;
          this.setState("failed", why.slice(0, 400));
          reject(new Error(this.error));
          return;
        }
        if (this.state === "running") this.setState(code === 0 || signal === "SIGTERM" ? "stopped" : "failed", code === 0 || signal === "SIGTERM" ? null : `exited with ${code ?? signal}`);
      });
    });
  }
  /** 有界停止：先 SIGTERM，等不到再 SIGKILL；SIGKILL 之后最多再等 2 秒，绝不无限期挂住。 */
  stop(graceMs = 4e3) {
    const child = this.child;
    const gone = !child || child.pid === void 0 || child.exitCode !== null || child.signalCode !== null;
    if (gone) {
      if (this.child === child) this.child = null;
      if (this.state !== "failed") this.setState("stopped");
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(kill);
        clearTimeout(giveUp);
        if (this.child === child) this.child = null;
        this.setState("stopped");
        resolve();
      };
      const kill = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
        }
      }, graceMs);
      const giveUp = setTimeout(finish, graceMs + 2e3);
      child.once("exit", finish);
      try {
        child.kill("SIGTERM");
      } catch {
        finish();
      }
    });
  }
  /** 给桥发请求（带密钥）。 */
  async bridge(path, init = {}) {
    if (this.state !== "running" || !this.base) throw new Error("DSH is not running");
    const res = await fetch(`${this.base}/forsion-bridge${path}`, {
      ...init,
      signal: init.signal ?? AbortSignal.timeout(BRIDGE_TIMEOUT_MS),
      headers: { "content-type": "application/json", "x-dsh2forsion-secret": this.secret, ...init.headers ?? {} }
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error ?? `bridge ${path} \u2192 ${res.status}`);
    return body;
  }
  /** 用 DSH 自己的登录 token 换 cookie，再调它的 /api 远程方法。 */
  async rpc(method, args = {}) {
    if (this.state !== "running" || !this.base) throw new Error("DSH is not running");
    if (!this.cookie || this.cookieFor !== this.base) {
      const login = await fetch(`${this.base}/?token=${this.token}`, { redirect: "manual", signal: AbortSignal.timeout(BRIDGE_TIMEOUT_MS) });
      this.cookie = (login.headers.get("set-cookie") ?? "").split(";")[0];
      this.cookieFor = this.base;
    }
    const res = await fetch(`${this.base}/api/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: this.base, cookie: this.cookie },
      body: JSON.stringify({ type: "client-request", rpcId: `d2f-${Date.now()}`, method, payload: { args } }),
      signal: AbortSignal.timeout(BRIDGE_TIMEOUT_MS)
    });
    const body = await res.json();
    if (!body?.result?.ok) throw new Error(body?.result?.error?.message ?? `rpc ${method} failed`);
    return body.result.value;
  }
  /** DSH Space 用的登录地址（webview 打开它换 cookie）。 */
  spaceUrl() {
    if (this.state !== "running" || !this.base) return null;
    return `${this.base}/?token=${this.token}`;
  }
};

// src/engine/plugins.mjs
var NPM_NAME = /^(@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*$/i;
var UNDONE_PREFIX = "undone-";
var UNDONE_KEEP = 5;
async function pruneUndone(backupsDir) {
  let entries = [];
  try {
    entries = (await readdir2(backupsDir)).filter((e) => e.startsWith(UNDONE_PREFIX)).sort();
  } catch {
    return;
  }
  for (const e of entries.slice(0, Math.max(0, entries.length - UNDONE_KEEP))) await rm2(join4(backupsDir, e), { recursive: true, force: true });
}
async function specName(spec) {
  if (typeof spec !== "string" || !spec.trim()) throw new Error("empty plugin spec");
  const s = spec.trim();
  if (s.startsWith("file:")) {
    const pkg = JSON.parse(await readFile2(join4(s.slice(5), "package.json"), "utf8"));
    return pkg.name;
  }
  const at = s.lastIndexOf("@");
  const name = at > 0 ? s.slice(0, at) : s;
  if (!NPM_NAME.test(name)) throw new Error(`not an npm package spec: ${spec}`);
  return name;
}
var VERSION_REFUSED = /allow-version|Exact-version exemption/i;
var BROKEN = /startup failed|failed to import|SyntaxError|Cannot find package|has no create\(\) factory/i;
var INACTIVE = /did not activate|waiting for service/i;
function judgeTrial({ ready, lines, shadowed, pluginName, graded = null }) {
  const judged = judgeStart({ ready, lines, shadowed, pluginName });
  const note = graded?.reason ? `compatibility matrix (${graded.checked ?? "M0"}): ${graded.reason}` : null;
  if (graded?.grade === "red" && judged.verdict !== "blocked") return { verdict: "blocked", reasons: [note ?? "compatibility matrix: does not work with this DSH version", ...judged.reasons] };
  if (graded?.grade === "yellow" && judged.verdict === "ok") return { verdict: "partial", reasons: [note ?? "compatibility matrix: partly works"] };
  return judged;
}
function judgeStart({ ready, lines, shadowed, pluginName }) {
  const reasons = [];
  if (shadowed.length) reasons.push(...shadowed.map((s) => `bundles ${s.name}@${s.version}, which overrides the runtime's ${s.runtime}`));
  if (!ready) {
    const why = lines.filter((l) => BROKEN.test(l)).slice(0, 6);
    reasons.push(...why.length ? why : ["DSH did not start"]);
    return { verdict: "blocked", reasons };
  }
  if (shadowed.length) return { verdict: "blocked", reasons };
  const inactive = lines.filter((l) => INACTIVE.test(l) || BROKEN.test(l));
  const mine = lines.filter((l) => l.includes(pluginName) && /error|fail|not a function|cannot|missing|pending|waiting|did not activate/i.test(l));
  if (inactive.length || mine.length) return { verdict: "partial", reasons: (mine.length ? mine : inactive).slice(0, 6) };
  return { verdict: "ok", reasons: [] };
}
var PluginManager = class {
  /**
   * @param {ReturnType<import('./layout.mjs').layout>} paths
   * @param {{ main: Sidecar, bridgeDir: string, known: () => any, log: (l: string) => void, restart: () => Promise<void> }} deps
   */
  constructor(paths, deps) {
    this.paths = paths;
    this.deps = deps;
    this.queue = Promise.resolve();
    this.busy = null;
    this.disposed = false;
    this.probe = null;
  }
  /** 插件被停用：不再接新活，正在试启动的那个 DSH 收掉；跑到一半的那件不会再去重启 sidecar。 */
  async dispose() {
    this.disposed = true;
    await this.probe?.stop(1e3).catch(() => {
    });
  }
  /** 插件操作一次只做一件。停用以后不再接新活。 */
  exclusive(label, fn) {
    if (this.disposed) return Promise.reject(new Error("DSH2Forsion is being turned off"));
    const job = this.queue.then(async () => {
      if (this.disposed) throw new Error("DSH2Forsion is being turned off");
      this.busy = label;
      try {
        return await fn();
      } finally {
        this.busy = null;
      }
    });
    this.queue = job.catch(() => {
    });
    return job;
  }
  async list() {
    const installed = await userPlugins(this.paths.home);
    let live = [];
    if (this.deps.main.state === "running") {
      try {
        live = await this.deps.main.rpc("pluginManager/listBundles");
      } catch {
        live = [];
      }
    }
    const known = this.deps.known();
    return installed.map((p) => {
      const b = live.find((x) => x.name === p.name);
      const k = known.plugins?.[`${p.name}@${p.version}`] ?? null;
      return {
        name: p.name,
        version: p.version,
        spec: p.spec,
        title: b?.meta?.title ?? null,
        description: b?.meta?.description ?? b?.description ?? null,
        enabled: b?.enabled ?? null,
        error: b?.error ?? null,
        known: k
      };
    });
  }
  install(spec, opts = {}) {
    return this.exclusive(`install ${spec}`, () => this.installNow(spec, opts));
  }
  async installNow(spec, { acceptRisk = false, confirm = false, force = false } = {}) {
    const name = await specName(spec);
    const log = this.deps.log;
    const known = this.deps.known();
    const verified = Boolean(known.exemptions?.includes(spec) || known.exemptions?.includes(`${name}@${spec.slice(name.length + 1)}`));
    const trial = this.paths.trialHome;
    await rm2(trial, { recursive: true, force: true });
    await copyProfileFiles(profileDir(this.paths.home), profileDir(trial));
    if (existsSync2(join4(this.paths.home, "cordis.patch.yml"))) await cp2(join4(this.paths.home, "cordis.patch.yml"), join4(trial, "cordis.patch.yml"));
    log(`trial: add ${spec}`);
    let exempted = false;
    let add = await dsh(this.paths, trial, ["plugin", "--profile", PROFILE, "add", "--ignore-scripts", spec], { log });
    if (add.code !== 0 && VERSION_REFUSED.test(add.out)) {
      if (!acceptRisk && !verified) {
        return { status: "version-refused", name, spec, verified, message: tail(add.out, 6) };
      }
      const grant = await dsh(this.paths, trial, ["plugin", "--profile", PROFILE, "allow-version", spec, "--dsh-version", DSH_VERSION, "--accept-risk"], { log });
      if (grant.code !== 0) return { status: "failed", name, spec, message: tail(grant.out, 6) };
      exempted = true;
      add = await dsh(this.paths, trial, ["plugin", "--profile", PROFILE, "add", "--ignore-scripts", spec], { log });
    }
    if (add.code !== 0) return { status: "failed", name, spec, message: tail(add.out, 8) };
    const shadowed = await shadowedCorePackages(this.paths, trial);
    const version = (await userPlugins(trial)).find((p) => p.name === name)?.version;
    const graded = version ? known.plugins?.[`${name}@${version}`] ?? null : null;
    if (this.disposed) return { status: "failed", name, spec, message: "DSH2Forsion is being turned off" };
    const probe = new Sidecar(this.paths, { home: trial, label: "trial" });
    this.probe = probe;
    let ready = false;
    try {
      await probe.start();
      ready = true;
    } catch {
      ready = false;
    }
    if (ready) await new Promise((r) => setTimeout(r, 1500));
    const lines = [...probe.lines];
    await probe.stop();
    this.probe = null;
    if (this.disposed) return { status: "failed", name, spec, message: "DSH2Forsion is being turned off" };
    const judged = judgeTrial({ ready, lines, shadowed, pluginName: name, graded });
    log(`trial: ${judged.verdict}`);
    if (judged.verdict === "blocked" && !force) return { status: "blocked", name, spec, reasons: judged.reasons };
    if (judged.verdict === "partial" && !confirm && !force) return { status: "needs-confirm", name, spec, reasons: judged.reasons };
    const backup = await this.snapshot(`before install ${spec}`);
    try {
      if (exempted) {
        const g = await dsh(this.paths, this.paths.home, ["plugin", "--profile", PROFILE, "allow-version", spec, "--dsh-version", DSH_VERSION, "--accept-risk"], { log });
        if (g.code !== 0) throw new Error(tail(g.out, 6));
      }
      const real = await dsh(this.paths, this.paths.home, ["plugin", "--profile", PROFILE, "add", "--ignore-scripts", spec], { log });
      if (real.code !== 0) throw new Error(tail(real.out, 8));
    } catch (error) {
      await this.restore(backup);
      return { status: "failed", name, spec, message: String(error.message ?? error) };
    }
    await rm2(trial, { recursive: true, force: true });
    await this.deps.restart();
    return { status: "installed", name, spec, exempted, verdict: judged.verdict, reasons: judged.reasons };
  }
  remove(name) {
    if (typeof name !== "string" || !NPM_NAME.test(name)) return Promise.resolve({ status: "failed", name, message: "not an npm package name" });
    return this.exclusive(`remove ${name}`, async () => {
      await this.snapshot(`before remove ${name}`);
      const r = await dsh(this.paths, this.paths.home, ["plugin", "--profile", PROFILE, "remove", name], { log: this.deps.log });
      if (r.code !== 0) return { status: "failed", name, message: tail(r.out, 8) };
      await this.deps.restart();
      return { status: "removed", name };
    });
  }
  /**
   * 回到最近一次改动之前；用掉的快照删掉，再回滚就往更早走。
   * 被换下来的那份（含之后在 DSH Space 里改的插件设置、从 DSH 插件页装的插件）先存进 backups/undone-<时刻>，
   * 不参与回滚顺序、只留最近几份：回滚错了还能手动拿回来。恢复失败就不删快照。
   */
  rollback() {
    return this.exclusive("rollback", async () => {
      const dir = await newestBackup(this.paths.backups);
      if (!dir) return { status: "nothing-to-roll-back" };
      const undone = await this.snapshot("replaced by rollback", UNDONE_PREFIX);
      await pruneUndone(this.paths.backups);
      const ok = await this.restore(dir);
      if (!ok) return { status: "failed", message: "could not reinstall the plugins of that snapshot; the snapshot was kept", kept: undone };
      await rm2(dir, { recursive: true, force: true });
      await this.deps.restart();
      return { status: "rolled-back", to: dir, kept: undone };
    });
  }
  /** sidecar 成功启动后调用：记下这份能启动的 profile。 */
  async saveLastGood() {
    const dir = join4(this.paths.backups, LAST_GOOD);
    await copyProfileFiles(profileDir(this.paths.home), join4(dir, "profile"));
    await cp2(join4(this.paths.home, "cordis.patch.yml"), join4(dir, "home.cordis.patch.yml")).catch(() => {
    });
    await writeFile(join4(dir, "label.txt"), `last good start ${(/* @__PURE__ */ new Date()).toISOString()}
`);
  }
  restoreLastGood() {
    return this.exclusive("restore last good", async () => {
      const dir = join4(this.paths.backups, LAST_GOOD);
      if (!existsSync2(join4(dir, "profile", "package.json"))) return { status: "nothing-to-restore" };
      await this.snapshot("before restoring last good");
      await this.restore(dir);
      await this.deps.restart();
      return { status: "restored" };
    });
  }
  async snapshot(label, prefix = "") {
    const stamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-");
    const dir = join4(this.paths.backups, `${prefix}${stamp}`);
    await mkdir2(dir, { recursive: true });
    await copyProfileFiles(profileDir(this.paths.home), join4(dir, "profile"));
    await cp2(join4(this.paths.home, "cordis.patch.yml"), join4(dir, "home.cordis.patch.yml")).catch(() => {
    });
    await writeFile(join4(dir, "label.txt"), `${label}
`);
    return dir;
  }
  async restore(dir) {
    await copyProfileFiles(join4(dir, "profile"), profileDir(this.paths.home));
    if (existsSync2(join4(dir, "home.cordis.patch.yml"))) await cp2(join4(dir, "home.cordis.patch.yml"), join4(this.paths.home, "cordis.patch.yml"));
    const r = await dsh(this.paths, this.paths.home, ["plugin", "--profile", PROFILE, "install", "--ignore-scripts"], { log: this.deps.log });
    if (r.code !== 0) this.deps.log(`restore install failed: ${tail(r.out, 6)}`);
    return r.code === 0;
  }
};

// src/engine/runtime.mjs
import { createHash } from "node:crypto";
import { createReadStream, existsSync as existsSync3, readFileSync as readFileSync2 } from "node:fs";
import { mkdir as mkdir3, readFile as readFile3, rm as rm3, writeFile as writeFile2, rename } from "node:fs/promises";
import { join as join5 } from "node:path";
function runtimeInstalled(paths) {
  try {
    const marker = JSON.parse(readFileSync2(paths.runtimeMarker, "utf8"));
    return marker.dsh === DSH_VERSION && marker.node === NODE_VERSION && marker.pnpm === PNPM_VERSION && existsSync3(paths.nodeBin) && existsSync3(paths.dshBin) && existsSync3(marker.lockSha256 ? paths.pnpmBin : paths.legacyPnpmBin);
  } catch {
    return false;
  }
}
function sources(choice = "auto") {
  if (choice === "official") return ["official"];
  if (choice === "mirror") return ["mirror"];
  return ["official", "mirror"];
}
async function sha256(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}
var PROXY_VARS = ["HTTPS_PROXY", "https_proxy", "ALL_PROXY", "all_proxy"];
async function download(url, file, signal) {
  if (PROXY_VARS.some((k) => process.env[k])) {
    try {
      const r = await run("curl", ["-fsSL", "--retry", "2", "-o", file, url], { env: childEnv(process.env, { binDir: "" }), timeoutMs: 9e5, signal });
      if (r.code === 0) return;
      throw new Error(`GET ${url} (curl): ${tail(r.out, 3)}`);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`GET ${url} \u2192 ${res.status}`);
  await writeFile2(file, Buffer.from(await res.arrayBuffer()));
}
function tarBin() {
  if (process.platform !== "win32") return "tar";
  const system = join5(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe");
  return existsSync3(system) ? system : "tar";
}
async function installNode(paths, { source, log, signal }) {
  if (existsSync3(paths.nodeBin)) return;
  const plat = nodePlatform();
  if (!plat) throw new Error(`unsupported platform ${process.platform}-${process.arch}`);
  const name = `node-${NODE_VERSION}-${plat.id}`;
  const file = `${name}.${plat.ext}`;
  const tmp = join5(paths.root, "downloads");
  await mkdir3(tmp, { recursive: true });
  let lastError;
  for (const which of sources(source)) {
    const base = `${NODE_MIRRORS[which]}/${NODE_VERSION}`;
    try {
      log(`download ${file} (${which})`);
      let expected = NODE_SHA256[file];
      if (!expected) {
        await download(`${base}/SHASUMS256.txt`, join5(tmp, "SHASUMS256.txt"), signal);
        const sums = await readFile3(join5(tmp, "SHASUMS256.txt"), "utf8");
        expected = sums.split("\n").map((l) => l.trim().split(/\s+/)).find(([, f]) => f === file)?.[0];
      }
      if (!expected) throw new Error(`${file} missing from SHASUMS256.txt`);
      await download(`${base}/${file}`, join5(tmp, file), signal);
      const actual = await sha256(join5(tmp, file));
      if (actual !== expected) throw new Error(`checksum mismatch for ${file}`);
      log(`checksum ok ${actual.slice(0, 12)}\u2026`);
      const stage = `${paths.nodeDir}.partial`;
      await rm3(stage, { recursive: true, force: true });
      await mkdir3(stage, { recursive: true });
      const r = await run(tarBin(), ["-xf", join5(tmp, file), "-C", stage, "--strip-components=1"], { timeoutMs: 3e5, signal });
      if (r.code !== 0) throw new Error(`extract failed: ${tail(r.out, 5)}`);
      await rm3(paths.nodeDir, { recursive: true, force: true });
      await rename(stage, paths.nodeDir);
      await rm3(tmp, { recursive: true, force: true });
      return;
    } catch (error) {
      lastError = error;
      log(`node download from ${which} failed: ${error.message}`);
      if (signal?.aborted) break;
    }
  }
  throw lastError ?? new Error("node download failed");
}
function npm(paths, args, { registry, log, signal, cwd }) {
  signal?.throwIfAborted();
  const env = childEnv(process.env, {
    binDir: paths.nodeBinDir,
    extra: { npm_config_cache: join5(paths.cache, "npm"), npm_config_registry: registry, npm_config_update_notifier: "false", npm_config_fund: "false", npm_config_audit: "false" }
  });
  return run(paths.nodeBin, [paths.npmCli, ...args], { cwd, env, timeoutMs: 12e5, onLine: log, signal });
}
async function installDsh(paths, { source, log, signal }) {
  await mkdir3(paths.runtimeDir, { recursive: true });
  const manifest = await readFile3(new URL("../runtime/package.json", import.meta.url));
  const lock = await readFile3(new URL("../runtime/package-lock.json", import.meta.url));
  signal?.throwIfAborted();
  await rm3(paths.runtimeMarker, { force: true });
  await writeFile2(join5(paths.runtimeDir, "package.json"), manifest);
  await writeFile2(join5(paths.runtimeDir, "package-lock.json"), lock);
  let lastError;
  for (const which of sources(source)) {
    signal?.throwIfAborted();
    const registry = NPM_REGISTRIES[which];
    log(`npm ci @deepseek-ai/dsh@${DSH_VERSION}, pnpm@${PNPM_VERSION} (${which})`);
    const r = await npm(paths, ["ci", "--ignore-scripts", "--no-audit", "--no-fund"], { registry, log, signal, cwd: paths.runtimeDir });
    signal?.throwIfAborted();
    if (r.code !== 0) {
      lastError = new Error(`npm ci failed (${which}): ${tail(r.out, 5)}`);
      log(lastError.message);
      continue;
    }
    const approve = await npm(paths, ["install-scripts", "approve", ...TRUSTED_NATIVE_PACKAGES], { registry, log, signal, cwd: paths.runtimeDir });
    if (approve.code !== 0) log("npm install-scripts approve unavailable; rebuilding anyway");
    log("build DSH native dependencies");
    const b = await npm(paths, ["rebuild", ...TRUSTED_NATIVE_PACKAGES], { registry, log, signal, cwd: paths.runtimeDir });
    if (b.code !== 0) {
      lastError = new Error(`native rebuild failed: ${tail(b.out, 5)}`);
      log(lastError.message);
      continue;
    }
    signal?.throwIfAborted();
    return { registry, lockSha256: createHash("sha256").update(lock).digest("hex") };
  }
  throw lastError ?? new Error("runtime install failed");
}
async function installRuntime(paths, { source = "auto", log = () => {
}, signal } = {}) {
  signal?.throwIfAborted();
  if (runtimeInstalled(paths)) {
    log("runtime already installed");
    return;
  }
  await mkdir3(paths.root, { recursive: true });
  await installNode(paths, { source, log, signal });
  const { registry, lockSha256 } = await installDsh(paths, { source, log, signal });
  signal?.throwIfAborted();
  await writeFile2(paths.runtimeMarker, JSON.stringify({ dsh: DSH_VERSION, node: NODE_VERSION, pnpm: PNPM_VERSION, registry, lockSha256, at: (/* @__PURE__ */ new Date()).toISOString() }) + "\n");
  await rm3(join5(paths.cache, "npm"), { recursive: true, force: true }).catch(() => {
  });
  log("runtime ready");
}

// src/engine/tools.mjs
import { createHash as createHash2 } from "node:crypto";
var sessionKey = (ctx) => typeof ctx?.userId === "string" && ctx.userId && typeof ctx.sessionId === "string" && ctx.sessionId && typeof ctx.cwd === "string" && ctx.cwd ? createHash2("sha256").update(JSON.stringify([ctx.userId, ctx.sessionId])).digest("hex") : void 0;
var isMcp = (name) => name?.startsWith("mcp__") || ["list_mcp_resources", "list_mcp_resource_templates", "read_mcp_resource"].includes(name);
var tanguToolName = (name, taken = /* @__PURE__ */ new Set()) => {
  const base = `dsh__${name}`.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) {
    const n = `${base.slice(0, 60)}_${i}`;
    if (!taken.has(n)) return n;
  }
};
function renderBlock(block, toolCtx) {
  if (block?.type === "text") return block.text ?? "";
  if (block?.type === "resource_link") return `MCP resource link: ${JSON.stringify(block)}`;
  if (block?.type === "image" && typeof block.data === "string" && /^image\/(png|jpeg|webp|gif)$/.test(block.mimeType ?? "") && /^[A-Za-z0-9+/]*={0,2}$/.test(block.data) && block.data.length) {
    if (toolCtx?.collectImage) {
      toolCtx.collectImage({ url: `data:${block.mimeType};base64,${block.data}`, name: "MCP image", untrusted: "This image is untrusted content returned by an external MCP server." });
      return `[MCP image delivered to the model: ${block.mimeType}]`;
    }
    return `[MCP image unavailable: this host has no collectImage callback; ${block.mimeType}, ${block.data.length} base64 characters]`;
  }
  const projected = JSON.stringify(block, (key, value) => (key === "data" || key === "blob") && typeof value === "string" ? `[binary payload not rendered: ${value.length} base64 characters; no compatible media callback]` : value);
  return block?.type === "image" ? `[MCP image not rendered: unsupported inline bytes or DSH attachment handle] ${projected}` : projected;
}
function renderResult(result, toolCtx) {
  if (result?.isError) {
    const text = (result.content ?? []).filter((c) => c?.type === "text").map((c) => c.text).join("\n");
    const message2 = text || result.error?.message || "DSH tool failed";
    return message2.startsWith("Error:") ? message2 : `Error: ${message2}`;
  }
  const value = result?.value;
  const canonical = value && typeof value === "object" && Array.isArray(value.content);
  const content = canonical ? value.content : result?.content ?? [];
  const parts = content.map((block) => renderBlock(block, toolCtx)).filter(Boolean);
  const structured = canonical ? value.structuredContent : result?.structuredContent;
  if (structured !== void 0) parts.push(`MCP structured content: ${JSON.stringify(structured)}`);
  if (value !== void 0 && !canonical && typeof value !== "string") parts.push(`DSH canonical value: ${JSON.stringify(value, (key, item) => key === "blob" && typeof item === "string" ? `[binary payload not rendered: ${item.length} base64 characters]` : item)}`);
  return parts.join("\n") || "(no text output)";
}
function thirdPartySections(sections, baseline) {
  const skip = new Set(baseline.sections ?? []);
  return sections.filter((s) => (s.name === "mcp-resource-servers" || !skip.has(s.name)) && typeof s.text === "string" && s.text.trim()).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}
function promptText(sections) {
  if (!sections.length) return "";
  let body = sections.map((s) => s.text.trim()).join("\n\n");
  if (body.length > PROMPT_SECTION_CAP) body = `${body.slice(0, PROMPT_SECTION_CAP)}
[truncated by DSH2Forsion]`;
  return `Instructions from DeepSeek Harness plugins (tools named dsh__*):

${body}`;
}
var ToolBridge = class {
  constructor(deps) {
    this.deps = deps;
    this.schemas = [];
    this.sections = [];
    this.timer = null;
    this.revision = 0;
    this.refreshRevision = 0;
  }
  async refresh() {
    const { sidecar, baseline } = this.deps;
    const revision = ++this.refreshRevision;
    if (sidecar.state !== "running" || !this.deps.enabled()) {
      this.schemas = [];
      this.sections = [];
      return;
    }
    try {
      const b = baseline();
      const skip = new Set(b.tools ?? []);
      const [{ tools }, { sections }] = await Promise.all([sidecar.bridge("/tools"), sidecar.bridge("/prompt")]);
      if (revision !== this.refreshRevision || sidecar.state !== "running" || !this.deps.enabled()) return;
      this.schemas = (tools ?? []).filter((t) => !skip.has(t.name) && !isMcp(t.name));
      this.sections = thirdPartySections(sections ?? [], b).filter((s) => s.name !== "mcp-resource-servers" && !s.name.startsWith("mcp:"));
    } catch (error) {
      if (revision === this.refreshRevision) {
        this.schemas = [];
        this.sections = [];
      }
      this.deps.log(`tool refresh failed: ${error.message}`);
    }
  }
  startPolling(ms = 3e4) {
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => {
      void this.refresh();
    }, ms);
    this.timer.unref?.();
  }
  stopPolling() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.revision++;
    this.refreshRevision++;
    this.schemas = [];
    this.sections = [];
  }
  toolDefs(isEnabledFor) {
    try {
      if (!this.deps.enabled()) return [];
      const make = (name, description, parameters, execute) => ({
        name,
        isEnabledFor,
        definition: { type: "function", function: { name, description, parameters } },
        capabilities: { sideEffect: "unknown", approval: "always", automationSafe: false },
        execute
      });
      const scoped = [
        make("dsh_mcp_catalog", "Discover currently visible DSH MCP tools, input schemas and resource servers in this project. A listed name is not proof of package ownership. Call before dsh_mcp_call.", { type: "object", properties: {} }, (_args, ctx) => this.catalog(ctx)),
        make("dsh_mcp_call", "Call one exact tool name from dsh_mcp_catalog in this project. The live scoped registry and native approvals remain authoritative.", { type: "object", properties: { name: { type: "string" }, arguments: { type: "object" } }, required: ["name"] }, (args, ctx) => this.callMcp(args, ctx))
      ];
      const taken = new Set(scoped.map((t) => t.name));
      return [...scoped, ...this.schemas.map((t) => {
        const name = tanguToolName(t.name, taken);
        taken.add(name);
        return make(name, `${t.description ?? ""}
(DeepSeek Harness sidecar tool, outside Tangu's file policy and checkpoints.)`.trim(), t.parameters ?? { type: "object", properties: {} }, (args, ctx) => this.execute(t.name, args, ctx));
      })];
    } catch {
      return [];
    }
  }
  async snapshot(toolCtx) {
    if (!this.deps.enabled() || this.deps.sidecar.state !== "running") throw new Error("DeepSeek Harness plugin or runtime is not active");
    const query = new URLSearchParams();
    if (toolCtx?.cwd !== void 0) query.set("cwd", toolCtx.cwd);
    const key = sessionKey(toolCtx);
    if (key) query.set("sessionKey", key);
    const snapshot = await this.deps.sidecar.bridge(`/mcp/catalog${query.size ? `?${query}` : ""}`, { signal: toolCtx?.signal });
    if (!this.deps.enabled() || this.deps.sidecar.state !== "running") throw new Error("DeepSeek Harness plugin or runtime is no longer active");
    toolCtx?.signal?.throwIfAborted();
    return snapshot;
  }
  async catalog(toolCtx) {
    try {
      return JSON.stringify(await this.snapshot(toolCtx));
    } catch (error) {
      return `Error: DSH MCP discovery failed: ${error.message}`;
    }
  }
  async callMcp(args, toolCtx) {
    try {
      if (typeof args?.name !== "string") throw new Error("An exact listed MCP tool name is required");
      const { tools } = await this.snapshot(toolCtx);
      if (!tools?.some((tool) => tool.name === args.name)) throw new Error("MCP tool is not available in this project");
      return this.execute(args.name, args.arguments, toolCtx);
    } catch (error) {
      return `Error: DSH MCP call failed: ${error.message}`;
    }
  }
  async execute(dshName, args, toolCtx) {
    const { sidecar } = this.deps;
    if (!this.deps.enabled() || sidecar.state !== "running") return "Error: the DeepSeek Harness plugin or runtime is not active.";
    try {
      const revision = this.revision;
      const body = { name: dshName, arguments: args ?? {}, approved: true, cwd: toolCtx?.cwd, sessionKey: sessionKey(toolCtx) };
      const { result } = await sidecar.bridge("/tools/execute", { method: "POST", body: JSON.stringify(body), signal: toolCtx?.signal });
      if (!this.deps.enabled() || sidecar.state !== "running" || revision !== this.revision) return "Error: DeepSeek Harness activation changed during this call.";
      toolCtx?.signal?.throwIfAborted();
      return renderResult(result, toolCtx);
    } catch (error) {
      return `Error: DSH2Forsion bridge call failed: ${error.message}`;
    }
  }
  promptSection() {
    try {
      return this.deps.enabled() ? [promptText(this.sections), "Use dsh_mcp_catalog to discover live MCP tools and resource servers for this project, then dsh_mcp_call with an exact listed name. Media limitations are reported explicitly."].filter(Boolean).join("\n\n") : "";
    } catch {
      return "";
    }
  }
};
var PROVIDER_ID = `plugin:${PLUGIN_ID}`;

// src/engine/native-execution.mjs
import { createHash as createHash3, randomBytes as randomBytes2, randomUUID, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { mkdir as mkdir4, readFile as readFile4, realpath, rename as rename2, stat as stat2, writeFile as writeFile3 } from "node:fs/promises";
import { basename, dirname, isAbsolute } from "node:path";
var terminal = /* @__PURE__ */ new Set(["succeeded", "failed", "cancelled"]);
var id = (kind, value) => {
  const h = createHash3("sha256").update(`dsh2forsion:${kind}:${value}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
var message = (error) => String(error?.message ?? error);
var required = (value, name, max = 512) => {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error(`Invalid ${name}`);
  return value;
};
var NativeExecution = class {
  constructor({ runs, file, enabled = () => true, navigationTimeoutMs = 15e3 }) {
    this.runs = runs;
    this.file = file;
    this.enabled = enabled;
    this.navigationTimeoutMs = navigationTimeoutMs;
    this.data = { version: 1, userId: null, context: null, projects: {}, executions: {} };
    this.queue = Promise.resolve();
    this.locks = /* @__PURE__ */ new Map();
    this.events = /* @__PURE__ */ new Map();
    this.secret = randomBytes2(32).toString("hex");
    this.disposed = false;
    this.server = null;
    this.ready = this.load();
  }
  async load() {
    let text;
    try {
      text = await readFile4(this.file, "utf8");
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
    const data = JSON.parse(text);
    if (data?.version !== 1 || !data.projects || !data.executions || typeof data.projects !== "object" || typeof data.executions !== "object" || Array.isArray(data.projects) || Array.isArray(data.executions)) throw new Error("Invalid native task ledger; refusing to overwrite it");
    for (const [key, record] of Object.entries(data.executions)) {
      if (!record || record.executionId !== key || !record.sessionId || !record.runId || !record.intent || !data.userId) throw new Error("Invalid native task record");
    }
    this.data = data;
  }
  check(userId) {
    if (this.disposed || !this.enabled()) throw new Error("Native compatibility is disabled");
    if (!this.runs?.context || !this.runs?.start) throw new Error("Update Forsion to use native task execution");
    if (userId !== void 0 && (!userId || this.data.userId && this.data.userId !== userId)) throw new Error("Native view belongs to another local user");
  }
  async save(change) {
    const work = this.queue.then(async () => {
      this.check();
      const next = structuredClone(this.data);
      const result = change(next);
      await mkdir4(dirname(this.file), { recursive: true });
      const temp = `${this.file}.${randomUUID()}.tmp`;
      await writeFile3(temp, JSON.stringify(next, null, 2), { mode: 384 });
      this.check();
      await rename2(temp, this.file);
      this.data = next;
      return result;
    });
    this.queue = work.catch(() => {
    });
    return work;
  }
  async project(path) {
    if (typeof path !== "string" || !isAbsolute(path)) throw new Error("Select an absolute project directory in Tangu");
    const cwd = await realpath(path);
    if (!(await stat2(cwd)).isDirectory()) throw new Error("Project is not a directory");
    return { id: id("project", process.platform === "win32" ? cwd.toLowerCase() : cwd), path: cwd, name: basename(cwd) || cwd };
  }
  async configure(userId, { sessionId, models = [] } = {}) {
    await this.ready;
    this.check(userId);
    const current = await this.runs.context(required(sessionId, "active Tangu session"), userId);
    const workspace = await this.project(current.cwd);
    const catalog = (Array.isArray(models) ? models : []).slice(0, 1e3).filter((m) => typeof m?.id === "string" && m.id.length < 512).map((m) => ({ id: m.id, name: String(m.name || m.id).slice(0, 200), ...typeof m.provider === "string" ? { provider: m.provider } : {} }));
    if (current.modelId && !catalog.some((m) => m.id === current.modelId)) catalog.push({ id: current.modelId, name: current.modelId });
    this.check(userId);
    await this.save((data) => {
      if (data.userId && data.userId !== userId) throw new Error("Native view belongs to another local user");
      data.userId = userId;
      data.projects[workspace.id] = workspace;
      data.context = { ...current, cwd: workspace.path, workspace, models: catalog };
    });
    return this.context();
  }
  context() {
    this.check();
    const context = this.data.context;
    if (!context || !this.data.userId) throw new Error("Open this view from a Tangu project session first");
    return {
      cwd: context.cwd,
      workspace: context.workspace,
      workspaces: Object.values(this.data.projects),
      models: context.models,
      defaultModelId: context.modelId,
      currentSessionId: context.sessionId,
      agentModes: [{ id: "tangu", name: "Tangu" }]
    };
  }
  async exclusive(key, fn) {
    const before = this.locks.get(key) || Promise.resolve();
    const work = before.catch(() => {
    }).then(fn);
    this.locks.set(key, work);
    try {
      return await work;
    } finally {
      if (this.locks.get(key) === work) this.locks.delete(key);
    }
  }
  record(payload) {
    const executionId = payload.executionId ?? (String(payload.sessionId || "").startsWith("forsion-task:") ? payload.sessionId.slice(13) : null);
    const record = executionId ? Object.hasOwn(this.data.executions, executionId) ? this.data.executions[executionId] : null : Object.values(this.data.executions).find((r) => r.sessionId === payload.sessionId && (!payload.runId || r.runId === payload.runId));
    if (!record) throw new Error("Unknown native execution");
    return record;
  }
  async startRecord(record) {
    this.check();
    if (record.cancelRequested) return { sessionId: record.sessionId, runId: record.runId };
    const result = await this.runs.start({ ...record.intent, userId: this.data.userId, sessionId: record.sessionId, requestId: record.runId });
    if (result.sessionId !== record.sessionId || result.runId !== record.runId) throw new Error("Native run identity mismatch");
    await this.save((data) => {
      data.executions[record.executionId].started = true;
    });
    return result;
  }
  async launch(payload) {
    const executionId = required(payload.executionId, "execution ID");
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(executionId) || ["constructor", "prototype", "__proto__"].includes(executionId)) throw new Error("Invalid execution ID");
    return this.exclusive(executionId, async () => {
      const context = this.context();
      const workspace = await this.project(payload.cwd || context.cwd);
      if (!this.data.projects[workspace.id] || payload.workspaceId && payload.workspaceId !== workspace.id) throw new Error("Project has not been selected in the native view");
      if (payload.mode && payload.mode !== "tangu") throw new Error(`Unsupported agent mode: ${payload.mode}`);
      const permission = payload.permission || "default";
      if (!["default", "readonly", "read-only", "auto-edit", "workspace-write"].includes(permission)) throw new Error(`Unsupported permission mode: ${permission}`);
      const modelId = payload.modelId || context.defaultModelId;
      if (!modelId || !context.models.some((m) => m.id === modelId)) throw new Error("Select an available Tangu model");
      const prompt = required(payload.prompt, "prompt", 1e5);
      const resumed = payload.resumeExecutionId ? this.record({ executionId: required(payload.resumeExecutionId, "resume execution ID") }) : null;
      if (resumed && resumed.intent.cwd !== workspace.path) throw new Error("Cannot resume a task in a different project");
      const intent = {
        prompt,
        cwd: workspace.path,
        modelId,
        parentSessionId: context.currentSessionId,
        title: String(payload.title || prompt).slice(0, 200),
        readOnly: ["readonly", "read-only"].includes(permission),
        ...payload.reasoningEffort ? { thinkingLevel: required(payload.reasoningEffort, "reasoning effort", 64) } : {}
      };
      const fingerprint = createHash3("sha256").update(JSON.stringify({ taskId: payload.taskId, prompt, cwd: intent.cwd, modelId, readOnly: intent.readOnly, thinkingLevel: intent.thinkingLevel, resumeExecutionId: payload.resumeExecutionId })).digest("hex");
      let record = this.data.executions[executionId];
      if (record && record.fingerprint !== fingerprint) throw new Error("Execution ID already used with different input");
      if (!record) {
        if (Object.keys(this.data.executions).length >= 1e4) throw new Error("Native task ledger is full");
        record = {
          executionId,
          taskId: required(payload.taskId, "task ID"),
          fingerprint,
          intent,
          sessionId: resumed?.sessionId || id("session", `${this.data.userId}:${executionId}`),
          runId: id("run", `${this.data.userId}:${executionId}`),
          started: false,
          cancelRequested: false
        };
        await this.save((data) => {
          data.executions[executionId] = record;
        });
      }
      return this.startRecord(record);
    });
  }
  async statusRecord(record, recover = true) {
    this.check();
    let result;
    try {
      result = await this.runs.status(record.runId, this.data.userId);
    } catch (error) {
      if (error.code !== "RUN_NOT_FOUND") throw error;
      if (record.cancelRequested) return { state: "cancelled" };
      if (recover && !record.started) {
        await this.startRecord(record);
        return this.statusRecord(this.data.executions[record.executionId], false);
      }
      return { state: "unknown", error: "Native run could not be found" };
    }
    if (record.cancelRequested && !["done", "error", "aborted"].includes(result.status)) {
      await this.runs.stop(record.runId, this.data.userId);
      result = await this.runs.status(record.runId, this.data.userId);
    }
    const state = { queued: "queued", running: "running", done: "succeeded", error: "failed", aborted: "cancelled" }[result.status] || "unknown";
    return { state: !terminal.has(state) && result.waiting?.length ? "waiting" : state, summary: result.summary || "", error: result.error || void 0, waiting: result.waiting || [] };
  }
  async cancel(payload) {
    const initial = this.record(payload);
    return this.exclusive(initial.executionId, async () => {
      await this.save((data) => {
        data.executions[initial.executionId].cancelRequested = true;
      });
      const record = this.data.executions[initial.executionId];
      try {
        await this.runs.stop(record.runId, this.data.userId);
      } catch (error) {
        if (error.code !== "RUN_NOT_FOUND") throw error;
      }
      const status = await this.statusRecord(record, false);
      return { ...status, settled: terminal.has(status.state) };
    });
  }
  async invoke({ adapter, version, op, payload = {} } = {}) {
    await this.ready;
    this.check();
    if (adapter !== "task-board" || version !== 1) throw new Error("Unsupported native adapter protocol");
    if (op === "context") return this.context();
    this.context();
    if (op === "launch") return this.launch(payload);
    if (op === "status") return this.exclusive(this.record(payload).executionId, () => this.statusRecord(this.record(payload)));
    if (op === "cancel") return this.cancel(payload);
    if (op === "list") return { known: true, items: await Promise.all(Object.values(this.data.executions).map(async (r) => ({ executionId: r.executionId, sessionId: r.sessionId, runId: r.runId, ...await this.exclusive(r.executionId, () => this.statusRecord(this.data.executions[r.executionId])) }))) };
    if (op === "createWorkspace") {
      const workspace = await this.project(payload.path);
      await this.save((data) => {
        data.projects[workspace.id] = workspace;
      });
      return workspace;
    }
    if (op === "openSession") {
      let sessionId;
      if (!payload.executionId && payload.sessionId === this.data.context.sessionId) {
        await this.runs.context(payload.sessionId, this.data.userId);
        sessionId = payload.sessionId;
      } else {
        const record = this.record(payload);
        await this.runs.status(record.runId, this.data.userId);
        sessionId = record.sessionId;
      }
      return new Promise((resolve, reject) => {
        const eventId = randomUUID();
        const timer = setTimeout(() => {
          this.events.delete(eventId);
          reject(new Error("The Forsion view did not acknowledge navigation"));
        }, this.navigationTimeoutMs);
        this.events.set(eventId, { eventId, type: "openSession", sessionId, timer, resolve, reject });
      });
    }
    throw new Error(`Unsupported native operation: ${op}`);
  }
  async pendingEvents(userId) {
    await this.ready;
    this.check(userId);
    return { events: [...this.events.values()].map(({ eventId, type, sessionId }) => ({ eventId, type, sessionId })) };
  }
  async acknowledge(userId, { eventId, error } = {}) {
    await this.ready;
    this.check(userId);
    const event = this.events.get(eventId);
    if (!event) throw new Error("Navigation request has expired");
    this.events.delete(eventId);
    clearTimeout(event.timer);
    if (error) event.reject(new Error(String(error).slice(0, 500)));
    else event.resolve({ opened: true });
    return { ok: true };
  }
  async listen() {
    await this.ready;
    this.check();
    if (this.server) return this.endpoint;
    this.server = createServer(async (req, res) => {
      const respond = (code, body) => {
        if (!res.destroyed) {
          res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store" });
          res.end(JSON.stringify(body));
        }
      };
      try {
        const header = req.headers["x-dsh2forsion-native"];
        if (req.headers.origin || typeof header !== "string" || header.length !== this.secret.length || !timingSafeEqual(Buffer.from(header), Buffer.from(this.secret))) return respond(401, { error: "unauthorized" });
        if (req.method !== "POST" || req.url !== "/invoke") return respond(404, { error: "not found" });
        const chunks = [];
        let bytes = 0;
        for await (const chunk of req) {
          bytes += chunk.length;
          if (bytes > 1 << 20) return respond(413, { error: "body too large" });
          chunks.push(chunk);
        }
        respond(200, await this.invoke(JSON.parse(Buffer.concat(chunks).toString("utf8"))));
      } catch (error) {
        respond(400, { error: message(error) });
      }
    });
    await new Promise((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(0, "127.0.0.1", resolve);
    });
    this.endpoint = { url: `http://127.0.0.1:${this.server.address().port}/invoke`, secret: this.secret };
    return this.endpoint;
  }
  async dispose() {
    this.disposed = true;
    for (const event of this.events.values()) {
      clearTimeout(event.timer);
      event.reject(new Error("Native view was disabled"));
    }
    this.events.clear();
    if (this.server) {
      this.server.closeAllConnections();
      await new Promise((resolve) => this.server.close(resolve));
    }
    await this.queue;
  }
};

// src/engine/models.mjs
import { createHash as createHash4 } from "node:crypto";
function counter(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`DSH returned invalid ${label} token usage`);
  return value;
}
function modelUsage(usage) {
  if (!usage) throw new Error("DSH model returned no authoritative token usage");
  const cached = usage.cacheReadTokens === void 0 ? void 0 : counter(usage.cacheReadTokens, "cached");
  const written = usage.cacheWriteTokens === void 0 ? void 0 : counter(usage.cacheWriteTokens, "cache write");
  return {
    prompt_tokens: counter(counter(usage.inputTokens, "input") + (cached ?? 0) + (written ?? 0), "aggregate prompt"),
    completion_tokens: counter(usage.outputTokens, "output"),
    ...cached === void 0 ? {} : { cached_tokens: cached },
    ...written === void 0 ? {} : { cache_write_tokens: written },
    ...usage.reasoningTokens === void 0 ? {} : { reasoning_tokens: counter(usage.reasoningTokens, "reasoning") }
  };
}
function createModelProvider({ sidecar, enabled = () => true, fetchImpl = fetch }) {
  const check = () => {
    if (!enabled() || sidecar.state !== "running" || !sidecar.base) throw new Error("DSH model source is not running");
  };
  return {
    id: "dsh",
    async listModels({ signal }) {
      check();
      const value = await sidecar.bridge("/models", { signal });
      check();
      return value.models;
    },
    async resolveModel(modelId, { signal }) {
      check();
      const value = await sidecar.bridge("/models/resolve", { method: "POST", body: JSON.stringify({ modelId }), signal });
      check();
      return value.model;
    },
    async stream(input) {
      check();
      input.signal.throwIfAborted();
      const { signal, onToken, onReasoning, onToolCallDelta, onResponseStart, context, cacheKey, ...wire } = input;
      if (typeof context?.sessionId === "string" && context.sessionId && typeof context.userId === "string" && context.userId) {
        wire.sessionKey = createHash4("sha256").update(JSON.stringify([context.userId, context.sessionId])).digest("hex");
        wire.cwd = typeof context.cwd === "string" ? context.cwd : null;
      }
      const response = await fetchImpl(`${sidecar.base}/forsion-bridge/models/stream`, { method: "POST", headers: { "content-type": "application/json", "x-dsh2forsion-secret": sidecar.secret }, body: JSON.stringify(wire), signal });
      if (!response.ok || !response.body) throw new Error(`DSH model transport failed (${response.status})`);
      onResponseStart?.();
      const blocks = /* @__PURE__ */ new Map();
      let usage, finish, buffer = "";
      const blockAt = (index, type) => {
        if (!blocks.has(index)) blocks.set(index, { type, text: "" });
        return blocks.get(index);
      };
      const consume = (event) => {
        if (event.type === "error") throw new Error(event.error || "DSH model inference failed");
        if (event.type !== "chunk" || !event.chunk) throw new Error("Invalid DSH model stream frame");
        const chunk = event.chunk;
        if (finish) throw new Error("DSH model sent data after its terminal chunk");
        if (chunk.type === "block-start") blockAt(chunk.index, chunk.blockType);
        else if (chunk.type === "text-delta" || chunk.type === "reasoning-delta") {
          const type = chunk.type === "text-delta" ? "text" : "reasoning";
          if (typeof chunk.text !== "string") throw new Error("Invalid DSH text delta");
          blockAt(chunk.index, type).text += chunk.text;
          if (type === "text") onToken?.(chunk.text);
          else onReasoning?.(chunk.text);
        } else if (chunk.type === "tool-call-delta") {
          if (typeof chunk.argumentsDelta !== "string") throw new Error("Invalid DSH tool-call delta");
          const block = blockAt(chunk.index, "tool-call");
          block.id = chunk.id || block.id;
          block.name = chunk.name || block.name;
          block.arguments = (block.arguments || "") + chunk.argumentsDelta;
          onToolCallDelta?.({ id: block.id || "", name: block.name || "", args: block.arguments, argsDelta: chunk.argumentsDelta, argsLen: block.arguments.length });
        } else if (chunk.type === "block-end") {
          if (!chunk.block || !["text", "reasoning", "tool-call"].includes(chunk.block.type)) throw new Error("DSH returned an unsupported model content block");
          blocks.set(chunk.index, { ...chunk.block });
        } else if (chunk.type === "usage") usage = modelUsage(chunk.usage);
        else if (chunk.type === "finish") {
          if (!["stop", "tool-calls", "max-tokens"].includes(chunk.reason?.kind)) throw new Error("DSH inference did not finish successfully");
          if (!usage) throw new Error("DSH inference is missing authoritative token usage");
          finish = chunk.reason.kind;
        } else throw new Error("Unknown DSH model chunk");
      };
      const decoder = new TextDecoder();
      for await (const part of response.body) {
        check();
        signal.throwIfAborted();
        buffer += decoder.decode(part, { stream: true });
        if (buffer.length > 8 * 1024 * 1024) throw new Error("DSH model frame is too large");
        let end;
        while ((end = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, end);
          buffer = buffer.slice(end + 1);
          if (line.trim()) consume(JSON.parse(line));
        }
      }
      buffer += decoder.decode();
      if (buffer.trim()) consume(JSON.parse(buffer));
      check();
      signal.throwIfAborted();
      if (!finish || !usage) throw new Error("DSH model stream ended before its complete result");
      const ordered = [...blocks.values()];
      const toolCalls = ordered.filter((b) => b.type === "tool-call").map((b) => {
        if (!b.id || !b.name || typeof b.arguments !== "string") throw new Error("DSH returned an incomplete tool call");
        return { id: b.id, type: "function", function: { name: b.name, arguments: b.arguments } };
      });
      if (wire.toolChoice === "none" && toolCalls.length) throw new Error("DSH returned tool calls despite toolChoice none");
      return {
        content: ordered.filter((b) => b.type === "text").map((b) => b.text).join(""),
        reasoning: ordered.filter((b) => b.type === "reasoning").map((b) => b.text).join(""),
        toolCalls,
        usage,
        finishReason: { stop: "stop", "tool-calls": "tool_calls", "max-tokens": "length" }[finish]
      };
    }
  };
}

// src/native-client/install.mjs
import { readFile as readFile6, writeFile as writeFile5, mkdir as mkdir6, rename as rename4, realpath as realpath3 } from "node:fs/promises";
import { join as join7, relative as relative2, isAbsolute as isAbsolute3 } from "node:path";
import { randomUUID as randomUUID3 } from "node:crypto";

// src/native-client/patches.mjs
import { createHash as createHash5 } from "node:crypto";
var SPEC = Object.freeze({
  package: "@linxin666/dsh-client-ui-task-board",
  version: "0.4.7",
  patchVersion: 2,
  host: "863c7a195748802c7a54e099efef14c73af98477ad83aa4a56b8d0c490c9e209",
  client: "364bad5afc8e770ed09bbfe1f320b7514229f85e050b62bf540a1949dbf62fe9",
  layout: "686fb83c91c8ff8d03c365bb666ef34dacc3dd110eb768deacbc7998b885c8c1",
  previousClient: Object.freeze(["d4ee137c2086d851d42c2c372c79860d4329e80fa0611a05d033c3b14f2359b6"])
});
var sha2562 = (value) => createHash5("sha256").update(value).digest("hex");
function replaceOne(source, before, after) {
  const first = source.indexOf(before);
  if (first < 0 || source.indexOf(before, first + before.length) >= 0) throw new Error(`Native compatibility anchor mismatch: ${before.slice(0, 85)}`);
  return source.slice(0, first) + after + source.slice(first + before.length);
}
function patchHost(source) {
  if (sha2562(source) !== SPEC.host) throw new Error("Unsupported Task Board host artifact (version/hash guard)");
  let out = replaceOne(
    source,
    "this.runner = new HostExecutionRunner(gateway, options.commandDispatcher, options.workspaceRegistry, void 0, options.ownerPeer);",
    "this.runner = options.runnerFactory ? options.runnerFactory({ promptText }) : new HostExecutionRunner(gateway, options.commandDispatcher, options.workspaceRegistry, void 0, options.ownerPeer);"
  );
  out = replaceOne(out, 'const inject = [\n	"systemPrompt",', 'const inject = [\n	"nativeExecutionAdapters",\n	"systemPrompt",');
  out = replaceOne(out, "const host = new TaskBoardHostService(ctx.typertGateway, {", 'const host = new TaskBoardHostService(ctx.typertGateway, {\nrunnerFactory: ctx.get("nativeExecutionAdapters")?.create("task-board"),');
  out = replaceOne(out, "this.runner.launch(opened.task, {", "this.runner.launch(opened.task, {\nexecutionId: opened.execution.id,");
  return "// Modified by DSH2Forsion: optional public native execution runner factory, 2026-10-31.\n" + out.replace(/^\/\/[#@]\s*sourceMappingURL=.*(?:\r?\n)?/gm, "");
}
function patchClient(source) {
  if (sha2562(source) !== SPEC.client) throw new Error("Unsupported Task Board client artifact (version/hash guard)");
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

// src/native-client/panels.mjs
import { readFile as readFile5, writeFile as writeFile4, mkdir as mkdir5, rename as rename3, realpath as realpath2 } from "node:fs/promises";
import { join as join6, relative, isAbsolute as isAbsolute2 } from "node:path";
import { randomUUID as randomUUID2 } from "node:crypto";
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
  if (!spec || sha2562(source) !== spec.sha256) throw new Error("Native panel original version/hash guard failed");
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
async function atomic(file, value) {
  const tmp = `${file}.forsion-${randomUUID2()}.tmp`;
  await writeFile4(tmp, value);
  await rename3(tmp, file);
}
async function prepareNativePanels({ profileDir: profileDir2, log = () => {
} }) {
  const prepared = [];
  for (const [panel, spec] of Object.entries(PANEL_PATCHES)) {
    let root;
    try {
      root = await realpath2(join6(profileDir2, "node_modules", ...spec.package.split("/")));
    } catch (e) {
      if (e.code === "ENOENT") continue;
      throw e;
    }
    const rel = relative(await realpath2(profileDir2), root);
    if (rel.startsWith("..") || isAbsolute2(rel)) throw new Error("Native panel package is outside the isolated profile");
    const pkgFile = join6(root, "package.json"), pkg = JSON.parse(await readFile5(pkgFile, "utf8"));
    if (pkg.name !== spec.package || pkg.version !== spec.version) throw new Error(`Unsupported ${panel} native panel version: ${pkg.version}`);
    if (!Array.isArray(pkg.dsh?.client?.inject)) throw new Error("Native panel client metadata changed");
    const backup = join6(root, ".forsion-native-original"), saved = join6(backup, "client.js"), target = join6(root, "lib/client.js");
    let original;
    try {
      original = await readFile5(saved, "utf8");
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
      original = await readFile5(target, "utf8");
    }
    const patched = patchPanel(panel, original), current = await readFile5(target, "utf8");
    if (sha2562(current) !== spec.sha256 && sha2562(current) !== sha2562(patched)) throw new Error(`Unknown ${panel} modifications; refusing native adaptation`);
    await mkdir5(backup, { recursive: true });
    await writeFile4(saved, original, { flag: "wx" }).catch((e) => {
      if (e.code !== "EEXIST") throw e;
    });
    await atomic(target, patched);
    if (!pkg.dsh.client.inject.includes("dsh2forsion-bridge")) pkg.dsh.client.inject.push("dsh2forsion-bridge");
    await atomic(pkgFile, JSON.stringify(pkg, null, 2) + "\n");
    const noticeFile = join6(root, "NOTICE"), existing = await readFile5(noticeFile, "utf8").catch((e) => {
      if (e.code === "ENOENT") return "";
      throw e;
    });
    const note = `DSH2Forsion native compatibility adapter (2026-10-31): modified lib/client.js for a public main-slot entry and verified native context. Original ${spec.package}@${spec.version} UI and source retained under Apache-2.0; see LICENSE. Original authors do not endorse this adaptation.`;
    if (!existing.includes(note)) await atomic(noticeFile, existing + (existing ? "\n" : "") + note + "\n");
    await atomic(join6(root, ".forsion-native-compat.json"), JSON.stringify({ package: spec.package, version: spec.version, patchVersion: 1, clientSha256: sha2562(patched) }, null, 2) + "\n");
    log(`native panel prepared: ${spec.package}@${spec.version}`);
    prepared.push({ panel, package: spec.package, version: spec.version });
  }
  return prepared;
}

// src/native-client/install.mjs
async function atomicFile(file, value) {
  const tmp = `${file}.forsion-${randomUUID3()}.tmp`;
  await writeFile5(tmp, value);
  await rename4(tmp, file);
}
async function prepareTaskBoard({ profileDir: profileDir2, log = () => {
} }) {
  const entry = join7(profileDir2, "node_modules", "@linxin666", "dsh-client-ui-task-board");
  let root;
  try {
    root = await realpath3(entry);
  } catch (error) {
    if (error.code === "ENOENT") return { patched: false };
    throw error;
  }
  const rel = relative2(await realpath3(profileDir2), root);
  if (rel.startsWith("..") || isAbsolute3(rel)) throw new Error("Native compatibility refuses a package outside the isolated profile");
  const pkgFile = join7(root, "package.json");
  const pkg = JSON.parse(await readFile6(pkgFile, "utf8"));
  if (pkg.name !== SPEC.package || pkg.version !== SPEC.version) throw new Error(`Task Board native adapter supports only ${SPEC.version}; found ${pkg.version}`);
  const injection = pkg.dsh?.client?.inject;
  if (!Array.isArray(injection)) throw new Error("Task Board client metadata changed");
  const backup = join7(root, ".forsion-native-original");
  await mkdir6(backup, { recursive: true });
  const plans = [];
  for (const [file, name, transform, expected] of [["lib/index.js", "host.js", patchHost, SPEC.host], ["lib/client.js", "client.js", patchClient, SPEC.client]]) {
    const target = join7(root, file), saved = join7(backup, name);
    let original;
    try {
      original = await readFile6(saved, "utf8");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      original = await readFile6(target, "utf8");
    }
    if (sha2562(original) !== expected) throw new Error(`Task Board ${file} is not the audited original artifact`);
    const patched = transform(original), current = await readFile6(target, "utf8");
    const previous = file === "lib/client.js" ? SPEC.previousClient : [];
    if (sha2562(current) !== expected && sha2562(current) !== sha2562(patched) && !previous.includes(sha2562(current))) throw new Error(`Task Board ${file} has unknown modifications; refusing native patch`);
    plans.push({ target, saved, original, patched });
  }
  for (const plan of plans) {
    await writeFile5(plan.saved, plan.original, { flag: "wx" }).catch((error) => {
      if (error.code !== "EEXIST") throw error;
    });
    await atomicFile(plan.target, plan.patched);
  }
  if (!injection.includes("dsh2forsion-bridge")) injection.push("dsh2forsion-bridge");
  await atomicFile(pkgFile, JSON.stringify(pkg, null, 2) + "\n");
  const noticeFile = join7(root, "NOTICE");
  const existing = await readFile6(noticeFile, "utf8").catch((error) => {
    if (error.code === "ENOENT") return "";
    throw error;
  });
  const notice = "DSH2Forsion native compatibility adapter (2026-10-31): modified lib/index.js and lib/client.js to add optional public execution/context adapters. Original Task Board remains Apache-2.0; see LICENSE. Original source and verified pre-patch artifacts are retained. No original authors endorse this adaptation.";
  if (!existing.includes(notice)) await atomicFile(noticeFile, existing + (existing ? "\n" : "") + notice + "\n");
  const record = { package: SPEC.package, version: SPEC.version, patchVersion: SPEC.patchVersion, files: Object.fromEntries(plans.map((p) => [relative2(root, p.target).replaceAll("\\", "/"), sha2562(p.patched)])) };
  await atomicFile(join7(root, ".forsion-native-compat.json"), JSON.stringify(record, null, 2) + "\n");
  log(`native adapter prepared: ${SPEC.package}@${SPEC.version}`);
  return { patched: true, root, ...record };
}
async function prepareNativeCompatibility(options) {
  const taskBoard = await prepareTaskBoard(options);
  const panels = await prepareNativePanels(options);
  return { ...taskBoard, panels };
}

// src/engine/index.mjs
var LOG_LIMIT2 = 300;
function readJson(file, fallback) {
  try {
    return JSON.parse(readFileSync3(file, "utf8"));
  } catch {
    return fallback;
  }
}
function createPlugin() {
  let state = null;
  return {
    async activate(ctx) {
      const paths = layout(ctx.paths.dataDir);
      const bridgeDir = join8(ctx.paths.pluginDir, "dsh-bridge");
      const compatDir = join8(ctx.paths.pluginDir, "compat");
      const store = ctx.sdk.pluginStore;
      const settings = () => ({ autoStart: true, exposeTools: true, downloadSource: "auto", ...store.getScopeSettings(PLUGIN_ID, "global") ?? {} });
      const logs = [];
      const log = (line) => {
        logs.push(`${(/* @__PURE__ */ new Date()).toISOString().slice(11, 19)} ${line}`);
        if (logs.length > LOG_LIMIT2) logs.splice(0, logs.length - LOG_LIMIT2);
      };
      const baseline = () => readJson(join8(compatDir, `baseline-${DSH_VERSION}.json`), { tools: [], sections: [] });
      const known = () => readJson(join8(compatDir, "known.json"), { plugins: {}, exemptions: [] });
      const sidecar = new Sidecar(paths, { onState: (s) => log(`sidecar ${s.state}${s.error ? `: ${s.error}` : ""}`) });
      const tools = new ToolBridge({
        sidecar,
        baseline,
        log,
        enabled: () => store.isPluginEnabledSync(PLUGIN_ID) && settings().exposeTools !== false
      });
      const job = { name: null, running: false, error: null, lines: [] };
      let disposed = false;
      let nativeError = null;
      const native = ctx.sdk.runs?.context ? new NativeExecution({ runs: ctx.sdk.runs, file: join8(paths.root, "native-executions.json"), enabled: () => !disposed && store.isPluginEnabledSync(PLUGIN_ID) }) : null;
      if (native) await native.ready;
      const offline = new Error("DSH2Forsion is turned off");
      let starting = null;
      const startNow = async () => {
        if (!runtimeInstalled(paths)) throw new Error("runtime not installed");
        await ensureProfile(paths, paths.home, { log });
        if (disposed) throw offline;
        if (await ensureBridge(paths, paths.home, bridgeDir, { log })) log("bridge installed / updated");
        if (disposed) throw offline;
        nativeError = null;
        try {
          await prepareNativeCompatibility({ profileDir: paths.profileDir, log });
        } catch (error) {
          nativeError = String(error.message ?? error);
          log(`native adapter unavailable: ${nativeError}`);
        }
        if (disposed) throw offline;
        await sidecar.start();
        if (disposed) {
          await sidecar.stop(1e3);
          throw offline;
        }
        if (native) await sidecar.bridge("/native/configure", { method: "POST", body: JSON.stringify(await native.listen()) });
        await plugins.saveLastGood().catch((error) => log(`save last good failed: ${error.message}`));
        await tools.refresh();
        if (disposed) return;
        tools.startPolling();
      };
      const start = () => {
        if (disposed) return Promise.reject(offline);
        starting ??= startNow().finally(() => {
          starting = null;
        });
        return starting;
      };
      const stop = async (graceMs) => {
        tools.stopPolling();
        await sidecar.stop(graceMs);
        await tools.refresh();
      };
      const restart = async () => {
        if (disposed) return;
        const wasRunning = sidecar.state === "running" || settings().autoStart !== false;
        await stop();
        if (wasRunning && !disposed) await start().catch((error) => log(`restart failed: ${error.message}`));
      };
      const plugins = new PluginManager(paths, { main: sidecar, bridgeDir, known, log, restart });
      const runJob = (name, fn) => {
        if (job.running) return false;
        Object.assign(job, { name, running: true, error: null, lines: [] });
        const jlog = (line) => {
          job.lines.push(line);
          if (job.lines.length > 200) job.lines.shift();
          log(line);
        };
        void fn(jlog).catch((error) => {
          job.error = String(error.message ?? error);
          log(`${name} failed: ${job.error}`);
        }).finally(() => {
          job.running = false;
        });
        return true;
      };
      const shutdown = async () => {
        disposed = true;
        await native?.dispose();
        await plugins.dispose();
        if (starting) await Promise.race([starting.catch(() => {
        }), new Promise((r) => setTimeout(r, 2e3))]);
        await stop(1500);
      };
      state = { shutdown };
      if (ctx.registerSkillProvider) ctx.registerSkillProvider({
        id: "dsh",
        list: async ({ signal, cwd } = {}) => {
          if (disposed || !store.isPluginEnabledSync(PLUGIN_ID) || sidecar.state !== "running") return [];
          const { skills } = await sidecar.bridge(`/skills${cwd ? `?cwd=${encodeURIComponent(cwd)}` : ""}`, { signal });
          return disposed ? [] : skills;
        }
      });
      if (ctx.registerModelProvider) ctx.registerModelProvider(createModelProvider({
        sidecar,
        enabled: () => !disposed && store.isPluginEnabledSync(PLUGIN_ID)
      }));
      ctx.registerPlugin({
        id: PLUGIN_ID,
        name: "DSH2Forsion",
        nameEn: "DSH2Forsion",
        description: "\u8BA9 Tangu \u4F7F\u7528 DeepSeek Harness \u63D2\u4EF6\u7684\u5DE5\u5177\u548C\u6280\u80FD\uFF0C\u5E76\u7BA1\u7406\u5176\u517C\u5BB9\u8FD0\u884C\u65F6\u3002\u539F\u751F\u6280\u80FD\u9700\u8981\u65B0\u7248\u5BBF\u4E3B\u652F\u6301\u3002",
        descriptionEn: "Use DeepSeek Harness plugin tools and skills in Tangu, with a managed compatibility runtime. Native skills require host support.",
        scopes: ["global"],
        defaultEnabled: true,
        settings: {
          fields: [
            { key: "autoStart", type: "toggle", label: "\u968F Forsion \u542F\u52A8 DSH", labelEn: "Start DSH with Forsion", default: true, help: "\u5173\u6389\u5219\u53EA\u5728\u6253\u5F00 DSH Space \u65F6\u542F\u52A8\uFF08\u5E38\u9A7B\u7EA6 400 MB \u5185\u5B58\uFF09\u3002", helpEn: "When off, DSH starts only when you open the DSH Space (it uses about 400 MB of memory while running)." },
            { key: "exposeTools", type: "toggle", label: "\u628A DSH \u63D2\u4EF6\u7684\u5DE5\u5177\u4EA4\u7ED9 Tangu", labelEn: "Offer DSH plugin tools to Tangu", default: true, help: "\u6BCF\u6B21\u8C03\u7528\u90FD\u4F1A\u5148\u95EE\u4F60\u3002", helpEn: "Tangu asks you before every call." },
            {
              key: "downloadSource",
              type: "select",
              label: "\u4E0B\u8F7D\u6E90",
              labelEn: "Download source",
              default: "auto",
              options: [
                { value: "auto", label: "\u81EA\u52A8\uFF08\u5B98\u65B9\u4F18\u5148\uFF0C\u5931\u8D25\u7528\u56FD\u5185\u955C\u50CF\uFF09", labelEn: "Automatic (official first, then the China mirror)" },
                { value: "official", label: "\u5B98\u65B9\uFF08nodejs.org / npmjs\uFF09", labelEn: "Official (nodejs.org / npmjs)" },
                { value: "mirror", label: "\u56FD\u5185\u955C\u50CF\uFF08npmmirror\uFF09", labelEn: "China mirror (npmmirror)" }
              ]
            }
          ]
        },
        toolProvider: {
          id: PROVIDER_ID,
          tools: () => tools.toolDefs(() => store.isPluginEnabledSync(PLUGIN_ID))
        },
        promptSection: () => tools.promptSection()
      });
      const send = (res, fn) => Promise.resolve().then(fn).then(
        (value) => res.json(value ?? { ok: true }),
        (error) => res.status(500).json({ error: String(error?.message ?? error) })
      );
      const status = () => ({
        dshVersion: DSH_VERSION,
        nodeVersion: NODE_VERSION,
        runtime: { installed: runtimeInstalled(paths), root: paths.root },
        job: { name: job.name, running: job.running, error: job.error, lines: job.lines.slice(-12) },
        sidecar: sidecar.snapshot(),
        tools: tools.schemas.map((t) => t.name),
        promptSections: tools.sections.map((s) => s.name),
        pluginJob: plugins.busy,
        settings: settings(),
        nativeSkills: { supported: typeof ctx.registerSkillProvider === "function" },
        nativeViews: { supported: Boolean(native), error: nativeError },
        nativeModels: { supported: typeof ctx.registerModelProvider === "function" }
      });
      ctx.registerScopedRoutes((router) => {
        router.post("/native/view", (req, res) => send(res, async () => {
          if (!native) throw new Error("Update Forsion to use native plugin views");
          if (sidecar.state !== "running") await start();
          if (nativeError) throw new Error(nativeError);
          await native.configure(req.user?.userId, req.body);
          const view = await sidecar.bridge("/native/view", { method: "POST", body: JSON.stringify({ panelKey: req.body?.panelKey || "task-board" }) });
          return { ...view, url: new URL(view.path, sidecar.base).href };
        }));
        router.get("/native/events", (req, res) => send(res, () => native?.pendingEvents(req.user?.userId) ?? { events: [] }));
        router.post("/native/ack", (req, res) => send(res, () => native?.acknowledge(req.user?.userId, req.body)));
        router.get("/status", (_req, res) => send(res, status));
        router.get("/logs", (_req, res) => send(res, () => ({ lines: [...logs], sidecar: sidecar.lines.slice(-200) })));
        router.post("/runtime/install", (_req, res) => send(res, () => {
          const started = runJob("install-runtime", (jlog) => installRuntime(paths, { source: settings().downloadSource, log: jlog }).then(() => start()));
          return { started };
        }));
        router.post("/sidecar/start", (_req, res) => send(res, async () => {
          await start();
          return status();
        }));
        router.post("/sidecar/stop", (_req, res) => send(res, async () => {
          await stop();
          return status();
        }));
        router.post("/sidecar/restart", (_req, res) => send(res, async () => {
          await stop();
          await start();
          return status();
        }));
        router.post("/space", (_req, res) => send(res, async () => {
          if (sidecar.state !== "running") await start();
          return { url: sidecar.spaceUrl() };
        }));
        router.post("/appearance", (req, res) => send(res, async () => {
          if (sidecar.state !== "running") return { ok: false, reason: "not running" };
          return sidecar.bridge("/appearance", { method: "POST", body: JSON.stringify({ theme: req.body?.theme, locale: req.body?.locale }) });
        }));
        router.get("/plugins", (_req, res) => send(res, async () => ({ plugins: await plugins.list(), known: known() })));
        router.post("/plugins/install", (req, res) => send(res, async () => {
          const r = await plugins.install(String(req.body?.spec ?? ""), { acceptRisk: req.body?.acceptRisk === true, confirm: req.body?.confirm === true, force: req.body?.force === true });
          await tools.refresh();
          return r;
        }));
        router.post("/plugins/remove", (req, res) => send(res, async () => {
          const r = await plugins.remove(String(req.body?.name ?? ""));
          await tools.refresh();
          return r;
        }));
        router.post("/plugins/restore-last-good", (_req, res) => send(res, async () => {
          const r = await plugins.restoreLastGood();
          await tools.refresh();
          return r;
        }));
        router.post("/plugins/rollback", (_req, res) => send(res, async () => {
          const r = await plugins.rollback();
          await tools.refresh();
          return r;
        }));
      });
      if (runtimeInstalled(paths) && settings().autoStart !== false) {
        void start().catch((error) => log(`auto start failed: ${error.message}`));
      } else if (!existsSync4(paths.root)) {
        log("runtime not installed yet");
      }
      ctx.log(`activated (DSH ${DSH_VERSION})`);
    },
    async deactivate() {
      const s = state;
      state = null;
      if (s) await s.shutdown().catch(() => {
      });
    }
  };
}
var index_default = createPlugin();
export {
  createPlugin,
  index_default as default
};
