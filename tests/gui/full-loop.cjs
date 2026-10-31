// Full acceptance on a real Electron window. Seed with check-live.mjs's gui-seed.json
// to verify that a task created by a real model is the task rendered in DSH.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

module.exports = async ({ app, win, settings, home, seed, check, until, shot, shots, restart }) => {
  assert(seed?.marker, 'Full GUI acceptance requires DSH2FORSION_GUI_SEED from test:live')
  let page = win
  const guest = code => page.evaluate(code => {
    const view = document.querySelector('.d2f-space webview')
    if (!view) throw new Error('DSH webview is not mounted')
    return view.executeJavaScript(code)
  }, code)
  const api = (route, body) => page.evaluate(async ({ route, body }) => {
    const config = await window.tangu.getConfig()
    const res = await fetch(config.backendUrl + route, { method: body === undefined ? 'GET' : 'POST', headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    const value = await res.json()
    if (!res.ok) throw new Error(`${route}: ${res.status} ${JSON.stringify(value)}`)
    return value
  }, { route, body })
  const prefix = '/extensions/dsh2forsion/dsh2forsion'
  const present = async () => {
    await until(() => guest('document.readyState === "complete" && document.body.innerText.length > 20'), 'DSH webview ready', 120_000)
    const preview = await guest(`(() => { const b = [...document.querySelectorAll('button')].find(b => /^(继续|Continue)$/.test(b.textContent.trim())); if (!b) return false; b.click(); return true; })()`)
    const dismissAccount = () => guest(`(() => {
      const h = [...document.querySelectorAll('h2')].find(h => /^(开始使用|Get started)$/.test(h.textContent.trim()));
      const b = h?.closest('[role="dialog"]')?.querySelector('button[aria-label="关闭"],button[aria-label="Close"]');
      if (!b) return false; b.click(); return true;
    })()`)
    if (preview) await until(dismissAccount, 'dismiss optional DSH account setup', 15_000)
    else await dismissAccount()
  }
  const clickGuestText = text => guest(`(() => {
    const el = [...document.querySelectorAll('button,a,[role="tab"]')].find(e => e.textContent.trim() === ${JSON.stringify(text)});
    if (!el) return false; el.click(); return true;
  })()`)
  const board = async () => {
    await present()
    await until(() => guest(`(() => {
      const icon = document.querySelector('svg[data-dsh-panel-entry="task-board"]');
      const button = icon?.closest('button') || [...document.querySelectorAll('button')].find(b => /^(Task Board|任务看板)$/.test(b.textContent.trim()));
      if (!button) return false; button.click(); return true;
    })()`), 'Task Board navigation')
    await until(() => guest(`document.querySelector('[data-dsh-taskboard-view]')?.innerText.includes(${JSON.stringify(seed.marker)})`), 'model-created task rendered')
    const content = await guest(`(() => {
      const card = [...document.querySelectorAll('article[data-dsh-part="card"]')].find(e => e.querySelector('[data-dsh-part="card-title"]')?.textContent.trim() === ${JSON.stringify(seed.marker)});
      card?.querySelector('button[data-dsh-part="card-open"]')?.click();
      return card?.innerText || '';
    })()`)
    assert.ok(content.includes(seed.marker))
    await until(() => guest(`document.querySelector('[role="dialog"]')?.innerText.includes(${JSON.stringify(seed.description)})`), 'saved description in task detail')
    check('真实模型写入的任务和描述显示在 DSH 任务看板', true)
    await shot(page, '07-real-task-detail')
    await guest(`(() => { const d = document.querySelector('[role="dialog"]'); const b = d && [...d.querySelectorAll('button')].find(b => /close|关闭/i.test(b.getAttribute('aria-label') || b.title || b.textContent)); b?.click(); })()`)
  }
  if (settings !== page) await settings.close()
  await page.bringToFront()
  await board()

  await until(async () => (await clickGuestText('插件')) || (await clickGuestText('Plugins')), 'DSH Plugins navigation')
  await until(() => guest(`(() => {
    const heading = [...document.querySelectorAll('h2')].find(h => /^(开始使用|Get started)$/.test(h.textContent.trim()));
    const dialog = heading?.closest('[role="dialog"]');
    if (dialog) [...dialog.querySelectorAll('button')].find(b => /^(关闭|Close)$/.test(b.getAttribute('aria-label') || ''))?.click();
    const card = document.querySelector('[data-plugin-package="dsh-trae-skin"]');
    const button = card?.querySelector('button[aria-describedby]');
    if (!button) return false; button.scrollIntoView({ block: 'center' }); button.click(); return true;
  })()`), 'open Trae skin configuration card')
  await until(() => guest(`!!document.querySelector('[data-plugin-config="dsh-trae-skin"]')`), 'Trae skin config')
  const wordmark = 'D2F GUI acceptance'
  await guest(`(() => {
    const root = document.querySelector('[data-plugin-config="dsh-trae-skin"] .dshTraeGrid');
    const select = root.querySelector('select');
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, 'light');
    select.dispatchEvent(new Event('change', { bubbles: true }));
    const inputs = root.querySelectorAll('input[type="text"]');
    for (const [i, value] of [[0, '#ff6600'], [1, ${JSON.stringify(wordmark)}]]) {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(inputs[i], value);
      inputs[i].dispatchEvent(new Event('input', { bubbles: true }));
      inputs[i].dispatchEvent(new Event('change', { bubbles: true }));
    }
  })()`)
  await until(() => guest(`(() => { const b = document.querySelector('[data-plugin-config="dsh-trae-skin"] .dshTraeFoot button[data-variant="primary"]'); if (!b || b.disabled) return false; b.click(); return true; })()`), 'save skin settings')
  const skinSaved = () => guest(`document.body.dataset.dshTraeScheme === 'light' && document.querySelector('.dsh-trae-strip-mark')?.textContent.trim() === ${JSON.stringify(wordmark)}`)
  await until(skinSaved, 'skin visibly applied')
  check('第三方皮肤保存后实际变色并显示新字标', true)
  await shot(page, '08-skin-saved')
  await guest('location.reload()').catch(() => {})
  await present()
  await until(skinSaved, 'skin survives reload')
  check('第三方皮肤设置刷新后保留', true)

  // Use the actual language control in About; the plugin and guest must follow.
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('forsion:open-settings', { detail: 'about' })))
  const about = await until(async () => {
    for (const p of app.windows()) if (await p.locator('.locale-seg').count().catch(() => 0)) return p
    return null
  }, 'language controls')
  await about.locator('.locale-seg button').nth(1).click()
  await until(() => guest(`[...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Plugins') && ![...document.querySelectorAll('button')].some(b => b.textContent.trim() === '插件')`), 'DSH switches to English')
  check('切换英文后 DSH 网页语言同步', true)
  if (about !== page) await about.close()
  await shot(page, '09-dsh-english')

  if (process.env.DSH2FORSION_GUI_LIVE === '1') {
    const tool = 'dsh__acceptance_probe', marker = `D2F-GUI-${Date.now()}`
    const config = { execMode: 'host', cwd: seed.workspace, approvalMode: 'full-auto', toolsStrict: true, toolsMode: 'allow', toolsList: [tool], enabledMcpServers: [], thinkingLevel: 'low' }
    const session = (await api('/agent/sessions', { title: 'D2F GUI model approval', model_id: seed.model, project_path: seed.workspace, agent_config: config })).session
    const windowHandle = await app.browserWindow(page)
    await windowHandle.evaluate((window, id) => window.webContents.send('app:deep-link', `forsion://session/${id}`), session.id)
    const composer = page.locator('.t2c-ta:visible').last()
    await composer.waitFor({ timeout: 30_000 })
    await until(() => composer.isEnabled(), 'real chat input enabled')
    const requests = []
    let refusedModel = false
    const guardModel = async route => {
      const request = route.request()
      if (request.method() === 'POST' && request.postDataJSON()?.model_id !== seed.model) {
        refusedModel = true
        return route.abort('blockedbyclient')
      }
      return route.continue()
    }
    await page.route('**/agent/runs', guardModel)
    const observe = r => { if (r.method() === 'POST' && /\/agent\/runs$/.test(new URL(r.url()).pathname)) requests.push(r.postDataJSON()) }
    page.on('request', observe)
    await composer.fill(`Call ${tool} exactly once with marker "${marker}" and waitMs 0. Report the returned marker. Do not use other tools.`)
    await composer.press('Enter')
    const approval = page.locator('.approval-card:not(.resolved)').filter({ hasText: tool }).last()
    await approval.waitFor({ timeout: 180_000 })
    assert.equal(refusedModel, false, 'only the designated real model may be called')
    const ledger = path.join(seed.workspace, 'dsh-probe.jsonl')
    assert.ok(!fs.readFileSync(ledger, 'utf8').includes(marker), 'tool has not run before clicking approval')
    await shot(page, '10-model-approval-pending')
    await approval.locator('.approval-actions button.primary').click()
    await until(() => fs.readFileSync(ledger, 'utf8').split('\n').some(l => l.includes(marker) && l.includes('finished')), 'GUI-approved tool finishes')
    // A marker in the user's prompt or tool arguments is not a returned result.
    const group = page.locator('.tool-group').last()
    await group.waitFor()
    if (await group.locator('.tool-group-head').getAttribute('aria-expanded') !== 'true') await group.locator('.tool-group-head').click()
    const row = group.locator('.tool-row').filter({ hasText: tool }).last()
    await row.waitFor()
    if (await row.locator('.tool-row-head').getAttribute('aria-expanded') !== 'true') await row.locator('.tool-row-head').click()
    await until(async () => {
      const result = await row.locator('.tool-card-body').evaluate(body => {
        const label = [...body.querySelectorAll('.label')].find(el => /^(Result|结果)$/i.test(el.textContent.trim()))
        let text = ''
        for (let node = label?.nextSibling; node; node = node.nextSibling) text += node.textContent
        return text
      })
      try { const value = JSON.parse(result); return value.marker === marker && value.completed === true && value.cwd.toLowerCase() === seed.workspace.toLowerCase() } catch { return false }
    }, 'actual tool result in conversation')
    page.off('request', observe)
    await page.unroute('**/agent/runs', guardModel)
    assert.ok(requests.some(r => r.session_id === session.id && r.model_id === seed.model), 'UI sent the selected real model and session')
    check('真实聊天发送、审批卡点击、DSH 执行和结果回显贯通', true)
    await shot(page, '11-model-tool-result')
    fs.writeFileSync(path.join(shots, 'gui-model-evidence.json'), JSON.stringify({ sessionId: session.id, marker, model: seed.model, approvedFromUI: true }))
  }

  // Reopen the real app using the same isolated home, then verify the saved data.
  ;({ app, page } = await restart())
  const dsh = await until(async () => {
    const selector = '[data-space-id="dsh2forsion-dsh"]:visible'
    if (!(await page.locator(selector).count())) await page.locator('.rb-more[data-rb-more="top"]:visible').first().click().catch(() => {})
    const button = page.locator(selector).first()
    return (await button.count()) ? button : null
  }, 'DSH after restart')
  await dsh.click()
  await present()
  await until(skinSaved, 'skin survives app restart')
  await board()
  check('整个 Forsion 重启后任务数据和皮肤设置保留', true)

  await page.evaluate(() => window.dispatchEvent(new CustomEvent('forsion:open-settings', { detail: 'fplugin:dsh2forsion' })))
  const managerPage = await until(async () => {
    for (const p of app.windows()) if (await p.locator('.d2f-manage').count().catch(() => 0)) return p
    return null
  }, 'plugin manager after restart')
  const manage = managerPage.locator('.d2f-manage')
  const skinRow = manage.locator('.d2f-item').filter({ hasText: /trae/i }).first()
  await skinRow.locator('button.danger').click()
  await until(async () => !(await api(prefix + '/plugins')).plugins.some(p => p.name === 'dsh-trae-skin'), 'skin removed', 180_000)
  await present()
  await until(() => guest(`!document.body.hasAttribute('data-dsh-trae')`), 'skin effect removed', 120_000)
  check('管理页移除皮肤后插件与视觉效果一起消失', true)
  await manage.getByRole('button', { name: /Undo the last change|撤销上一次改动/ }).click()
  await until(async () => (await api(prefix + '/plugins')).plugins.some(p => p.name === 'dsh-trae-skin'), 'skin restored', 180_000)
  await until(skinSaved, 'skin settings restored', 120_000)
  check('管理页回滚恢复插件及原设置', true)
  await shot(page, '12-rollback-restored')
}
