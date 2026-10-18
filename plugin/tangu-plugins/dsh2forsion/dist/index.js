// DSH2Forsion engine half (built from src/engine by build.mjs; do not edit)

// src/engine/index.mjs
import { existsSync as existsSync4, readFileSync as readFileSync2 } from "node:fs";
import { join as join6 } from "node:path";

// src/engine/constants.mjs
var DSH_VERSION = "0.2.1-rc.2";
var NODE_VERSION = "v24.22.0";
var PNPM_VERSION = "11.28.6";
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
    npmCli: win ? join(nodeDir, "node_modules", "npm", "bin", "npm-cli.js") : join(nodeDir, "lib", "node_modules", "npm", "bin", "npm-cli.js"),
    pnpmBin: win ? join(nodeDir, "pnpm.cmd") : join(nodeDir, "bin", "pnpm"),
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
import { cp as cp2, mkdir as mkdir2, readFile as readFile2, rm as rm2, writeFile } from "node:fs/promises";
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
    binDir: paths.nodeBinDir,
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
async function ensureBridge(paths, home, bridgeDir, opts = {}) {
  const want = JSON.parse(await readFile(join2(bridgeDir, "package.json"), "utf8")).version;
  const have = installedVersion(home, BRIDGE_PACKAGE);
  if (have === want) return false;
  if (have) await dsh(paths, home, ["plugin", "--profile", PROFILE, "remove", BRIDGE_PACKAGE], opts);
  const r = await dsh(paths, home, ["plugin", "--profile", PROFILE, "add", "--ignore-scripts", `file:${bridgeDir}`], opts);
  if (r.code !== 0) throw new Error(`bridge install failed: ${r.out.slice(-600)}`);
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
    if (e === LAST_GOOD) continue;
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
        binDir: this.paths.nodeBinDir,
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
  /** 有界停止：先 SIGTERM，等不到再 SIGKILL。 */
  stop(graceMs = 4e3) {
    const child = this.child;
    if (!child) {
      if (this.state !== "failed") this.setState("stopped");
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const kill = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
        }
      }, graceMs);
      child.once("exit", () => {
        clearTimeout(kill);
        this.setState("stopped");
        resolve();
      });
      try {
        child.kill("SIGTERM");
      } catch {
        clearTimeout(kill);
        resolve();
      }
    });
  }
  /** 给桥发请求（带密钥）。 */
  async bridge(path, init = {}) {
    if (this.state !== "running" || !this.base) throw new Error("DSH is not running");
    const res = await fetch(`${this.base}/forsion-bridge${path}`, {
      ...init,
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
      const login = await fetch(`${this.base}/?token=${this.token}`, { redirect: "manual" });
      this.cookie = (login.headers.get("set-cookie") ?? "").split(";")[0];
      this.cookieFor = this.base;
    }
    const res = await fetch(`${this.base}/api/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: this.base, cookie: this.cookie },
      body: JSON.stringify({ type: "client-request", rpcId: `d2f-${Date.now()}`, method, payload: { args } })
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
  }
  /** 插件操作一次只做一件。 */
  exclusive(label, fn) {
    const job = this.queue.then(async () => {
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
    const probe = new Sidecar(this.paths, { home: trial, label: "trial" });
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
    return this.exclusive(`remove ${name}`, async () => {
      await this.snapshot(`before remove ${name}`);
      const r = await dsh(this.paths, this.paths.home, ["plugin", "--profile", PROFILE, "remove", name], { log: this.deps.log });
      if (r.code !== 0) return { status: "failed", name, message: tail(r.out, 8) };
      await this.deps.restart();
      return { status: "removed", name };
    });
  }
  /** 回到最近一次改动之前；用掉的快照删掉，再回滚就往更早走。 */
  rollback() {
    return this.exclusive("rollback", async () => {
      const dir = await newestBackup(this.paths.backups);
      if (!dir) return { status: "nothing-to-roll-back" };
      await this.restore(dir);
      await rm2(dir, { recursive: true, force: true });
      await this.deps.restart();
      return { status: "rolled-back", to: dir };
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
  async snapshot(label) {
    const stamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-");
    const dir = join4(this.paths.backups, stamp);
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
  }
};

// src/engine/runtime.mjs
import { createHash } from "node:crypto";
import { createReadStream, existsSync as existsSync3 } from "node:fs";
import { mkdir as mkdir3, readFile as readFile3, rm as rm3, writeFile as writeFile2, rename } from "node:fs/promises";
import { join as join5 } from "node:path";
function runtimeInstalled(paths) {
  return existsSync3(paths.runtimeMarker) && existsSync3(paths.nodeBin) && existsSync3(paths.dshBin);
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
      await download(`${base}/SHASUMS256.txt`, join5(tmp, "SHASUMS256.txt"), signal);
      const sums = await readFile3(join5(tmp, "SHASUMS256.txt"), "utf8");
      const expected = sums.split("\n").map((l) => l.trim().split(/\s+/)).find(([, f]) => f === file)?.[0];
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
  const env = childEnv(process.env, {
    binDir: paths.nodeBinDir,
    extra: { npm_config_cache: join5(paths.cache, "npm"), npm_config_registry: registry, npm_config_update_notifier: "false", npm_config_fund: "false", npm_config_audit: "false" }
  });
  return run(paths.nodeBin, [paths.npmCli, ...args], { cwd, env, timeoutMs: 12e5, onLine: log, signal });
}
async function installDsh(paths, { source, log, signal }) {
  await mkdir3(paths.runtimeDir, { recursive: true });
  const pkg = join5(paths.runtimeDir, "package.json");
  if (!existsSync3(pkg)) await writeFile2(pkg, '{ "name": "dsh2forsion-runtime", "private": true }\n');
  let lastError;
  for (const which of sources(source)) {
    const registry = NPM_REGISTRIES[which];
    log(`npm install @deepseek-ai/dsh@${DSH_VERSION} (${which})`);
    const r = await npm(paths, ["install", "--ignore-scripts", "--save-exact", "--no-audit", "--no-fund", `@deepseek-ai/dsh@${DSH_VERSION}`], { registry, log, signal, cwd: paths.runtimeDir });
    if (r.code !== 0) {
      lastError = new Error(`npm install failed (${which}): ${tail(r.out, 5)}`);
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
    log(`npm install -g pnpm@${PNPM_VERSION}`);
    const p = await npm(paths, ["install", "-g", "--prefix", paths.nodeDir, "--no-audit", "--no-fund", `pnpm@${PNPM_VERSION}`], { registry, log, signal, cwd: paths.runtimeDir });
    if (p.code !== 0) {
      lastError = new Error(`pnpm install failed: ${tail(p.out, 5)}`);
      log(lastError.message);
      continue;
    }
    return registry;
  }
  throw lastError ?? new Error("runtime install failed");
}
async function installRuntime(paths, { source = "auto", log = () => {
}, signal } = {}) {
  await mkdir3(paths.root, { recursive: true });
  await installNode(paths, { source, log, signal });
  const registry = await installDsh(paths, { source, log, signal });
  await writeFile2(paths.runtimeMarker, JSON.stringify({ dsh: DSH_VERSION, node: NODE_VERSION, pnpm: PNPM_VERSION, registry, at: (/* @__PURE__ */ new Date()).toISOString() }) + "\n");
  await rm3(join5(paths.cache, "npm"), { recursive: true, force: true }).catch(() => {
  });
  log("runtime ready");
}

// src/engine/tools.mjs
var tanguToolName = (name, taken = /* @__PURE__ */ new Set()) => {
  const base = `dsh__${name}`.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) {
    const n = `${base.slice(0, 60)}_${i}`;
    if (!taken.has(n)) return n;
  }
};
function renderResult(result) {
  const text = (result?.content ?? []).filter((c) => c?.type === "text").map((c) => c.text).join("\n");
  if (!result?.isError) return text || "(no text output)";
  const message = text || result?.error?.message || "DSH tool failed";
  return message.startsWith("Error:") ? message : `Error: ${message}`;
}
function thirdPartySections(sections, baseline) {
  const skip = new Set(baseline.sections ?? []);
  return sections.filter((s) => !skip.has(s.name) && typeof s.text === "string" && s.text.trim()).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
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
  /** @param {{ sidecar: import('./sidecar.mjs').Sidecar, baseline: () => any, enabled: () => boolean, log: (l: string) => void }} deps */
  constructor(deps) {
    this.deps = deps;
    this.schemas = [];
    this.sections = [];
    this.timer = null;
  }
  async refresh() {
    const { sidecar, baseline } = this.deps;
    if (sidecar.state !== "running") {
      this.schemas = [];
      this.sections = [];
      return;
    }
    try {
      const b = baseline();
      const skip = new Set(b.tools ?? []);
      const { tools } = await sidecar.bridge("/tools");
      this.schemas = (tools ?? []).filter((t) => !skip.has(t.name));
      const { sections } = await sidecar.bridge("/prompt");
      this.sections = thirdPartySections(sections ?? [], b);
    } catch (error) {
      this.deps.log(`tool refresh failed: ${error.message}`);
    }
  }
  startPolling(ms = 3e4) {
    this.stopPolling();
    this.timer = setInterval(() => {
      void this.refresh();
    }, ms);
    this.timer.unref?.();
  }
  stopPolling() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
  /** ToolProvider.tools()：绝不能抛（一个 provider 抛错会拖垮所有 run 的工具装配）。 */
  toolDefs(isEnabledFor) {
    try {
      if (!this.deps.enabled()) return [];
      const taken = /* @__PURE__ */ new Set();
      return this.schemas.map((t) => {
        const name = tanguToolName(t.name, taken);
        taken.add(name);
        return {
          name,
          isEnabledFor,
          definition: {
            type: "function",
            function: {
              name,
              description: `${t.description ?? ""}
(DeepSeek Harness plugin tool. It runs in the DSH sidecar, outside Tangu's file policy and checkpoints.)`.trim(),
              parameters: t.parameters ?? { type: "object", properties: {} }
            }
          },
          capabilities: { sideEffect: "unknown", approval: "always", automationSafe: false },
          execute: (args, toolCtx) => this.execute(t.name, args, toolCtx)
        };
      });
    } catch {
      return [];
    }
  }
  async execute(dshName, args, toolCtx) {
    const { sidecar } = this.deps;
    if (sidecar.state !== "running") return "Error: the DeepSeek Harness runtime is not running. Open the DSH Space in Forsion to start it.";
    try {
      const body = { name: dshName, arguments: args ?? {}, approved: true, cwd: toolCtx?.cwd };
      const { result } = await sidecar.bridge("/tools/execute", { method: "POST", body: JSON.stringify(body), signal: toolCtx?.signal });
      return renderResult(result);
    } catch (error) {
      return `Error: DSH2Forsion bridge call failed: ${error.message}`;
    }
  }
  promptSection() {
    try {
      return this.deps.enabled() ? promptText(this.sections) : "";
    } catch {
      return "";
    }
  }
};
var PROVIDER_ID = `plugin:${PLUGIN_ID}`;

