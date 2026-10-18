// 运行时目录布局。根目录是引擎给本插件的数据目录（ctx.paths.dataDir）：
//   node/<版本>/        官方 Node（SHASUMS256 校验）
//   runtime/<DSH 版本>/ 钉死的 @deepseek-ai/dsh
//   home/               sidecar 的 DSH_HOME（和用户自己的 ~/.dsh 完全分开）
//   trial/              装前试启动用的临时 DSH_HOME
//   backups/<时刻>/     改 profile 之前的快照
//   cache/              npm / pnpm 缓存
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

export function layout(root, platform = process.platform) {
  const win = platform === 'win32'
  const nodeDir = join(root, 'node', NODE_VERSION)
  const runtimeDir = join(root, 'runtime', DSH_VERSION)
  const home = join(root, 'home')
  return {
    root,
    nodeDir,
    nodeBin: win ? join(nodeDir, 'node.exe') : join(nodeDir, 'bin', 'node'),
    nodeBinDir: win ? nodeDir : join(nodeDir, 'bin'),
    npmCli: win ? join(nodeDir, 'node_modules', 'npm', 'bin', 'npm-cli.js') : join(nodeDir, 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    pnpmBin: win ? join(nodeDir, 'pnpm.cmd') : join(nodeDir, 'bin', 'pnpm'),
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
