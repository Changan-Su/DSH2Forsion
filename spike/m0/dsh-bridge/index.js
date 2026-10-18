// DSH2Forsion M0 桥：装进 sidecar 的 profile，经 DSH 的 webServer 给 Forsion 引擎半身
// 提供「列工具 / 执行工具」两个口。DSH 的插件路由默认没有任何鉴权（webserver README
// 「No server-wide authentication」），所以这里每个请求都要核对启动时注入的密钥。
import { randomUUID, timingSafeEqual } from 'node:crypto'

export const name = 'dsh2forsion-bridge'
export const inject = ['tools', 'webServer']

const PREFIX = '/forsion-bridge'
const MAX_BODY = 1 << 20

export function apply(ctx) {
  const secret = process.env.DSH2FORSION_SECRET ?? ''
  if (secret.length < 32) {
    ctx.logger('dsh2forsion').warn('DSH2FORSION_SECRET missing or too short; bridge routes not mounted')
    return
  }
  // Tangu 批过的调用：callId → 过期时刻。DSH 侧再问审批时只放行这些，其余交给下一个回答方。
  const approved = new Map()
  ctx.on('approval/request', async (req, next) => {
    const until = req.callId === undefined ? undefined : approved.get(req.callId)
    if (until !== undefined && until > Date.now()) {
      approved.delete(req.callId)
      return 'allowed-once'
    }
    return next()
  })
  const dispose = ctx.webServer.register({
    kind: 'prefix',
    path: PREFIX,
    handler: (req, res) => handle(ctx, secret, approved, req, res).catch(error => {
      send(res, 500, { error: String(error?.message ?? error) })
    }),
  })
  ctx.effect(() => dispose)
}

async function handle(ctx, secret, approved, req, res) {
  if (!authorized(req.headers['x-dsh2forsion-secret'], secret)) return send(res, 401, { error: 'unauthorized' })
  const path = new URL(req.url ?? '/', 'http://127.0.0.1').pathname
  if (req.method === 'GET' && path === `${PREFIX}/health`) return send(res, 200, { ok: true })
  if (req.method === 'GET' && path === `${PREFIX}/tools`) return send(res, 200, { tools: ctx.tools.schemas() })
  if (req.method === 'POST' && path === `${PREFIX}/tools/execute`) {
    const body = JSON.parse(await readBody(req))
    const callId = `dsh2forsion-${randomUUID()}`
    if (body.approved === true) approved.set(callId, Date.now() + 60_000)
    const controller = new AbortController()
    // 调用方断开才中止。别挂在 req 的 close 上：新版 Node 里请求体读完就会触发它
    res.once('close', () => { if (!res.writableEnded) controller.abort() })
    const result = await ctx.tools.execute({ callId, name: String(body.name), arguments: body.arguments ?? {}, signal: controller.signal })
    approved.delete(callId)
    return send(res, 200, { callId, result })
  }
  return send(res, 404, { error: 'not found' })
}

function authorized(header, secret) {
  if (typeof header !== 'string') return false
  const a = Buffer.from(header)
  const b = Buffer.from(secret)
  return a.length === b.length && timingSafeEqual(a, b)
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', chunk => {
      size += chunk.length
      if (size > MAX_BODY) { reject(new Error('body too large')); req.destroy(); return }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8') || '{}'))
    req.on('error', reject)
  })
}

function send(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(value))
}
