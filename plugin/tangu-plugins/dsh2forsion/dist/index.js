// DSH2Forsion engine half (built from src/engine by build.mjs; do not edit)

// src/engine/index.mjs
import { existsSync as existsSync6, readFileSync as readFileSync4 } from "node:fs";
import { join as join8 } from "node:path";

// src/engine/constants.mjs
var DSH_VERSION = "0.2.2-rc.3";
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
var ENGINE_ID = "dsh";
var FUSION_MARKER = ".dsh2forsion-fusion.json";
var FUSION_BUNDLES = ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "@deepseek-ai/dsh-acp-app"];
var FUSION_REENABLE = [
  "agent-instructions",
  "tool-web",
  "tool-todo",
  "tool-workflow",
  "workflow-ptc",
  "command-goal",
  "plan-mode",
  "command-compact",
  "tool-goal",
  "compaction-basic",
  "tool-result-pruner",
  "skill-filesystem",
  "tool-skill",
  "tool-subagent-control",
  "tool-subagent",
  "tool-subagent-fork",
  "tool-bash",
  "tool-jobs",
  "tool-fs",
  "tool-fs-search"
];
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

// src/engine/channel.mjs
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
var CHANNEL_URL = "https://github.com/Changan-Su/DSH2Forsion/releases/download/dsh-channel/runtime-manifest.json";
var PLUGIN_VERSION = "0.3.0";
var VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
var sha256 = (text) => createHash("sha256").update(text).digest("hex");
function compareVersions(a, b) {
  const [ma, pa = ""] = String(a).split("-", 2);
  const [mb, pb = ""] = String(b).split("-", 2);
  const na = ma.split(".").map(Number), nb = mb.split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((na[i] ?? 0) !== (nb[i] ?? 0)) return (na[i] ?? 0) - (nb[i] ?? 0);
  if (pa === pb) return 0;
  if (!pa) return 1;
  if (!pb) return -1;
  const xa = pa.split("."), xb = pb.split(".");
  for (let i = 0; i < Math.max(xa.length, xb.length); i++) {
    if (xa[i] === void 0) return -1;
    if (xb[i] === void 0) return 1;
    const da = /^\d+$/.test(xa[i]), db = /^\d+$/.test(xb[i]);
    if (da && db && Number(xa[i]) !== Number(xb[i])) return Number(xa[i]) - Number(xb[i]);
    if (da !== db) return da ? -1 : 1;
    if (xa[i] !== xb[i]) return xa[i] < xb[i] ? -1 : 1;
  }
  return 0;
}
function validateManifest(m, { pluginVersion = PLUGIN_VERSION } = {}) {
  if (!m || typeof m !== "object" || m.schema !== 1) throw new Error("Unknown runtime manifest format");
  if (!VERSION_RE.test(String(m.dsh))) throw new Error("Runtime manifest names no valid DSH version");
  if (m.node !== NODE_VERSION || m.pnpm !== PNPM_VERSION) throw new Error(`Runtime manifest needs Node ${m.node} / pnpm ${m.pnpm}; this DSH2Forsion ships Node ${NODE_VERSION} / pnpm ${PNPM_VERSION}`);
  if (typeof m.files?.packageJson !== "string" || typeof m.files?.lock !== "string") throw new Error("Runtime manifest has no runtime files");
  if (sha256(m.files.packageJson) !== m.sha256?.packageJson || sha256(m.files.lock) !== m.sha256?.lock) throw new Error("Runtime manifest checksum mismatch");
  const pkg = JSON.parse(m.files.packageJson);
  if (pkg?.dependencies?.["@deepseek-ai/dsh"] !== m.dsh) throw new Error("Runtime manifest files do not pin the DSH version it names");
  if (m.plugin?.min && compareVersions(pluginVersion, m.plugin.min) < 0) throw new Error(`DSH ${m.dsh} needs DSH2Forsion ${m.plugin.min} or newer`);
  if (m.selfCheck?.ok !== true) throw new Error(`DSH ${m.dsh} did not pass the fusion self-check`);
  return m;
}
var channelDir = (root) => join(root, "channel");
var activeFile = (root) => join(root, "active-runtime.json");
function activeVersion(root, log = () => {
}) {
  const file = activeFile(root);
  if (!existsSync(file)) return DSH_VERSION;
  try {
    const v = JSON.parse(readFileSync(file, "utf8")).dsh;
    if (v === DSH_VERSION || verifiedSync(root).includes(v)) return v;
    log(`active runtime ${v} is not verified for this DSH2Forsion; using ${DSH_VERSION}`);
  } catch (error) {
    log(`cannot read active-runtime.json (${error.message}); using ${DSH_VERSION}`);
  }
  return DSH_VERSION;
}
async function setActiveVersion(root, version) {
  await mkdir(root, { recursive: true });
  await writeFile(activeFile(root), JSON.stringify({ dsh: version, at: (/* @__PURE__ */ new Date()).toISOString() }) + "\n");
}
function verifiedSync(root) {
  const out = [DSH_VERSION];
  try {
    for (const f of readdirSync(channelDir(root))) {
      const m = /^manifest-(.+)\.json$/.exec(f);
      if (!m) continue;
      try {
        validateManifest(JSON.parse(readFileSync(join(channelDir(root), f), "utf8")));
        out.push(m[1]);
      } catch {
      }
    }
  } catch {
  }
  return [...new Set(out)];
}
function verifiedVersions(root) {
  return verifiedSync(root);
}
async function installedVersions(root) {
  let names = [];
  try {
    names = await readdir(join(root, "runtime"));
  } catch {
    return [];
  }
  const out = [];
  for (const v of names) {
    try {
      const marker = JSON.parse(await readFile(join(root, "runtime", v, ".dsh2forsion-ready"), "utf8"));
      if (marker.dsh === v && marker.node === NODE_VERSION && marker.pnpm === PNPM_VERSION) out.push(v);
    } catch {
    }
  }
  return out.sort(compareVersions);
}
async function previousVersion(root, active) {
  const verified = new Set(verifiedVersions(root));
  const older = (await installedVersions(root)).filter((v) => verified.has(v) && compareVersions(v, active) < 0);
  return older.at(-1) ?? null;
}
async function storedManifest(root, version) {
  if (version === DSH_VERSION) return null;
  return validateManifest(JSON.parse(await readFile(join(channelDir(root), `manifest-${version}.json`), "utf8")));
}
async function fetchChannel(root, { url = CHANNEL_URL, signal } = {}) {
  const res = await fetch(url, { signal: signal ?? AbortSignal.timeout(2e4), redirect: "follow" });
  if (res.status === 404) return { published: false };
  if (!res.ok) throw new Error(`runtime manifest \u2192 ${res.status}`);
  const m = validateManifest(await res.json());
  await mkdir(channelDir(root), { recursive: true });
  await writeFile(join(channelDir(root), `manifest-${m.dsh}.json`), JSON.stringify(m) + "\n");
  return { published: true, manifest: m };
}

