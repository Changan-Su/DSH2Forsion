// M0-2:按 Forsion 主窗的 webPreferences(webviewTag + will-attach-webview 剥 preload)嵌 DSH Web
const { app, BrowserWindow, session } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const tokenUrl = process.argv[process.argv.length - 2]
const outDir = process.argv[process.argv.length - 1]
const log = { api: [], guestUrl: null, bodyText: null }
app.whenReady().then(async () => {
  const s = session.fromPartition('persist:dsh2forsion')
  s.webRequest.onCompleted({ urls: ['http://127.0.0.1/*'] }, d => { const u = new URL(d.url); if (u.pathname.startsWith('/api')) log.api.push(d.statusCode + ' ' + u.pathname) })
  const win = new BrowserWindow({ width: 1240, height: 800, show: true, webPreferences: { webviewTag: true, contextIsolation: true, nodeIntegration: false, sandbox: true } })
  win.webContents.on('will-attach-webview', (_e, wp) => { delete wp.preload; wp.nodeIntegration = false; wp.contextIsolation = true; wp.webviewTag = false })
  let guest
  win.webContents.on('did-attach-webview', (_e, wc) => { guest = wc })
  await win.loadFile(path.join(__dirname, 'index.html'), { hash: encodeURIComponent(tokenUrl) })
  await new Promise(r => setTimeout(r, 9000))
  if (guest) {
    log.guestUrl = guest.getURL().replace(/token=[^&]+/, 'token=…')
    log.bodyText = (await guest.executeJavaScript('document.body.innerText')).slice(0, 200).replace(/\s+/g, ' ')
    log.cookies = (await s.cookies.get({})).map(c => `${c.name.slice(0, 12)}… sameSite=${c.sameSite}`)
  }
  const img = await win.webContents.capturePage()
  fs.writeFileSync(path.join(outDir, 'embed-electron-webview.png'), img.toPNG())
  log.apiOk = log.api.filter(a => a.startsWith('2')).length
  log.apiFail = log.api.filter(a => !/^[23]/.test(a)).length
  log.api = [...new Set(log.api)].slice(0, 12)
  log.electron = process.versions.electron
  console.log('RESULT ' + JSON.stringify(log))
  app.quit()
})
