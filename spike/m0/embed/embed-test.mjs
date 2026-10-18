// M0-2:DSH Web 在「顶层」与「跨站 iframe」两种嵌法下能否完成登录并调通 /api
import http from 'node:http'
import { chromium } from 'playwright-core'
const tokenUrl = process.argv[2]
const outDir = process.argv[3]
const exe = process.argv[4]
const host = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html' })
  res.end(`<!doctype html><title>forsion-like host</title><body style="margin:0"><iframe id="f" src="${tokenUrl}" style="width:1200px;height:760px;border:0"></iframe></body>`)
}).listen(0, 'localhost')
await new Promise(r => host.once('listening', r))
const hostUrl = `http://localhost:${host.address().port}/`
const browser = await chromium.launch({ executablePath: exe })
async function run(label, url) {
  const ctx = await browser.newContext({ viewport: { width: 1240, height: 800 } })
  const page = await ctx.newPage()
  const api = []
  page.on('response', r => { const u = new URL(r.url()); if (u.pathname.startsWith('/api')) api.push(`${r.status()} ${u.pathname}`) })
  const ws = []
  page.on('websocket', w => { ws.push(new URL(w.url()).pathname); w.on('close', () => ws.push('closed ' + new URL(w.url()).pathname)) })
  await page.goto(url, { waitUntil: 'load' })
  await page.waitForTimeout(6000)
  const frames = page.frames().map(f => f.url().replace(/token=[^&]+/, 'token=…'))
  const cookies = (await ctx.cookies()).map(c => `${c.name.slice(0, 12)}… sameSite=${c.sameSite} domain=${c.domain}`)
  const dshFrame = page.frames().find(f => f.url().includes('127.0.0.1'))
  const bodyText = dshFrame ? (await dshFrame.evaluate(() => document.body.innerText).catch(e => 'ERR ' + e.message)).slice(0, 200).replace(/\s+/g, ' ') : ''
  await page.screenshot({ path: `${outDir}/embed-${label}.png` })
  await ctx.close()
  return { label, frames, cookies, api: [...new Set(api)].slice(0, 15), apiFail: api.filter(a => !a.startsWith('2') && !a.startsWith('3')).length, apiOk: api.filter(a => a.startsWith('2')).length, ws, bodyText }
}
const results = [await run('toplevel', tokenUrl), await run('iframe-crosssite', hostUrl)]
console.log(JSON.stringify(results, null, 1))
await browser.close(); host.close()
