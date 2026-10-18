// check-sidecar 用：扮演「引擎进程」起一个 sidecar，打印 DSH 的 pid 后一直挂着，等测试把自己强杀。
// 用法：node orphan-parent.mjs <运行时根目录（含 node/ runtime/）> <临时 DSH_HOME> <桥目录>
import { layout } from '../../src/engine/layout.mjs'
import { ensureBridge, ensureProfile } from '../../src/engine/profile.mjs'
import { Sidecar } from '../../src/engine/sidecar.mjs'

const [root, home, bridgeDir] = process.argv.slice(2)
const paths = layout(root)
await ensureProfile(paths, home)
await ensureBridge(paths, home, bridgeDir)
const sc = new Sidecar(paths, { home })
const snap = await sc.start()
console.log(`DSH_PID=${snap.pid}`)
setInterval(() => {}, 1 << 30)