// src/engine/fusion.mjs
import { existsSync as existsSync2 } from "node:fs";
import { mkdir as mkdir2, readFile as readFile2, writeFile as writeFile2 } from "node:fs/promises";
import { join as join2 } from "node:path";
var FUSION_PATCH_VERSION = 1;
function fusionPatch() {
  return `# dsh2forsion-fusion: ${FUSION_PATCH_VERSION}
# DSH2Forsion \u5EFA\u7684\u7EC4\u5408\uFF1A\u540C\u4E00\u4E2A\u8FDB\u7A0B\u91CC\u65E2\u5F00\u7F51\u9875\u754C\u9762\uFF08Forsion \u7684 DSH \u5DE5\u4F5C\u53F0\uFF09\uFF0C\u53C8\u5F00\u5BF9\u8BDD\u5165\u53E3\uFF08Forsion \u7684\u5BF9\u8BDD\u8FDE\u5B83\uFF09\u3002
# \u4E0D\u5F39\u6D4F\u89C8\u5668\u3001\u53EA\u542C\u672C\u673A\u968F\u673A\u7AEF\u53E3\u3002\u4E0B\u9762\u51E0\u884C\u53EF\u4EE5\u5728 DSH \u81EA\u5DF1\u7684\u63D2\u4EF6\u9875\u91CC\u5F00\u5173\uFF1B\u672C\u6587\u4EF6\u53EA\u5728\u6CA1\u6709\u65F6\u7531 DSH2Forsion \u5199\u4E00\u6B21\u3002
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
# \u7F51\u9875\u754C\u9762\u90A3\u4EFD\u63A5\u7EBF\u628A\u8FD9\u4E9B\u5173\u4E86\u3001\u6539\u7531\u300C\u9884\u8BBE\u300D\u6309\u4F1A\u8BDD\u6302\uFF1B\u5BF9\u8BDD\u5165\u53E3\u5EFA\u7684\u4F1A\u8BDD\u4E0D\u6302\u9884\u8BBE\uFF0C\u6240\u4EE5\u5728\u5168\u5C40\u91CD\u65B0\u6253\u5F00
${FUSION_REENABLE.map((id) => `- id: ${id}
  disabled: false
`).join("")}`;
}
var ForeignProfileError = class extends Error {
};
async function ensureFusedProfile(paths, { log = () => {
} } = {}) {
  const dir = paths.profileDir;
  const marker = join2(dir, FUSION_MARKER);
  const created = !existsSync2(dir);
  if (!created && !existsSync2(marker)) {
    throw new ForeignProfileError(`A DSH profile named "${PROFILE}" already exists in ${paths.home} and was not created by DSH2Forsion. Rename it in DSH, then try again.`);
  }
  await mkdir2(dir, { recursive: true });
  if (created) {
    await writeFile2(marker, JSON.stringify({ createdBy: "dsh2forsion", patch: FUSION_PATCH_VERSION, at: (/* @__PURE__ */ new Date()).toISOString() }, null, 2) + "\n");
    log(`created DSH profile "${PROFILE}" in ${paths.home}`);
  }
  const pkgFile = join2(dir, "package.json");
  let pkg = {};
  if (existsSync2(pkgFile)) {
    try {
      pkg = JSON.parse(await readFile2(pkgFile, "utf8"));
    } catch (error) {
      throw new Error(`Cannot read ${pkgFile}: ${error.message}. Fix or remove the file, then try again.`);
    }
  }
  const bundles = Array.isArray(pkg?.dsh?.profile?.bundles) ? pkg.dsh.profile.bundles : [];
  if (!FUSION_BUNDLES.every((b) => bundles.includes(b))) {
    const next = {
      name: pkg.name ?? `dsh-profile-${PROFILE}`,
      private: true,
      ...pkg,
      dsh: { ...pkg.dsh ?? {}, profile: { ...pkg.dsh?.profile ?? {}, bundles: [...FUSION_BUNDLES, ...bundles.filter((b) => !FUSION_BUNDLES.includes(b))] } }
    };
    await writeFile2(pkgFile, JSON.stringify(next, null, 2) + "\n");
  }
  const patchFile = join2(dir, "cordis.patch.yml");
  if (!existsSync2(patchFile)) await writeFile2(patchFile, fusionPatch());
  return { created, path: dir };
}

// src/engine/layout.mjs
import { homedir } from "node:os";
import { join as join3 } from "node:path";
function nodePlatform(platform = process.platform, arch = process.arch) {
  const a = arch === "arm64" ? "arm64" : arch === "x64" ? "x64" : null;
  if (!a) return null;
  if (platform === "darwin") return { id: `darwin-${a}`, ext: "tar.gz" };
  if (platform === "linux") return { id: `linux-${a}`, ext: "tar.gz" };
  if (platform === "win32") return { id: `win-${a}`, ext: "zip" };
  return null;
}
function resolveDshHome(env = process.env) {
  const own = typeof env.DSH_HOME === "string" ? env.DSH_HOME.trim() : "";
  if (own) return own;
  const home = typeof env.HOME === "string" && env.HOME.trim() || typeof env.USERPROFILE === "string" && env.USERPROFILE.trim() || homedir();
  return join3(home, ".dsh");
}
function layout(root, platform = process.platform, { dshHome = join3(root, "home"), dshVersion = DSH_VERSION } = {}) {
  const win = platform === "win32";
  const nodeDir = join3(root, "node", NODE_VERSION);
  const runtimeDir = join3(root, "runtime", dshVersion);
  const home = dshHome;
  return {
    root,
    dshVersion,
    nodeDir,
    nodeBin: win ? join3(nodeDir, "node.exe") : join3(nodeDir, "bin", "node"),
    nodeBinDir: win ? nodeDir : join3(nodeDir, "bin"),
    // Locked pnpm wins over a leftover global copy; old v0.1 installations still fall back to it.
    runtimePath: [join3(runtimeDir, "node_modules", ".bin"), win ? nodeDir : join3(nodeDir, "bin")].join(win ? ";" : ":"),
    npmCli: win ? join3(nodeDir, "node_modules", "npm", "bin", "npm-cli.js") : join3(nodeDir, "lib", "node_modules", "npm", "bin", "npm-cli.js"),
    pnpmBin: join3(runtimeDir, "node_modules", ".bin", win ? "pnpm.cmd" : "pnpm"),
    legacyPnpmBin: win ? join3(nodeDir, "pnpm.cmd") : join3(nodeDir, "bin", "pnpm"),
    runtimeDir,
    dshBin: join3(runtimeDir, "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js"),
    home,
    profileDir: join3(home, "profiles", PROFILE),
    trialHome: join3(root, "trial"),
    backups: join3(root, "backups"),
    cache: join3(root, "cache"),
    runtimeMarker: join3(runtimeDir, ".dsh2forsion-ready")
  };
}

// src/engine/plugins.mjs
import { existsSync as existsSync4 } from "node:fs";
import { cp as cp2, mkdir as mkdir4, readFile as readFile4, readdir as readdir3, rm as rm2, writeFile as writeFile4 } from "node:fs/promises";
import { join as join6 } from "node:path";

