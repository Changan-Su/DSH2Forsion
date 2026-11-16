// 右栏页（第 2 档）的回报：Forsion 右栏里开着的 DSH 页（client.js 的右栏模式）做没做成，报回这里，Forsion 那半来取。
//
// 网页拿不到桥的启动密钥（也不该拿到），所以这一个口子凭口令：引擎半身（带密钥）先要一个口令，放进右栏页地址的 # 里，
// 网页凭它把回报 POST 回来；口令只能用来写这一份回报，读回报仍要密钥。口令随机、限量、过期作废。
import { randomBytes } from 'node:crypto'

const STATES = new Set(['ok', 'missing', 'incompatible', 'no-session', 'failed'])
const MAX_NONCES = 32
const NONCE_TTL_MS = 24 * 60 * 60_000 // 右栏页能开一整天；过期的那一页报不回来，Forsion 那半会重新要一个
const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '')

/** 网页报回来的东西只留这几项，长度都截住（网页是 DSH 和它装的插件在跑，不全信）。 */
export function cleanRailReport(body) {
  if (!body || typeof body !== 'object') return null
  const state = str(body.state, 32)
  if (!STATES.has(state)) return null
  const pages = Array.isArray(body.pages)
    ? body.pages.slice(0, 64).filter(p => p && typeof p.kind === 'string' && p.kind).map(p => ({ kind: str(p.kind, 200), title: str(p.title, 120) || str(p.kind, 120) }))
    : []
  return {
    state, kind: str(body.kind, 200), session: str(body.session, 200), n: str(body.n, 40), reason: str(body.reason, 400), pages,
    covering: body.covering === true, width: Number.isFinite(body.width) ? Math.max(0, Math.min(100_000, Math.round(body.width))) : 0,
  }
}

export function createRailReports({ now = () => Date.now(), ttlMs = NONCE_TTL_MS, max = MAX_NONCES } = {}) {
  const nonces = new Map() // 口令 → { created, report, at }
  const prune = () => {
    const t = now()
    for (const [k, v] of nonces) if (t - v.created > ttlMs) nonces.delete(k)
    while (nonces.size > max) nonces.delete(nonces.keys().next().value)
  }
  return {
    issue() {
      prune()
      const nonce = randomBytes(18).toString('hex')
      nonces.set(nonce, { created: now(), report: null, at: 0 })
      prune()
      return nonce
    },
    /** 网页凭口令写回报。口令不认识 / 过期 / 内容不像回报 → false。 */
    accept(nonce, body) {
      prune()
      const entry = typeof nonce === 'string' ? nonces.get(nonce) : undefined
      const report = entry ? cleanRailReport(body) : null
      if (!entry || !report) return false
      entry.report = report
      entry.at = now()
      return true
    },
    get(nonce) {
      prune()
      const entry = typeof nonce === 'string' ? nonces.get(nonce) : undefined
      return entry ? { known: true, report: entry.report, at: entry.at } : { known: false, report: null, at: 0 }
    },
  }
}
