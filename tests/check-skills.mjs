import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { managedSkills } from '../src/dsh-bridge/skills.js'

const home = await mkdtemp(join(tmpdir(), 'd2f-skills-'))
try {
  const dir = join(home, 'skills', 'release-review'), outside = join(home, 'other-cli')
  await mkdir(dir, { recursive: true }); await mkdir(outside)
  for (const root of [dir, outside]) await writeFile(join(root, 'SKILL.md'), '# marker')
  const skill = { name: 'release-review', description: 'Review releases', content: 'Evidence marker', invocation: { modelInvocable: true, userInvocable: true }, resourceBase: { kind: 'directory', path: dir }, path: join(dir, 'SKILL.md') }
  let definition = skill
  const ctx = { get: () => ({ list: async () => [skill], get: async () => definition }) }
  assert.equal((await managedSkills(ctx, home))[0].content, 'Evidence marker')
  definition = { ...skill, invocation: { modelInvocable: false } }
  assert.deepEqual(await managedSkills(ctx, home), [], 'fresh invocation policy beats stale summary')
  definition = { ...skill, resourceBase: { kind: 'directory', path: outside }, path: join(outside, 'SKILL.md') }
  assert.deepEqual(await managedSkills(ctx, home), [], 'other CLI roots are not imported')
  definition = { ...skill, path: join(outside, 'SKILL.md') }
  assert.deepEqual(await managedSkills(ctx, home), [], 'instruction file must be within the resource directory')
  definition = skill
  await rm(join(dir, 'SKILL.md'))
  assert.deepEqual(await managedSkills(ctx, home), [], 'deleted file cannot survive a stale registry entry')
  const controller = new AbortController(); controller.abort()
  await assert.rejects(managedSkills(ctx, home, controller.signal))
  console.log('check-skills: 6 source ownership, policy, deletion and cancellation checks passed')
} finally { await rm(home, { recursive: true, force: true }) }
