// A local registry substitute serves altered bytes. Real npm must reject the
// download using the integrity from the lock, without consulting new metadata.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { childEnv } from '../src/engine/env.mjs'
import { run } from '../src/engine/proc.mjs'

const npmCli = process.env.npm_execpath
assert.ok(npmCli, 'run this check through npm run check:runtime-lock')
const scratch = await mkdtemp(join(tmpdir(), 'd2f-integrity-'))
let requests = 0
const server = createServer((_req, res) => {
  requests++
  res.end('different bytes returned by the download source')
})
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const manifest = { name: 'd2f-integrity-test', private: true, dependencies: { fixture: '1.0.0' } }
  const lock = JSON.stringify({
    name: manifest.name, lockfileVersion: 3, requires: true,
    packages: {
      '': manifest,
      'node_modules/fixture': {
        version: '1.0.0',
        resolved: `http://127.0.0.1:${server.address().port}/fixture-1.0.0.tgz`,
        integrity: `sha512-${createHash('sha512').update('the original official archive').digest('base64')}`,
      },
    },
  })
  await writeFile(join(scratch, 'package.json'), JSON.stringify(manifest))
  await writeFile(join(scratch, 'package-lock.json'), lock)
  const result = await run(process.execPath, [npmCli, 'ci', '--ignore-scripts', '--no-audit', '--no-fund', '--fetch-retries=0'], {
    cwd: scratch, timeoutMs: 30_000,
    env: childEnv(process.env, { binDir: '', extra: {
      npm_config_cache: join(scratch, 'cache'), npm_config_update_notifier: 'false',
      NO_PROXY: '127.0.0.1', no_proxy: '127.0.0.1',
    } }),
  })
  assert.equal(result.timedOut, false, result.out)
  assert.notEqual(result.code, 0, result.out)
  assert.match(result.out, /EINTEGRITY/, result.out)
  assert.ok(requests > 0, 'the archive must actually be fetched')
  assert.equal(await readFile(join(scratch, 'package-lock.json'), 'utf8'), lock)
  console.log('check-runtime-lock: altered download rejected; pinned lock unchanged')
} finally {
  await new Promise(resolve => server.close(resolve))
  await rm(scratch, { recursive: true, force: true })
}
