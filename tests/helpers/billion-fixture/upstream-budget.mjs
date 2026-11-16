// Test-only upstream ceiling, imported before Billion in DSH and by its proxy child.
// Captures request bodies only: never authorization/account headers or tokens.
const marker = Symbol.for('dsh2forsion.billion.fixture-budget')
if (!globalThis[marker]) {
  globalThis[marker] = true
  const original = globalThis.fetch
  globalThis.fetch = async (input, init) => {
    const rawUrl = typeof input === 'string' || input instanceof URL ? String(input) : input.url
    const url = new URL(rawUrl)
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET')
    if (url.origin === 'https://chatgpt.com' && url.pathname.startsWith('/backend-api/codex/') && method.toUpperCase() !== 'GET') {
      const body = typeof init?.body === 'string' ? init.body : input instanceof Request ? await input.clone().text() : undefined
      const scrub = (key, value) => /encrypted_content/i.test(key) && typeof value === 'string' ? `[redacted encrypted replay: ${value.length} characters]` : value
      const payload = body === undefined ? null : JSON.parse(JSON.stringify(JSON.parse(body), scrub))
      const grant = await original(process.env.BILI_FIXTURE_BUDGET_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pid: process.pid, origin: url.origin, pathname: url.pathname, payload }), signal: init?.signal })
      if (!grant.ok) return new Response(JSON.stringify({ error: { message: 'Original local acceptance fixture exhausted its configured upstream budget' } }), { status: 429, headers: { 'content-type': 'application/json' } })
    }
    return original(input, init)
  }
}
