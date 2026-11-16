// 装前体检用（只在试启动的那个 DSH 里加载：node --import 本文件）：记下进程启动以来连过哪些外部主机。
// 写到 DSH2FORSION_TRIAL_NET 指的文件（每行一个主机名），只记名字、不记地址里的路径和参数；本机回环不记。
// 不在桥里做：桥装载得比别的插件晚，插件启动时连的外网会漏掉。
import dns from 'node:dns'
import net from 'node:net'
import { appendFileSync } from 'node:fs'

const file = process.env.DSH2FORSION_TRIAL_NET
if (file) {
  const seen = new Set()
  const local = host => !host || host === 'localhost' || host.endsWith('.localhost') || /^(127\.|::1$|0\.0\.0\.0$|\[::1\]$)/.test(host)
  const note = host => {
    const h = String(host ?? '').trim().toLowerCase()
    if (local(h) || seen.has(h)) return
    seen.add(h)
    try { appendFileSync(file, `${h}\n`) } catch { /* 体检目录被删了：不影响 DSH 本身 */ }
  }
  const lookup = dns.lookup
  dns.lookup = function (hostname, ...rest) { note(hostname); return lookup.call(this, hostname, ...rest) }
  const plookup = dns.promises.lookup
  dns.promises.lookup = function (hostname, ...rest) { note(hostname); return plookup.call(this, hostname, ...rest) }
  const connect = net.Socket.prototype.connect
  net.Socket.prototype.connect = function (...args) {
    const o = args[0]
    const host = Array.isArray(o) ? o[0]?.host : (o && typeof o === 'object' ? o.host : (typeof args[1] === 'string' ? args[1] : undefined))
    if (host && net.isIP(String(host))) note(host)
    return connect.apply(this, args)
  }
}
