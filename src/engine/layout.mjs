// 运行时目录布局。根目录是引擎给本插件的数据目录（ctx.paths.dataDir）：
//   node/<版本>/        官方 Node（SHASUMS256 校验）
//   runtime/<DSH 版本>/ 钉死的 @deepseek-ai/dsh
//   home/               v0.1 的隔离 DSH_HOME（不再使用，原样留着）
//   融合组合在用户自己的 DSH 目录里：<DSH_HOME>/profiles/forsion（见 constants.mjs）
//   trial/              装前试启动用的临时 DSH_HOME
//   backups/<时刻>/     改 profile 之前的快照
//   cache/              npm / pnpm 缓存
import { homedir } from 'node:os'
import { join } from 'node:path'
import { DSH_VERSION, NODE_VERSION, PROFILE } from './constants.mjs'

export function nodePlatform(platform = process.platform, arch = process.arch) {
  const a = arch === 'arm64' ? 'arm64' : arch === 'x64' ? 'x64' : null
  if (!a) return null
  if (platform === 'darwin') return { id: `darwin-${a}`, ext: 'tar.gz' }
  if (platform === 'linux') return { id: `linux-${a}`, ext: 'tar.gz' }
  if (platform === 'win32') return { id: `win-${a}`, ext: 'zip' }
  return null
}

/** 用户自己的 DSH 目录：$DSH_HOME 优先，缺省 ~/.dsh（和 Forsion 的 DSH 引擎同一个口径）。 */
export function resolveDshHome(env = process.env) {
  const own = typeof env.DSH_HOME === 'string' ? env.DSH_HOME.trim() : ''
  if (own) return own
  const home = (typeof env.HOME === 'string' && env.HOME.trim()) || (typeof env.USERPROFILE === 'string' && env.USERPROFILE.trim()) || homedir()
  return join(home, '.dsh')
}

export function layout(root, platform = process.platform, { dshHome = join(root, 'home'), dshVersion = DSH_VERSION } = {}) {
  const win = platform === 'win32'
  const nodeDir = join(root, 'node', NODE_VERSION)
  const runtimeDir = join(root, 'runtime', dshVersion)
  const home = dshHome
  return {
    root,
    dshVersion,
    nodeDir,
    nodeBin: win ? join(nodeDir, 'node.exe') : join(nodeDir, 'bin', 'node'),
    nodeBinDir: win ? nodeDir : join(nodeDir, 'bin'),
    // Locked pnpm wins over a leftover global copy; old v0.1 installations still fall back to it.
    runtimePath: [join(runtimeDir, 'node_modules', '.bin'), win ? nodeDir : join(nodeDir, 'bin')].join(win ? ';' : ':'),
    npmCli: win ? join(nodeDir, 'node_modules', 'npm', 'bin', 'npm-cli.js') : join(nodeDir, 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    pnpmBin: join(runtimeDir, 'node_modules', '.bin', win ? 'pnpm.cmd' : 'pnpm'),
    legacyPnpmBin: win ? join(nodeDir, 'pnpm.cmd') : join(nodeDir, 'bin', 'pnpm'),
    runtimeDir,
    dshBin: join(runtimeDir, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
    home,
    profileDir: join(home, 'profiles', PROFILE),
    trialHome: join(root, 'trial'),
    backups: join(root, 'backups'),
    cache: join(root, 'cache'),
    runtimeMarker: join(runtimeDir, '.dsh2forsion-ready'),
  }
}
