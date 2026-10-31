const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

module.exports = async ({ app, win, settings, seed, check, until, shot, shots, restart }) => {
  assert(seed?.popular && seed.skillFile, 'Requires successful popular live scenario seed')
  let page = win
  if (settings !== page) await settings.close()
  const guest = code => page.evaluate(code => document.querySelector('.d2f-space webview').executeJavaScript(code), code)
  const click = (text, selector = 'button,a,[role="tab"]') => guest(`(() => {
    const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find(e => e.textContent.trim() === ${JSON.stringify(text)});
    if (!el) return false; el.click(); return true;
  })()`)
  const present = async () => {
    await until(() => guest('document.readyState === "complete" && document.body.innerText.length > 20'), 'DSH ready', 120_000)
    const preview = await guest(`(() => { const b = [...document.querySelectorAll('button')].find(b => /^(继续|Continue)$/.test(b.textContent.trim())); if (!b) return false; b.click(); return true; })()`)
    const dismiss = () => guest(`(() => { const h = [...document.querySelectorAll('h2')].find(h => /^(开始使用|Get started)$/.test(h.textContent.trim())); const b = h?.closest('[role="dialog"]')?.querySelector('button[aria-label="关闭"],button[aria-label="Close"]'); if (!b) return false; b.click(); return true; })()`)
    if (preview) await until(dismiss, 'dismiss optional DSH account setup', 15_000)
    else await dismiss()
  }
  const board = async () => {
    await present()
    await until(() => guest(`(() => {
      if (document.querySelector('[data-dsh-taskboard-view]')) return true;
      const b = document.querySelector('svg[data-dsh-panel-entry="task-board"]')?.closest('button'); b?.click(); return false;
    })()`), 'open task board')
    await until(() => guest(`document.querySelector('[data-dsh-taskboard-view]')?.innerText.includes(${JSON.stringify(seed.marker)})`), 'research task in board')
    await guest(`(() => {
      const card = [...document.querySelectorAll('article[data-dsh-part="card"]')].find(e => e.querySelector('[data-dsh-part="card-title"]')?.textContent.trim() === ${JSON.stringify(seed.marker)});
      card?.querySelector('button[data-dsh-part="card-open"]')?.click();
    })()`)
    await until(() => guest(`document.querySelector('[role="dialog"]')?.innerText.includes(${JSON.stringify(seed.description)})`), 'saved review notes in task detail')
    check('联网资料形成的任务及重启后模型修改的描述显示在真实看板', true)
    await shot(page, 'popular-01-task-review')
    await guest(`document.querySelector('[role="dialog"] button[aria-label="关闭"], [role="dialog"] button[aria-label="Close"]')?.click()`)
  }
  await board()
  await present()
  await until(() => guest(`(() => {
    const items = [...document.querySelectorAll('button,[role="menuitem"]')];
    const settings = items.find(b => /^(设置|Settings)$/.test(b.getAttribute('aria-label') || b.title || b.textContent.trim()));
    if (settings) { settings.click(); return true; }
    items.find(b => /^(更多|More)$/.test(b.getAttribute('aria-label') || b.title || b.textContent.trim()))?.click();
    return false;
  })()`), 'open DSH settings from More')
  await until(() => guest(`(() => { const b = document.querySelector('[role="dialog"] nav button[data-dssm-nav-icon]'); if (!b) return false; b.click(); return true; })()`), 'open skill manager settings')
  await until(() => guest(`!!document.querySelector('.dssm-section')`), 'skill manager rendered')
  await guest(`(() => {
    document.querySelector('#dssm-tab-user')?.click();
    const input = document.querySelector('input.dssm-search');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(seed.skillName)});
    input.dispatchEvent(new Event('input', {bubbles:true}));
  })()`)
  await until(() => guest(`document.querySelector('.dssm-section')?.innerText.includes(${JSON.stringify(seed.skillName)})`), 'model-created skill listed')
  // Scope to DSH skills; other providers' skill sources are not part of this test.
  await guest(`(() => {
    const row = [...document.querySelectorAll('section[data-source-key="dsh"] .dssm-skill-row')].find(e => e.querySelector('.dssm-name')?.textContent.trim() === ${JSON.stringify(seed.skillName)});
    const b = [...(row?.querySelectorAll('button') || [])].find(b => /^(更多|More)$/.test(b.getAttribute('aria-label') || b.title || b.textContent.trim())); b?.click();
  })()`)
  await until(async () => await click('查看详情', 'button,[role="menuitem"]') || await click('View details', 'button,[role="menuitem"]'), 'open skill details')
  await until(() => guest(`document.querySelector('textarea.dssm-detail-body')?.value.includes(${JSON.stringify(seed.skillMarker)})`), 'skill Markdown visible')
  check('真实模型创建的技能在 DSH 技能页显示完整检查清单', true)
  await shot(page, 'popular-02-skill-checklist')
  // Register only the isolated fixture directory through DSH's public API.
  const registered = await guest(`(async () => {
    const method = 'workspace/create';
    const res = await fetch('/api/' + method, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:'client-request',rpcId:'d2f-gui-workspace',method,payload:{args:{path:${JSON.stringify(seed.workspace)}}}})});
    return res.json();
  })()`)
  assert.equal(registered.result?.ok, true, JSON.stringify(registered))
  await page.evaluate(() => document.querySelector('.d2f-space webview').reload())
  await present()
  await until(() => guest(`(() => {
    const b = [...document.querySelectorAll('button')].find(b => /(?:New session in workspace|在“workspace”中新建会话)/.test(b.getAttribute('aria-label') || ''));
    if (!b) return false; b.click(); return true;
  })()`), 'new DSH session in fixture repository')
  await until(() => guest(`document.querySelector('[data-gitgraph-chip-anchor]')?.innerText.includes('main')`), 'git branch chip for fixture')
  await guest(`document.querySelector('[data-gitgraph-chip-anchor] button')?.click()`)
  await until(async () => await click('Git Graph') || await click('Git 图谱') || await click('Git 图'), 'open git graph')
  await until(() => guest(`document.querySelector('[role="dialog"]')?.innerText.includes(${JSON.stringify(seed.gitMessage)})`), 'actual commit in graph')
  check('Git Graph 显示隔离项目的真实发布检查提交', true)
  await shot(page, 'popular-03-git-history')
  await guest(`document.querySelector('[role="dialog"] button[aria-label="关闭"], [role="dialog"] button[aria-label="Close"]')?.click()`)
  await guest(`document.querySelector('[data-gitgraph-chip-anchor] button')?.click()`)
  await until(() => guest(`(() => { const b = [...document.querySelectorAll('[data-gitgraph-popover] button[role="option"]')].find(b => b.getAttribute('aria-label') === ${JSON.stringify(seed.gitBranch)}); if (!b) return false; b.click(); return true; })()`), 'select review branch')
  await until(() => execFileSync('git', ['branch', '--show-current'], { cwd: seed.workspace, encoding: 'utf8', windowsHide: true }).trim() === seed.gitBranch, 'actual git branch switched')
  check('Git Graph 界面切换分支并由磁盘 Git HEAD 独立核对', true)
  await shot(page, 'popular-04-git-branch')
  fs.writeFileSync(path.join(shots, 'popular-evidence.json'), JSON.stringify({ packages: seed.packages, task: seed.marker, skill: seed.skillName, gitHead: seed.gitHead, gitBranch: seed.gitBranch }, null, 2))
  const reopened = await restart(); app = reopened.app; page = reopened.page
  await page.getByRole('button', { name: /^DSH(?:\s|$)/ }).first().click()
  await board()
  assert.ok(fs.readFileSync(seed.skillFile, 'utf8').includes(seed.skillMarker))
  assert.equal(execFileSync('git', ['branch', '--show-current'], { cwd: seed.workspace, encoding: 'utf8', windowsHide: true }).trim(), seed.gitBranch)
  check('整个 Forsion 重启后任务、技能文件与 Git 分支保留', true)
}
