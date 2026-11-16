import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'

export async function runScenarios({ api, prefix, run, test, out, shared, until }) {
  const name = `native-review-${randomUUID().slice(0, 8)}`
  const marker = `native-loaded-${randomUUID()}`
  const id = `local:plugin/dsh2forsion/dsh/${name}`
  const file = join(shared, 'tangu/plugin-data/dsh2forsion/home/skills', name, 'SKILL.md')
  const list = async () => (await api('/agent/skills')).skills
  const visible = async () => (await list()).find(s => s.id === id)
  let raw
  await test('dshnative_create', 'Real model creates a DSH skill that appears in the native Tangu skill list', async row => {
    assert.equal((await api(prefix + '/status')).nativeSkills.supported, true, 'Requires a host with registerSkillProvider')
    const trace = await run('native-create', `Use create_skill to create "${name}" with description "Verify native Tangu skill loading" and a body containing exactly this instruction: "When this skill is used, reply with ${marker} and state that native use_skill loaded these instructions."`, ['dsh__create_skill'])
    assert.ok(trace.results.some(r => r.name === 'dsh__create_skill' && !r.isError))
    raw = readFileSync(file, 'utf8'); assert.ok(raw.includes(marker))
    const found = await until(visible, 'DSH skill in native catalog', 20_000)
    assert.equal(found.source, 'plugin')
    row.output = JSON.stringify(found)
    writeFileSync(join(out, 'native-skill-evidence.json'), JSON.stringify({ id, file, raw, catalog: found }, null, 2))
  })
  await test('dshnative_use', 'A fresh Tangu conversation loads and follows the DSH skill through native use_skill', async row => {
    // The marker is deliberately absent from this conversation's prompt.
    const trace = await run('native-use', `Load the skill with id "${id}" using use_skill, then follow its instructions.`, ['use_skill'])
    assert.ok(trace.results.some(r => r.name === 'use_skill' && !r.isError && String(r.result).includes(marker)))
    assert.ok(trace.content.includes(marker))
    assert.ok(trace.calls.every(c => c.name === 'use_skill'))
    row.output = trace.content
  })
  await test('dshnative_lifecycle', 'Source policy, name collisions, restart and plugin disable keep native skills authoritative', async row => {
    const userDir = join(shared, 'tangu/skills', name)
    mkdirSync(userDir, { recursive: true })
    writeFileSync(join(userDir, 'SKILL.md'), `---\nname: ${name}\ndescription: User-owned collision\n---\nKeep my user skill.`)
    const both = await list()
    assert.ok(both.some(s => s.id === `local:${name}`)); assert.ok(both.some(s => s.id === id))
    writeFileSync(file, raw.replace(/^---\r?\n/, '---\ndisable-model-invocation: true\n'))
    assert.equal(await visible(), undefined)
    writeFileSync(file, raw)
    await until(visible, 'skill re-enabled at source', 20_000)
    await api(prefix + '/sidecar/restart', {})
    assert.ok(await visible())
    await api('/agent/plugins/dsh2forsion/enabled', { enabled: false }, 'PUT')
    assert.equal(await visible(), undefined)
    assert.ok((await list()).some(s => s.id === `local:${name}`))
    await api('/agent/plugins/dsh2forsion/enabled', { enabled: true }, 'PUT')
    await until(async () => (await api(prefix + '/status')).sidecar.state === 'running', 'DSH restarted after enable')
    await until(visible, 'provider registered again', 20_000)
    unlinkSync(file)
    assert.equal(await visible(), undefined)
    row.output = 'Native provider policy, namespace isolation, DSH restart, disable/re-enable and source deletion verified.'
  })
}
