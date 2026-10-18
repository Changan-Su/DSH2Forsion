// 子进程环境走白名单（08-13 DSH 评审 ①「allowlist 优先」）：宿主的令牌、provider key、
// FORSION_* / TANGU_* 一律不传。只放行系统运转、代理和证书需要的变量。
const EXACT = new Set([
  'PATH', 'Path', 'HOME', 'USERPROFILE', 'USER', 'USERNAME', 'LOGNAME', 'SHELL', 'TERM', 'LANG', 'LANGUAGE',
  'TMPDIR', 'TEMP', 'TMP', 'SystemRoot', 'SYSTEMROOT', 'windir', 'WINDIR', 'ComSpec', 'COMSPEC', 'PATHEXT',
  'SystemDrive', 'APPDATA', 'LOCALAPPDATA', 'ProgramData', 'ProgramFiles', 'ProgramFiles(x86)', 'CommonProgramFiles',
  'HOMEDRIVE', 'HOMEPATH', 'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE', 'OS',
  'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'no_proxy', 'all_proxy',
  'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE', 'SSL_CERT_DIR',
  'DISPLAY', 'WAYLAND_DISPLAY', 'XAUTHORITY', 'DBUS_SESSION_BUS_ADDRESS',
])
const PREFIXES = ['LC_', 'XDG_']

/**
 * @param {Record<string, string|undefined>} parent 宿主进程环境
 * @param {{ binDir: string, extra?: Record<string, string> }} opts binDir 放到 PATH 最前面
 */
export function childEnv(parent, { binDir, extra = {} }) {
  const env = {}
  for (const [key, value] of Object.entries(parent)) {
    if (value === undefined) continue
    if (EXACT.has(key) || PREFIXES.some(p => key.startsWith(p))) env[key] = value
  }
  const pathKey = Object.keys(env).find(k => k.toUpperCase() === 'PATH') ?? 'PATH'
  const sep = process.platform === 'win32' ? ';' : ':'
  env[pathKey] = [binDir, env[pathKey]].filter(Boolean).join(sep)
  return { ...env, ...extra }
}