// src/engine/index.mjs
var LOG_LIMIT2 = 300;
function readJson(file, fallback) {
  try {
    return JSON.parse(readFileSync2(file, "utf8"));
  } catch {
    return fallback;
  }
}
function createPlugin() {
  let state = null;
  return {
    async activate(ctx) {
      const paths = layout(ctx.paths.dataDir);
      const bridgeDir = join6(ctx.paths.pluginDir, "dsh-bridge");
      const compatDir = join6(ctx.paths.pluginDir, "compat");
      const store = ctx.sdk.pluginStore;
      const settings = () => ({ autoStart: true, exposeTools: true, downloadSource: "auto", ...store.getScopeSettings(PLUGIN_ID, "global") ?? {} });
      const logs = [];
      const log = (line) => {
        logs.push(`${(/* @__PURE__ */ new Date()).toISOString().slice(11, 19)} ${line}`);
        if (logs.length > LOG_LIMIT2) logs.splice(0, logs.length - LOG_LIMIT2);
      };
      const baseline = () => readJson(join6(compatDir, `baseline-${DSH_VERSION}.json`), { tools: [], sections: [] });
      const known = () => readJson(join6(compatDir, "known.json"), { plugins: {}, exemptions: [] });
      const sidecar = new Sidecar(paths, { onState: (s) => log(`sidecar ${s.state}${s.error ? `: ${s.error}` : ""}`) });
      const tools = new ToolBridge({
        sidecar,
        baseline,
        log,
        enabled: () => store.isPluginEnabledSync(PLUGIN_ID) && settings().exposeTools !== false
      });
      const job = { name: null, running: false, error: null, lines: [] };
      const start = async () => {
        if (!runtimeInstalled(paths)) throw new Error("runtime not installed");
        await ensureProfile(paths, paths.home, { log });
        if (await ensureBridge(paths, paths.home, bridgeDir, { log })) log("bridge installed / updated");
        await sidecar.start();
        await plugins.saveLastGood().catch((error) => log(`save last good failed: ${error.message}`));
        await tools.refresh();
        tools.startPolling();
      };
      const stop = async () => {
        tools.stopPolling();
        await sidecar.stop();
        await tools.refresh();
      };
      const restart = async () => {
        const wasRunning = sidecar.state === "running" || settings().autoStart !== false;
        await stop();
        if (wasRunning) await start().catch((error) => log(`restart failed: ${error.message}`));
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
      state = { sidecar, tools, plugins, stop };
      ctx.registerPlugin({
        id: PLUGIN_ID,
        name: "DSH2Forsion",
        nameEn: "DSH2Forsion",
        description: "\u5728 Forsion \u91CC\u8FD0\u884C DeepSeek Harness \u63D2\u4EF6\uFF1A\u7BA1\u7406 DSH \u8FD0\u884C\u65F6\uFF0C\u5E76\u628A DSH \u63D2\u4EF6\u7684\u5DE5\u5177\u4EA4\u7ED9 Tangu\u3002",
        descriptionEn: "Run DeepSeek Harness plugins in Forsion: manages the DSH runtime and offers DSH plugin tools to Tangu.",
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
        settings: settings()
      });
      ctx.registerScopedRoutes((router) => {
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
      if (s) await s.stop().catch(() => {
      });
    }
  };
}
var index_default = createPlugin();
export {
  createPlugin,
  index_default as default
};