// src/engine/profile.mjs
import { existsSync as existsSync3, readFileSync as readFileSync2 } from "node:fs";
import { cp, mkdir as mkdir3, readdir as readdir2, readFile as readFile3, rm, stat, writeFile as writeFile3 } from "node:fs/promises";
import { isAbsolute, join as join4, relative, resolve } from "node:path";

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
  "DBUS_SESSION_BUS_ADDRESS",
  // 只给测试:把桥的审批那一环挂到对不上的事件名上,看自检整块退回工作台提示(tests/check-approvals.mjs)
  "DSH2FORSION_APPROVAL_EVENT"
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
  return new Promise((resolve2, reject) => {
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
      resolve2({ code, out, timedOut });
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
    extra: { DSH_HOME: home, npm_config_store_dir: join4(paths.cache, "pnpm-store"), npm_config_update_notifier: "false" }
  });
  return run(paths.nodeBin, [paths.dshBin, ...args], { cwd: home, env, timeoutMs, onLine: log, signal });
}
function profileDir(home) {
  return join4(home, "profiles", PROFILE);
}
function installedVersion(home, name) {
  try {
    return JSON.parse(readFileSync2(join4(profileDir(home), "node_modules", ...name.split("/"), "package.json"), "utf8")).version;
  } catch {
    return null;
  }
}
async function bridgeFilesMatch(source, installed) {
  for (const entry of await readdir2(source, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const from = join4(source, entry.name), to = join4(installed, entry.name);
    if (entry.isDirectory()) {
      if (!await bridgeFilesMatch(from, to)) return false;
    } else if (entry.isFile()) {
      let actual;
      try {
        actual = await readFile3(to);
      } catch (error) {
        if (error.code === "ENOENT") return false;
        throw error;
      }
      if (!(await readFile3(from)).equals(actual)) return false;
    }
  }
  return true;
}
async function ensureBridge(paths, home, bridgeDir, opts = {}) {
  const want = JSON.parse(await readFile3(join4(bridgeDir, "package.json"), "utf8")).version;
  const have = installedVersion(home, BRIDGE_PACKAGE);
  const installed = join4(profileDir(home), "node_modules", BRIDGE_PACKAGE);
  if (have === want && await bridgeFilesMatch(bridgeDir, installed)) return false;
  if (have) await dsh(paths, home, ["plugin", "--profile", PROFILE, "remove", BRIDGE_PACKAGE], opts);
  const r = await dsh(paths, home, ["plugin", "--profile", PROFILE, "add", "--ignore-scripts", `file:${bridgeDir}`], opts);
  if (r.code !== 0) throw new Error(`bridge install failed: ${r.out.slice(-600)}`);
  if (!await bridgeFilesMatch(bridgeDir, installed)) throw new Error("Installed bridge differs from the shipped build");
  return true;
}
async function userPlugins(home) {
  try {
    const pkg = JSON.parse(await readFile3(join4(profileDir(home), "package.json"), "utf8"));
    return Object.entries(pkg.dependencies ?? {}).filter(([name]) => name !== BRIDGE_PACKAGE).map(([name, spec]) => ({ name, spec, version: installedVersion(home, name) }));
  } catch {
    return [];
  }
}
async function shadowedCorePackages(paths, home) {
  const scope = join4(profileDir(home), "node_modules", "@deepseek-ai");
  let names = [];
  try {
    names = await readdir2(scope);
  } catch {
    return [];
  }
  const out = [];
  for (const n of names) {
    let v;
    try {
      v = JSON.parse(await readFile3(join4(scope, n, "package.json"), "utf8")).version;
    } catch {
      continue;
    }
    let runtimeV = null;
    try {
      runtimeV = JSON.parse(await readFile3(join4(paths.runtimeDir, "node_modules", "@deepseek-ai", n, "package.json"), "utf8")).version;
    } catch {
    }
    if (runtimeV && runtimeV !== v) out.push({ name: `@deepseek-ai/${n}`, version: v, runtime: runtimeV });
  }
  return out;
}
var LAST_GOOD = "last-good";
var PROFILE_FILES = ["package.json", "cordis.patch.yml", "cordis.yml", "pnpm-workspace.yaml", "pnpm-lock.yaml", "compatibility.json"];
async function copyProfileFiles(fromDir, toDir) {
  await mkdir3(toDir, { recursive: true });
  for (const f of PROFILE_FILES) {
    const src = join4(fromDir, f);
    if (existsSync3(src)) await cp(src, join4(toDir, f));
    else await rm(join4(toDir, f), { force: true });
  }
}
function relocateLock(text, fromDir, toDir) {
  return String(text).replace(/(file:|directory: )(\.\.?\/[^\s(),}'"]*)/g, (_, prefix, rel) => {
    const abs = resolve(fromDir, rel);
    let next = relative(toDir, abs).split("\\").join("/");
    if (!next.startsWith(".") && !isAbsolute(next)) next = `./${next}`;
    return `${prefix}${next}`;
  });
}
async function copyProfileTo(fromHome, toHome) {
  await copyProfileFiles(profileDir(fromHome), profileDir(toHome));
  const lock = join4(profileDir(toHome), "pnpm-lock.yaml");
  if (existsSync3(lock)) await writeFile3(lock, relocateLock(await readFile3(lock, "utf8"), profileDir(fromHome), profileDir(toHome)));
}
async function newestBackup(backupsDir) {
  let entries = [];
  try {
    entries = await readdir2(backupsDir);
  } catch {
    return null;
  }
  const dirs = [];
  for (const e of entries) {
    if (e === LAST_GOOD || e.startsWith("undone-")) continue;
    try {
      if ((await stat(join4(backupsDir, e))).isDirectory()) dirs.push(e);
    } catch {
    }
  }
  dirs.sort();
  return dirs.length ? join4(backupsDir, dirs[dirs.length - 1]) : null;
}

// src/engine/sidecar.mjs
import { spawn as spawn2 } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import { randomBytes } from "node:crypto";
import { PassThrough, Writable } from "node:stream";
import { pathToFileURL } from "node:url";
import { join as join5 } from "node:path";
var READY = /dsh web: (http:\/\/127\.0\.0\.1:\d+)\/\?token=(\S+)/;
var LOG_LIMIT = 400;
var BRIDGE_TIMEOUT_MS = 15e3;
var TURN_REPORT_MS = 1e3;
function redact(line) {
  return String(line).replace(/([?&]token=)[^\s&"'<>]+/gi, "$1<redacted>");
}
var Sidecar = class {
  /**
   * @param {ReturnType<import('./layout.mjs').layout>} paths
   * @param {{ home?: string, onState?: (s: any) => void, label?: string, cwd?: string, preload?: string, extraEnv?: Record<string,string> }} [opts]
   */
  constructor(paths, { home = paths.home, onState = () => {
  }, label = "main", cwd, preload, extraEnv } = {}) {
    this.paths = paths;
    this.home = home;
    this.onState = onState;
    this.label = label;
    this.cwd = cwd ?? home;
    this.preload = preload;
    this.extraEnv = extraEnv ?? {};
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
    this.conn = null;
    this.spawns = 0;
  }
  snapshot() {
    return { state: this.state, pid: this.child?.pid ?? null, base: this.base, startedAt: this.startedAt, readyMs: this.readyMs, error: this.error, dshVersion: this.paths.dshVersion ?? null };
  }
  log(line) {
    this.lines.push(redact(line));
    if (this.lines.length > LOG_LIMIT) this.lines.splice(0, this.lines.length - LOG_LIMIT);
  }
  setState(state, error = null) {
    this.state = state;
    this.error = error === null ? null : redact(error);
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
  /** 给 Forsion 引擎的 ACP 连接（registerResidentEngine 的 connect）。进程没在跑 → null。 */
  connection() {
    if (this.state !== "running" || !this.conn) return null;
    return this.conn;
  }
  spawnOnce() {
    return new Promise((resolve2, reject) => {
      this.secret = randomBytes(32).toString("hex");
      this.lines = [];
      this.base = null;
      this.token = null;
      this.conn = null;
      this.setState("starting");
      const t0 = Date.now();
      const env = childEnv(process.env, {
        binDir: this.paths.runtimePath,
        extra: { DSH_HOME: this.home, DSH2FORSION_SECRET: this.secret, DSH2FORSION_PARENT_PID: String(process.pid), DSH2FORSION_STDIO_NOTICES: "1", npm_config_store_dir: join5(this.paths.cache, "pnpm-store"), npm_config_update_notifier: "false", ...this.extraEnv }
      });
      const args = [...this.preload ? ["--import", pathToFileURL(this.preload).href] : [], this.paths.dshBin, "--profile", PROFILE];
      let child;
      try {
        child = spawn2(this.paths.nodeBin, args, { cwd: this.cwd, env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
      } catch (error) {
        this.setState("failed", String(error.message ?? error));
        reject(error);
        return;
      }
      this.child = child;
      this.spawns += 1;
      const output = new PassThrough();
      let exited;
      const closed = new Promise((r) => {
        exited = r;
      });
      const turns = promptGate(this, child.stdin);
      const conn = { id: `${child.pid ?? "x"}-${this.spawns}-${randomBytes(4).toString("hex")}`, input: turns.input, output, closed };
      child.stdin.on("error", () => {
      });
      let settled = false;
      const onLine = (line, fromStdout) => {
        if (fromStdout && line.trimStart().startsWith("{")) {
          turns.onOutput(line);
          output.write(line + "\n");
          return;
        }
        if (!line.trim()) return;
        this.log(line);
        const m = !settled && line.match(READY);
        if (m) {
          settled = true;
          clearTimeout(timer);
          this.base = m[1];
          this.token = m[2];
          this.conn = conn;
          this.startedAt = (/* @__PURE__ */ new Date()).toISOString();
          this.readyMs = Date.now() - t0;
          this.setState("running");
          resolve2(this.snapshot());
        }
      };
      const reader = (fromStdout) => {
        let pending = "";
        const decoder = new StringDecoder("utf8");
        return {
          data: (chunk) => {
            pending += decoder.write(chunk);
            const parts = pending.split(/\r?\n/);
            pending = parts.pop() ?? "";
            for (const line of parts) onLine(line, fromStdout);
          },
          flush: () => {
            pending += decoder.end();
            if (pending) onLine(pending, fromStdout);
            pending = "";
          }
        };
      };
      const out = reader(true), err = reader(false);
      child.stdout.on("data", out.data);
      child.stderr.on("data", err.data);
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
        output.end();
        exited();
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.setState("failed", String(error.message ?? error));
        reject(error);
      });
      child.once("exit", (code, signal) => {
        out.flush();
        err.flush();
        output.end();
        exited();
        if (this.child === child) {
          this.child = null;
          this.base = null;
          this.token = null;
          this.conn = null;
        }
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
    return new Promise((resolve2) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(kill);
        clearTimeout(giveUp);
        if (this.child === child) this.child = null;
        this.setState("stopped");
        resolve2();
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
  /** 工作台用的登录地址（受控网页容器打开它换 cookie）。 */
  spaceUrl() {
    if (this.state !== "running" || !this.base) return null;
    return `${this.base}/?token=${this.token}`;
  }
};
var parseLine = (line) => {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
};
function promptGate(sidecar, stdin, { retryMs = [500, 1e3, 2e3] } = {}) {
  const pending = /* @__PURE__ */ new Map();
  const decoder = new StringDecoder("utf8");
  let buf = "";
  const post = (sessionId, id, active) => sidecar.bridge("/forsion-turns", {
    method: "POST",
    body: JSON.stringify({ sessionId, id, active }),
    signal: AbortSignal.timeout(TURN_REPORT_MS)
  });
  const failed = (error) => sidecar.log(`[dsh2forsion] reporting a Forsion turn to the bridge failed: ${error?.message ?? error}`);
  const report = (sessionId, id, active) => post(sessionId, id, active).catch(failed);
  const reportEnd = async (sessionId, id) => {
    for (let attempt = 0; ; attempt++) {
      try {
        await post(sessionId, id, false);
        return;
      } catch (error) {
        if (attempt >= retryMs.length || sidecar.state !== void 0 && sidecar.state !== "running") return failed(error);
        await new Promise((resolve2) => setTimeout(resolve2, retryMs[attempt]));
      }
    }
  };
  const put = (data) => new Promise((resolve2) => {
    if (stdin.destroyed || !stdin.writable) return resolve2();
    if (stdin.write(data)) return resolve2();
    const done = () => {
      stdin.off("drain", done);
      stdin.off("close", done);
      resolve2();
    };
    stdin.once("drain", done);
    stdin.once("close", done);
  });
  const input = new Writable({
    write(chunk, _enc, cb) {
      buf += decoder.write(chunk);
      (async () => {
        let i;
        while ((i = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, i + 1);
          buf = buf.slice(i + 1);
          const m = line.includes('"session/prompt"') ? parseLine(line) : null;
          if (m?.method === "session/prompt" && m.id != null && typeof m.params?.sessionId === "string") {
            pending.set(m.id, m.params.sessionId);
            await report(m.params.sessionId, m.id, true);
          }
          await put(line);
        }
      })().then(() => cb(), cb);
    },
    final(cb) {
      buf += decoder.end();
      if (buf && !stdin.destroyed) stdin.write(buf);
      buf = "";
      stdin.end();
      cb();
    }
  });
  input.on("error", () => {
  });
  const onOutput = (line) => {
    if (!pending.size || line.length > 8192 || line.includes('"session/update"')) return;
    const m = parseLine(line);
    if (!m || m.method !== void 0 || m.id == null || !pending.has(m.id)) return;
    const sessionId = pending.get(m.id);
    pending.delete(m.id);
    void reportEnd(sessionId, m.id);
  };
  return { input, onOutput, pending };
}

// src/engine/plugins.mjs
var NPM_NAME = /^(@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*$/i;
var HOME_FILE = "dsh-home.txt";
var NOT_OURS = `The DSH profile "${PROFILE}" was not created by DSH2Forsion, so DSH2Forsion leaves it alone.`;
var UNDONE_PREFIX = "undone-";
var UNDONE_KEEP = 5;
async function pruneUndone(backupsDir) {
  let entries = [];
  try {
    entries = (await readdir3(backupsDir)).filter((e) => e.startsWith(UNDONE_PREFIX)).sort();
  } catch {
    return;
  }
  for (const e of entries.slice(0, Math.max(0, entries.length - UNDONE_KEEP))) await rm2(join6(backupsDir, e), { recursive: true, force: true });
}
async function specName(spec) {
  if (typeof spec !== "string" || !spec.trim()) throw new Error("empty plugin spec");
  const s = spec.trim();
  if (s.startsWith("file:")) {
    const pkg = JSON.parse(await readFile4(join6(s.slice(5), "package.json"), "utf8"));
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
async function pendingBuilds(home) {
  let text;
  try {
    text = await readFile4(join6(profileDir(home), "node_modules", ".modules.yaml"), "utf8");
  } catch (error) {
    return error?.code === "ENOENT" ? [] : null;
  }
  try {
    const m = JSON.parse(text);
    return Array.isArray(m?.pendingBuilds) ? m.pendingBuilds.filter((x) => typeof x === "string") : [];
  } catch {
    return null;
  }
}
function allowBuildsDecisions(text) {
  const out = /* @__PURE__ */ new Map();
  const lines = String(text ?? "").split(/\r?\n/);
  const at = lines.findIndex((l) => /^allowBuilds:/.test(l));
  if (at < 0) return out;
  if (!/^allowBuilds:\s*(#.*)?$/.test(lines[at])) return null;
  for (const l of lines.slice(at + 1)) {
    if (!l.trim() || /^\s*#/.test(l)) continue;
    if (!/^\s/.test(l)) break;
    const m = /^\s+(?:'([^']*)'|"([^"]*)"|([^\s:#'"][^:#]*?))\s*:\s*(true|false|'[^']*'|"[^"]*"|[^#:]*?)\s*(?:#.*)?$/.exec(l);
    if (!m) return null;
    const key = m[1] ?? m[2] ?? m[3];
    if (m[4] === "true") out.set(key, true);
    else if (m[4] === "false") out.set(key, false);
  }
  return out;
}
function buildDepPath(entry) {
  const i = entry.indexOf("(");
  return i > 0 ? entry.slice(0, i) : entry;
}
function buildKeyCovers(key, entry) {
  const dep = buildDepPath(entry);
  const at = dep.lastIndexOf("@");
  const name = at > 0 ? dep.slice(0, at) : dep;
  const version = at > 0 ? dep.slice(at + 1) : "";
  if (key === dep || key === name) return true;
  if (!key.startsWith(`${name}@`)) return false;
  return key.slice(name.length + 1).split("||").map((v) => v.trim()).includes(version);
}
function classifyBuilds({ added, decisions, approved = [] }) {
  return [...new Set(added.map(buildDepPath))].map((key) => {
    if (decisions === null) return { key, state: "unknown" };
    const hits = [...decisions].filter(([k]) => buildKeyCovers(k, key)).map(([, v]) => v);
    if (hits.includes(false)) return { key, state: "skipped" };
    if (approved.some((a) => buildKeyCovers(a, key))) return { key, state: "approved" };
    return { key, state: hits.includes(true) ? "allowed" : "needs" };
  });
}
var PluginManager = class {
  /**
   * @param {ReturnType<import('./layout.mjs').layout>} paths
   * @param {{ main: Sidecar, bridgeDir: string, netHook: string, known: () => any, log: (l: string) => void, restart: () => Promise<void> }} deps
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
  /** 改真实组合之前核对：组合是本插件建的（有标记文件）。用户自己建的同名组合一个字都不动。 */
  owned() {
    return existsSync4(join6(profileDir(this.paths.home), FUSION_MARKER));
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
  /**
   * 装前体检（第 1 档）：工作台里 DSH 自己的插件页要装 spec 时，桥把这次安装停住，引擎半身调这里。
   * 在临时 DSH_HOME 里拿当前组合起两次 —— 装之前一次、装上之后一次 —— 比出这个插件加了哪些工具、提示词多了多少字、
   * 有没有没启动的部分、启动时连了哪些外部主机（node --import 的钩子量出来的，不是读代码猜的）。不动真实的组合。
   */
  review(spec, opts = {}) {
    return this.exclusive(`review ${spec}`, () => this.reviewNow(spec, opts));
  }
  /** @param {{ approvedBuilds?: string[] }} [opts] approvedBuilds：DSH 插件页「允许这些脚本并重试」时带来的那几个 */
  async reviewNow(spec, { approvedBuilds = [] } = {}) {
    const t0 = Date.now();
    const log = this.deps.log;
    let name = null;
    try {
      name = await specName(spec);
    } catch {
      name = null;
    }
    const known = this.deps.known();
    const trial = this.paths.trialHome;
    await rm2(trial, { recursive: true, force: true });
    await copyProfileTo(this.paths.home, trial);
    if (existsSync4(join6(this.paths.home, "cordis.patch.yml"))) await cp2(join6(this.paths.home, "cordis.patch.yml"), join6(trial, "cordis.patch.yml"));
    const sync = await dsh(this.paths, trial, ["plugin", "--profile", PROFILE, "install", "--ignore-scripts"], { log });
    if (this.disposed) {
      await rm2(trial, { recursive: true, force: true });
      return { verdict: "failed", spec, name, reasons: ["DSH2Forsion is being turned off"] };
    }
    if (sync.code !== 0) return { verdict: "failed", spec, name, reasons: [`could not prepare the trial copy: ${tail(sync.out, 4)}`], ms: Date.now() - t0 };
    const buildsBefore = await pendingBuilds(trial);
    const before = await this.measure(trial, "before");
    if (this.disposed) return { verdict: "failed", spec, name, reasons: ["DSH2Forsion is being turned off"] };
    log(`review: add ${spec}`);
    const add = await dsh(this.paths, trial, ["plugin", "--profile", PROFILE, "add", "--ignore-scripts", spec], { log });
    if (this.disposed) {
      await rm2(trial, { recursive: true, force: true });
      return { verdict: "failed", spec, name, reasons: ["DSH2Forsion is being turned off"] };
    }
    if (add.code !== 0 && VERSION_REFUSED.test(add.out)) {
      await rm2(trial, { recursive: true, force: true });
      return { verdict: "version-refused", spec, name, reasons: [tail(add.out, 4)], ms: Date.now() - t0 };
    }
    if (add.code !== 0) {
      await rm2(trial, { recursive: true, force: true });
      return { verdict: "failed", spec, name, reasons: [tail(add.out, 6)], ms: Date.now() - t0 };
    }
    const added = (await userPlugins(trial)).filter((p) => !before.deps.includes(p.name));
    name ??= added[0]?.name ?? null;
    const version = name ? (await userPlugins(trial)).find((p) => p.name === name)?.version ?? null : null;
    const shadowed = await shadowedCorePackages(this.paths, trial);
    const buildsAfter = await pendingBuilds(trial);
    let builds = null;
    if (buildsBefore !== null && buildsAfter !== null) {
      let decisions = /* @__PURE__ */ new Map();
      try {
        decisions = allowBuildsDecisions(await readFile4(join6(profileDir(trial), "pnpm-workspace.yaml"), "utf8"));
      } catch (error) {
        if (error?.code !== "ENOENT") decisions = null;
      }
      const had = new Set(buildsBefore.map(buildDepPath));
      builds = classifyBuilds({ added: buildsAfter.filter((b) => !had.has(buildDepPath(b))), decisions, approved: approvedBuilds });
    }
    const after = await this.measure(trial, "after");
    await rm2(trial, { recursive: true, force: true });
    if (this.disposed) return { verdict: "failed", spec, name, reasons: ["DSH2Forsion is being turned off"] };
    const graded = name && version && (known.matrixDsh ?? known.dsh) === this.paths.dshVersion ? known.plugins?.[`${name}@${version}`] ?? null : null;
    const judged = judgeTrial({ ready: after.ready, lines: after.lines, shadowed, pluginName: name ?? spec, graded });
    const beforeChars = new Map(before.sections.map((x) => [x.name, x.chars]));
    const report = {
      verdict: judged.verdict,
      spec,
      name,
      version,
      reasons: judged.reasons,
      tools: after.tools.filter((t) => !before.tools.includes(t)),
      toolsGone: after.ready ? before.tools.filter((t) => !after.tools.includes(t)) : [],
      promptChars: after.sections.reduce((n, x) => n + x.chars, 0) - before.sections.reduce((n, x) => n + x.chars, 0),
      sections: after.sections.filter((x) => x.chars !== beforeChars.get(x.name)).map((x) => ({ name: x.name, chars: x.chars - (beforeChars.get(x.name) ?? 0) })),
      inactive: after.lines.filter((l) => INACTIVE.test(l) || BROKEN.test(l)).filter((l) => !before.lines.includes(l)).slice(0, 8),
      hosts: after.hosts.filter((h) => !before.hosts.includes(h)),
      builds,
      measured: { before: before.ready, after: after.ready },
      ms: Date.now() - t0
    };
    log(`review: ${report.verdict}, +${report.tools.length} tools, ${report.promptChars >= 0 ? "+" : ""}${report.promptChars} prompt chars, ${report.hosts.length} hosts, builds ${builds === null ? "unread" : builds.map((b) => `${b.key}=${b.state}`).join(",") || "none"}`);
    return report;
  }
  /** 在体检目录里起一次组合，量工具、提示词分节和外连主机；起不来也返回（ready=false）。 */
  async measure(trial, label) {
    if (this.disposed) return { ready: false, tools: [], sections: [], lines: [], hosts: [], deps: [] };
    const netFile = join6(trial, `net-${label}.txt`);
    await writeFile4(netFile, "");
    const probe = new Sidecar(this.paths, { home: trial, label: `trial-${label}`, cwd: trial, preload: this.deps.netHook, extraEnv: { DSH2FORSION_TRIAL_NET: netFile } });
    this.probe = probe;
    let ready = false, tools = [], sections = [];
    try {
      await probe.start();
      ready = true;
      if (this.disposed) throw new Error("turning off");
      await new Promise((r) => setTimeout(r, 2500));
      const check = await probe.bridge("/fusion/check");
      tools = check.tools ?? [];
      sections = check.sections ?? [];
    } catch {
    }
    const lines = [...probe.lines];
    await probe.stop();
    this.probe = null;
    let hosts = [];
    try {
      hosts = (await readFile4(netFile, "utf8")).split("\n").map((l) => l.trim()).filter(Boolean);
    } catch {
      hosts = [];
    }
    const deps = (await userPlugins(trial)).map((p) => p.name);
    return { ready, tools, sections, lines, hosts: [...new Set(hosts)], deps };
  }
  remove(name) {
    if (typeof name !== "string" || !NPM_NAME.test(name)) return Promise.resolve({ status: "failed", name, message: "not an npm package name" });
    return this.exclusive(`remove ${name}`, async () => {
      if (!this.owned()) return { status: "failed", name, message: NOT_OURS };
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
      if (!this.owned()) return { status: "failed", message: NOT_OURS };
      const dir = await newestBackup(this.paths.backups);
      if (!dir) return { status: "nothing-to-roll-back" };
      if (!await this.sameHome(dir)) return { status: "failed", message: "That snapshot is from a different DSH folder; it was kept and not applied." };
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
    const dir = join6(this.paths.backups, LAST_GOOD);
    await copyProfileFiles(profileDir(this.paths.home), join6(dir, "profile"));
    await writeFile4(join6(dir, "label.txt"), `last good start ${(/* @__PURE__ */ new Date()).toISOString()}
`);
    await writeFile4(join6(dir, HOME_FILE), this.paths.home);
  }
  /** 快照只还原回建它的那份 DSH 目录（换过 DSH_HOME、或 v0.1 私有目录留下的快照都不认）。 */
  async sameHome(dir) {
    try {
      return await readFile4(join6(dir, HOME_FILE), "utf8") === this.paths.home;
    } catch {
      return false;
    }
  }
  restoreLastGood() {
    return this.exclusive("restore last good", async () => {
      if (!this.owned()) return { status: "failed", message: NOT_OURS };
      const dir = join6(this.paths.backups, LAST_GOOD);
      if (!existsSync4(join6(dir, "profile", "package.json")) || !await this.sameHome(dir)) return { status: "nothing-to-restore" };
      await this.snapshot("before restoring last good");
      await this.restore(dir);
      await this.deps.restart();
      return { status: "restored" };
    });
  }
  async snapshot(label, prefix = "") {
    const stamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-");
    const dir = join6(this.paths.backups, `${prefix}${stamp}`);
    await mkdir4(dir, { recursive: true });
    await copyProfileFiles(profileDir(this.paths.home), join6(dir, "profile"));
    await writeFile4(join6(dir, "label.txt"), `${label}
`);
    await writeFile4(join6(dir, HOME_FILE), this.paths.home);
    return dir;
  }
  async restore(dir) {
    if (!this.owned() || !await this.sameHome(dir)) {
      this.deps.log("restore refused: profile not ours or snapshot from another DSH folder");
      return false;
    }
    await copyProfileFiles(join6(dir, "profile"), profileDir(this.paths.home));
    const r = await dsh(this.paths, this.paths.home, ["plugin", "--profile", PROFILE, "install", "--ignore-scripts"], { log: this.deps.log });
    if (r.code !== 0) this.deps.log(`restore install failed: ${tail(r.out, 6)}`);
    return r.code === 0;
  }
};

// src/engine/runtime.mjs
import { createHash as createHash2 } from "node:crypto";
import { createReadStream, existsSync as existsSync5, readFileSync as readFileSync3 } from "node:fs";
import { mkdir as mkdir5, readFile as readFile5, rm as rm3, writeFile as writeFile5, rename } from "node:fs/promises";
import { join as join7 } from "node:path";
function runtimeInstalled(paths) {
  try {
    const marker = JSON.parse(readFileSync3(paths.runtimeMarker, "utf8"));
    return marker.dsh === (paths.dshVersion ?? DSH_VERSION) && marker.node === NODE_VERSION && marker.pnpm === PNPM_VERSION && existsSync5(paths.nodeBin) && existsSync5(paths.dshBin) && existsSync5(marker.lockSha256 ? paths.pnpmBin : paths.legacyPnpmBin);
  } catch {
    return false;
  }
}
function sources(choice = "auto") {
  if (choice === "official") return ["official"];
  if (choice === "mirror") return ["mirror"];
  return ["official", "mirror"];
}
async function sha2562(file) {
  const hash = createHash2("sha256");
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
  await writeFile5(file, Buffer.from(await res.arrayBuffer()));
}
function tarBin() {
  if (process.platform !== "win32") return "tar";
  const system = join7(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe");
  return existsSync5(system) ? system : "tar";
}
async function installNode(paths, { source, log, signal }) {
  if (existsSync5(paths.nodeBin)) return;
  const plat = nodePlatform();
  if (!plat) throw new Error(`unsupported platform ${process.platform}-${process.arch}`);
  const name = `node-${NODE_VERSION}-${plat.id}`;
  const file = `${name}.${plat.ext}`;
  const tmp = join7(paths.root, "downloads");
  await mkdir5(tmp, { recursive: true });
  let lastError;
  for (const which of sources(source)) {
    const base = `${NODE_MIRRORS[which]}/${NODE_VERSION}`;
    try {
      log(`download ${file} (${which})`);
      let expected = NODE_SHA256[file];
      if (!expected) {
        await download(`${base}/SHASUMS256.txt`, join7(tmp, "SHASUMS256.txt"), signal);
        const sums = await readFile5(join7(tmp, "SHASUMS256.txt"), "utf8");
        expected = sums.split("\n").map((l) => l.trim().split(/\s+/)).find(([, f]) => f === file)?.[0];
      }
      if (!expected) throw new Error(`${file} missing from SHASUMS256.txt`);
      await download(`${base}/${file}`, join7(tmp, file), signal);
      const actual = await sha2562(join7(tmp, file));
      if (actual !== expected) throw new Error(`checksum mismatch for ${file}`);
      log(`checksum ok ${actual.slice(0, 12)}\u2026`);
      const stage = `${paths.nodeDir}.partial`;
      await rm3(stage, { recursive: true, force: true });
      await mkdir5(stage, { recursive: true });
      const r = await run(tarBin(), ["-xf", join7(tmp, file), "-C", stage, "--strip-components=1"], { timeoutMs: 3e5, signal });
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
    extra: { npm_config_cache: join7(paths.cache, "npm"), npm_config_registry: registry, npm_config_update_notifier: "false", npm_config_fund: "false", npm_config_audit: "false" }
  });
  return run(paths.nodeBin, [paths.npmCli, ...args], { cwd, env, timeoutMs: 12e5, onLine: log, signal });
}
async function installDsh(paths, { source, log, signal, files }) {
  await mkdir5(paths.runtimeDir, { recursive: true });
  const manifest = files ? Buffer.from(files.packageJson) : await readFile5(new URL("../runtime/package.json", import.meta.url));
  const lock = files ? Buffer.from(files.lock) : await readFile5(new URL("../runtime/package-lock.json", import.meta.url));
  signal?.throwIfAborted();
  await rm3(paths.runtimeMarker, { force: true });
  await writeFile5(join7(paths.runtimeDir, "package.json"), manifest);
  await writeFile5(join7(paths.runtimeDir, "package-lock.json"), lock);
  let lastError;
  for (const which of sources(source)) {
    signal?.throwIfAborted();
    const registry = NPM_REGISTRIES[which];
    log(`npm ci @deepseek-ai/dsh@${paths.dshVersion ?? DSH_VERSION}, pnpm@${PNPM_VERSION} (${which})`);
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
    return { registry, lockSha256: createHash2("sha256").update(lock).digest("hex") };
  }
  throw lastError ?? new Error("runtime install failed");
}
async function installRuntime(paths, { source = "auto", log = () => {
}, signal, files } = {}) {
  signal?.throwIfAborted();
  if (runtimeInstalled(paths)) {
    log("runtime already installed");
    return;
  }
  await mkdir5(paths.root, { recursive: true });
  await installNode(paths, { source, log, signal });
  const { registry, lockSha256 } = await installDsh(paths, { source, log, signal, files });
  signal?.throwIfAborted();
  await writeFile5(paths.runtimeMarker, JSON.stringify({ dsh: paths.dshVersion ?? DSH_VERSION, node: NODE_VERSION, pnpm: PNPM_VERSION, registry, lockSha256, at: (/* @__PURE__ */ new Date()).toISOString() }) + "\n");
  await rm3(join7(paths.cache, "npm"), { recursive: true, force: true }).catch(() => {
  });
  log("runtime ready");
}

// src/engine/tools.mjs
import { createHash as createHash3 } from "node:crypto";
var sessionKey = (ctx) => typeof ctx?.userId === "string" && ctx.userId && typeof ctx.sessionId === "string" && ctx.sessionId && typeof ctx.cwd === "string" && ctx.cwd ? createHash3("sha256").update(JSON.stringify([ctx.userId, ctx.sessionId])).digest("hex") : void 0;
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
    const message = text || result.error?.message || "DSH tool failed";
    return message.startsWith("Error:") ? message : `Error: ${message}`;
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

// src/engine/index.mjs
var LOG_LIMIT2 = 300;
var REVIEW_POLL_MS = 1e3;
var REVIEW_KEEP_MS = 10 * 6e4;
function readJson(file, fallback) {
  try {
    return JSON.parse(readFileSync4(file, "utf8"));
  } catch {
    return fallback;
  }
}
function createPlugin() {
  let state = null;
  return {
    async activate(ctx) {
      const root = ctx.paths.dataDir;
      const dshHome = resolveDshHome(process.env);
      const logs = [];
      const log = (line) => {
        logs.push(`${(/* @__PURE__ */ new Date()).toISOString().slice(11, 19)} ${line}`);
        if (logs.length > LOG_LIMIT2) logs.splice(0, logs.length - LOG_LIMIT2);
      };
      let paths = layout(root, process.platform, { dshHome, dshVersion: activeVersion(root, log) });
      const bridgeDir = join8(ctx.paths.pluginDir, "dsh-bridge");
      const netHook = join8(bridgeDir, "trial-net-hook.mjs");
      const compatDir = join8(ctx.paths.pluginDir, "compat");
      const store = ctx.sdk.pluginStore;
      const settings = () => ({ autoStart: true, exposeTools: false, downloadSource: "auto", updateChannel: "pinned", ...store.getScopeSettings(PLUGIN_ID, "global") ?? {} });
      const enabled = () => !disposed && store.isPluginEnabledSync(PLUGIN_ID);
      const baseline = () => readJson(join8(compatDir, `baseline-${paths.dshVersion}.json`), readJson(join8(compatDir, `baseline-${DSH_VERSION}.json`), { tools: [], sections: [] }));
      const known = () => readJson(join8(compatDir, "known.json"), { plugins: {}, exemptions: [] });
      const sidecar = new Sidecar(paths, { onState: (s) => log(`sidecar ${s.state}${s.error ? `: ${s.error}` : ""}`), cwd: dshHome });
      const tools = new ToolBridge({ sidecar, baseline, log, enabled: () => enabled() && settings().exposeTools === true });
      const job = { name: null, running: false, error: null, lines: [] };
      let disposed = false;
      let incompatible = null;
      let profileError = null;
      const sessionEvents = [];
      let eventSeq = 0;
      const offline = new Error("DSH2Forsion is turned off");
      let starting = null;
      const startNow = async () => {
        if (!runtimeInstalled(paths)) throw new Error("runtime not installed");
        try {
          await ensureFusedProfile(paths, { log });
          profileError = null;
        } catch (error) {
          profileError = String(error.message ?? error);
          throw error;
        }
        if (disposed) throw offline;
        if (await ensureBridge(paths, paths.home, bridgeDir, { log })) log("bridge installed / updated");
        if (disposed) throw offline;
        await sidecar.start();
        if (disposed) {
          await sidecar.stop(1e3);
          throw offline;
        }
        let check = null;
        try {
          check = await sidecar.bridge("/fusion/check");
        } catch (error) {
          check = { ok: false, error: String(error.message ?? error) };
        }
        if (!check?.ok || check.gate !== true) {
          incompatible = { dshVersion: paths.dshVersion, reason: check?.ok ? `install review not armed: ${check.gateReason ?? "unknown"}` : `bridge unavailable: ${check?.error ?? "unknown"}`, at: (/* @__PURE__ */ new Date()).toISOString() };
          log(`fusion self-check failed on DSH ${paths.dshVersion}: ${incompatible.reason}`);
          await sidecar.stop(1500);
          throw new Error(incompatible.reason);
        }
        incompatible = null;
        await plugins.saveLastGood().catch((error) => log(`save last good failed: ${error.message}`));
        await tools.refresh();
        if (disposed) return;
        tools.startPolling();
        reviews.startPolling();
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
        reviews.stopPolling();
        await sidecar.stop(graceMs);
        await tools.refresh();
      };
      const settled = () => starting?.then(() => {
      }, () => {
      });
      const restart = async () => {
        if (disposed) return;
        await settled();
        await stop();
        if (!disposed) await start().catch((error) => log(`restart failed: ${error.message}`));
      };
      const plugins = new PluginManager(paths, { main: sidecar, bridgeDir, netHook, known, log, restart });
      const reviews = {
        items: /* @__PURE__ */ new Map(),
        timer: null,
        list: () => [...reviews.items.values()].map(({ id, spec, at, state: state2, report, error }) => ({ id, spec, at, state: state2, report, error })),
        startPolling() {
          if (reviews.timer) return;
          const tick = async () => {
            reviews.timer = null;
            if (disposed || sidecar.state !== "running") return;
            try {
              const { pending } = await sidecar.bridge("/fusion/installs");
              for (const p of pending ?? []) {
                if (reviews.items.has(p.id)) continue;
                const item = { id: p.id, spec: p.spec, at: p.at, state: "checking", report: null, error: null };
                reviews.items.set(p.id, item);
                log(`install of ${p.spec} is waiting for review`);
                void plugins.review(p.spec, { approvedBuilds: p.approvedBuilds }).then((r) => {
                  item.report = r;
                  item.state = "ready";
                }, (e) => {
                  item.error = String(e.message ?? e);
                  item.state = "ready";
                });
              }
              const live = new Set((pending ?? []).map((p) => p.id));
              for (const [id, item] of reviews.items) {
                if (!live.has(id) && item.state !== "decided" && item.state !== "checking") {
                  item.state = "gone";
                }
                if ((item.state === "decided" || item.state === "gone") && Date.now() - item.at > REVIEW_KEEP_MS) reviews.items.delete(id);
              }
            } catch {
            }
            if (!disposed && sidecar.state === "running") reviews.timer = setTimeout(tick, REVIEW_POLL_MS);
          };
          reviews.timer = setTimeout(tick, REVIEW_POLL_MS);
        },
        stopPolling() {
          clearTimeout(reviews.timer);
          reviews.timer = null;
        },
        async decide(id, allow) {
          const item = reviews.items.get(id);
          if (!item) throw new Error("This install is no longer waiting");
          if (item.state === "checking" && allow) throw new Error("Wait for the check to finish");
          const r = await sidecar.bridge("/fusion/installs/decide", { method: "POST", body: JSON.stringify({ id, allow, message: allow ? void 0 : "Cancelled in Forsion" }) });
          item.state = r.ok ? "decided" : "gone";
          item.allowed = allow;
          return { ok: r.ok };
        }
      };
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
      const switchRuntime = async (version) => {
        await setActiveVersion(root, version);
        await stop();
        paths = layout(root, process.platform, { dshHome, dshVersion: version });
        sidecar.paths = paths;
        plugins.paths = paths;
        incompatible = null;
        log(`switched to DSH ${version}`);
        if (!disposed) await start().catch((error) => log(`start on DSH ${version} failed: ${error.message}`));
      };
      const channel = { checkedAt: null, published: null, latest: null, error: null };
      const checkChannel = async (jlog = log) => {
        channel.checkedAt = (/* @__PURE__ */ new Date()).toISOString();
        try {
          const r = await fetchChannel(root);
          channel.published = r.published;
          channel.latest = r.manifest?.dsh ?? null;
          channel.error = null;
          if (!r.published) {
            jlog("update channel: nothing published yet");
            return;
          }
          if (compareVersions(r.manifest.dsh, paths.dshVersion) <= 0) {
            jlog(`update channel: DSH ${paths.dshVersion} is current`);
            return;
          }
          const next = layout(root, process.platform, { dshHome, dshVersion: r.manifest.dsh });
          jlog(`update channel: installing DSH ${r.manifest.dsh}`);
          await installRuntime(next, { source: settings().downloadSource, log: jlog, files: r.manifest.files });
          await switchRuntime(r.manifest.dsh);
        } catch (error) {
          channel.error = String(error.message ?? error);
          jlog(`update channel: ${channel.error}`);
        }
      };
      const shutdown = async () => {
        disposed = true;
        reviews.stopPolling();
        await plugins.dispose();
        if (starting) await Promise.race([starting.catch(() => {
        }), new Promise((r) => setTimeout(r, 2e3))]);
        await stop(1500);
      };
      state = { shutdown };
      if (ctx.registerResidentEngine) ctx.registerResidentEngine({
        engineId: ENGINE_ID,
        connect: async (signal) => {
          if (!enabled() || incompatible || !runtimeInstalled(paths)) return null;
          try {
            await Promise.race([start(), new Promise((_, reject) => signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true }))]);
          } catch (error) {
            log(`resident connect: ${error.message}`);
            return null;
          }
          if (!enabled()) return null;
          return sidecar.connection();
        },
        onSession: (event) => {
          sessionEvents.push({ ...event, seq: ++eventSeq, at: Date.now() });
          if (sessionEvents.length > 50) sessionEvents.splice(0, sessionEvents.length - 50);
        },
        // 第 2 档：交过去的 Computer Use 先问「这场会话的模型收不收图」，由 DSH 自己按它的模型目录答；答不了 = 不知道（宿主按不能处理）
        modelSeesImages: async (model) => {
          if (typeof model !== "string" || !model || sidecar.state !== "running") return void 0;
          try {
            const { image } = await sidecar.bridge("/models/images", { method: "POST", body: JSON.stringify({ modelId: model }) });
            return typeof image === "boolean" ? image : void 0;
          } catch (error) {
            log(`modelSeesImages: ${error.message}`);
            return void 0;
          }
        }
      });
      if (ctx.registerSkillProvider) ctx.registerSkillProvider({
        id: "dsh",
        list: async ({ signal, cwd } = {}) => {
          if (!enabled() || sidecar.state !== "running") return [];
          const { skills } = await sidecar.bridge(`/skills${cwd ? `?cwd=${encodeURIComponent(cwd)}` : ""}`, { signal });
          return disposed ? [] : skills;
        }
      });
      ctx.registerPlugin({
        id: PLUGIN_ID,
        name: "DSH2Forsion",
        nameEn: "DSH2Forsion",
        description: "\u5728 Forsion \u91CC\u5E38\u9A7B\u4E00\u4E2A DeepSeek Harness\uFF1ADSH \u8FD9\u4E2A Agent \u7684\u5BF9\u8BDD\u8FDE\u5B83\uFF0CDSH \u5DE5\u4F5C\u53F0\u5F00\u5B83\u7684\u754C\u9762\uFF0C\u88C5 DSH \u63D2\u4EF6\u524D\u5148\u4F53\u68C0\u3002",
        descriptionEn: "Keeps one DeepSeek Harness running in Forsion: chats with the DSH agent connect to it, the DSH workbench opens its interface, and DSH plugins are checked before they are installed.",
        scopes: ["global"],
        defaultEnabled: true,
        settings: {
          fields: [
            { key: "autoStart", type: "toggle", label: "\u968F Forsion \u542F\u52A8 DSH", labelEn: "Start DSH with Forsion", default: true, help: "\u5173\u6389\u5219\u5728\u7B2C\u4E00\u6B21\u548C DSH \u5BF9\u8BDD\u6216\u6253\u5F00\u5DE5\u4F5C\u53F0\u65F6\u518D\u542F\u52A8\uFF08\u5E38\u9A7B\u7EA6 400 MB \u5185\u5B58\uFF09\u3002", helpEn: "When off, DSH starts the first time you chat with DSH or open the workbench (it uses about 400 MB of memory while running)." },
            { key: "exposeTools", type: "toggle", label: "\u628A DSH \u63D2\u4EF6\u7684\u5DE5\u5177\u4EA4\u7ED9 Tangu", labelEn: "Offer DSH plugin tools to Tangu", default: false, help: "\u7F3A\u7701\u5173\uFF1A\u628A\u8981 DSH \u63D2\u4EF6\u505A\u7684\u4E8B\u4EA4\u7ED9 DSH \u8FD9\u4E2A Agent\u3002\u6253\u5F00\u540E\u6BCF\u6B21\u8C03\u7528\u90FD\u4F1A\u5148\u95EE\u4F60\uFF0C\u5347\u7248\u65F6\u6700\u5BB9\u6613\u65AD\u3002", helpEn: "Off by default: hand work that needs a DSH plugin to the DSH agent. When on, Tangu asks before every call; this is the part most likely to break when DSH updates." },
            {
              key: "updateChannel",
              type: "select",
              label: "\u66F4\u65B0\u901A\u9053",
              labelEn: "Update channel",
              default: "pinned",
              options: [
                { value: "pinned", label: "\u56FA\u5B9A\u5728\u8FD9\u4E2A\u63D2\u4EF6\u7248\u672C\u9A8C\u8FC7\u7684 DSH", labelEn: "Stay on the DSH this plugin version was checked with" },
                { value: "follow", label: "\u8DDF\u7248\uFF1A\u88C5 DSH2Forsion \u6BCF\u5929\u81EA\u68C0\u8FC7\u7684\u65B0\u7248", labelEn: "Follow: install newer DSH versions that DSH2Forsion checks every day" }
              ]
            },
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
      const status = async () => ({
        pluginVersion: PLUGIN_VERSION,
        dshVersion: paths.dshVersion,
        pinnedVersion: DSH_VERSION,
        nodeVersion: NODE_VERSION,
        runtime: { installed: runtimeInstalled(paths), root: paths.root, installedVersions: await installedVersions(root), verifiedVersions: verifiedVersions(root), previous: await previousVersion(root, paths.dshVersion) },
        fusion: { home: dshHome, profile: PROFILE, profileError, incompatible, resident: typeof ctx.registerResidentEngine === "function", hold: typeof ctx.sdk.engines?.hold === "function", events: sessionEvents.slice(-10) },
        channel: { ...channel, setting: settings().updateChannel },
        job: { name: job.name, running: job.running, error: job.error, lines: job.lines.slice(-12) },
        sidecar: sidecar.snapshot(),
        tools: tools.schemas.map((t) => t.name),
        promptSections: tools.sections.map((s) => s.name),
        pluginJob: plugins.busy,
        // 用户装的 DSH 插件清单的指纹(名字@版本):界面据此知道清单变了,让宿主重取 Harness 卡上的行
        plugins: { key: (await userPlugins(paths.home)).map((p) => `${p.name}@${p.version}`).sort().join(",") },
        reviews: reviews.list().filter((r) => r.state === "checking" || r.state === "ready").length,
        // DSH 自己的审批:mode 'forsion' = Forsion 发的轮问到 Forsion 的审批卡;'workbench' = 自检没过,退回工作台提示(reason 写原因)
        approvals: sidecar.state === "running" ? await sidecar.bridge("/approvals", { signal: AbortSignal.timeout(1500) }).catch(() => null) : null,
        settings: settings(),
        nativeSkills: { supported: typeof ctx.registerSkillProvider === "function" }
      });
      ctx.registerScopedRoutes((router) => {
        router.get("/status", (_req, res) => send(res, status));
        router.get("/logs", (_req, res) => send(res, () => ({ lines: [...logs], sidecar: sidecar.lines.slice(-200) })));
        router.post("/runtime/install", (_req, res) => send(res, () => {
          const started = runJob("install-runtime", async (jlog) => {
            const manifest = await storedManifest(root, paths.dshVersion);
            await installRuntime(paths, { source: settings().downloadSource, log: jlog, ...manifest ? { files: manifest.files } : {} });
            await start();
          });
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
          await settled();
          await stop();
          await start();
          return status();
        }));
        const workbench = async () => {
          if (incompatible) return { incompatible, previous: await previousVersion(root, paths.dshVersion) };
          if (sidecar.state !== "running") await start();
          return { url: sidecar.spaceUrl(), base: sidecar.base, startedAt: sidecar.startedAt };
        };
        router.post("/workbench", (_req, res) => send(res, workbench));
        router.post("/space", (_req, res) => send(res, workbench));
        router.post("/rail", (_req, res) => send(res, async () => {
          const wb = await workbench();
          if (wb.incompatible) return wb;
          const { nonce } = await sidecar.bridge("/rail/nonce", { method: "POST", body: "{}" });
          return { ...wb, nonce };
        }));
        router.post("/rail/report", (req, res) => send(res, async () => {
          if (sidecar.state !== "running") return { known: false, report: null, stopped: true };
          return sidecar.bridge(`/rail?nonce=${encodeURIComponent(String(req.body?.nonce ?? ""))}`);
        }));
        router.post("/hold", (req, res) => send(res, async () => {
          if (typeof ctx.sdk.engines?.hold !== "function") throw new Error("Update Forsion to open conversations in the DSH workbench");
          if (sidecar.state !== "running") await start();
          return ctx.sdk.engines.hold(ENGINE_ID, String(req.body?.sessionId ?? ""), req.user?.userId);
        }));
        router.post("/appearance", (req, res) => send(res, async () => {
          if (sidecar.state !== "running") return { ok: false, reason: "not running" };
          return sidecar.bridge("/appearance", { method: "POST", body: JSON.stringify({ theme: req.body?.theme, locale: req.body?.locale }) });
        }));
        router.get("/plugins", (_req, res) => send(res, async () => ({ plugins: await plugins.list(), known: known() })));
        router.get("/reviews", (_req, res) => send(res, () => ({ reviews: reviews.list() })));
        router.post("/reviews/decide", (req, res) => send(res, () => reviews.decide(String(req.body?.id ?? ""), req.body?.allow === true)));
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
        router.post("/channel/check", (_req, res) => send(res, () => ({ started: runJob("update-channel", (jlog) => checkChannel(jlog)) })));
        router.post("/channel/set", (req, res) => send(res, async () => {
          const value = req.body?.updateChannel;
          if (value !== "pinned" && value !== "follow") throw new Error("updateChannel must be pinned or follow");
          await store.setScopeSettings(PLUGIN_ID, "global", { updateChannel: value });
          if (value === "follow") runJob("update-channel", (jlog) => checkChannel(jlog));
          return status();
        }));
        router.post("/runtime/previous", (_req, res) => send(res, async () => {
          const prev = await previousVersion(root, paths.dshVersion);
          if (!prev) throw new Error("No earlier DSH version that this DSH2Forsion has checked is installed on this computer");
          await switchRuntime(prev);
          return status();
        }));
      });
      if (runtimeInstalled(paths) && settings().autoStart !== false) {
        void start().catch((error) => log(`auto start failed: ${error.message}`));
      } else if (!existsSync6(paths.root)) {
        log("runtime not installed yet");
      }
      if (settings().updateChannel === "follow" && runtimeInstalled(paths)) void checkChannel().catch(() => {
      });
      ctx.log(`activated (DSH ${paths.dshVersion}, profile ${PROFILE})`);
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
