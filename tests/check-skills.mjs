import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm, symlink, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { managedSkills } from '../src/dsh-bridge/skills.js'

const scratch = await mkdtemp(join(tmpdir(), 'd2f-skills-'))
const home = join(scratch, 'home')
const policy = { modelInvocable: true, userInvocable: true }
async function fixture(dir, content = 'Evidence marker', name = 'release-review') {
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'SKILL.md'), '# marker')
  return { name, description: 'Review releases', content, invocation: policy, resourceBase: { kind: 'directory', path: dir }, path: join(dir, 'SKILL.md') }
}
try {
  const dir = join(home, 'skills', 'release-review'), outside = join(home, 'other-cli')
  const skill = await fixture(dir)
  await fixture(outside)
  let definition = skill
  const ctx = { get: () => ({ list: async () => [skill], get: async () => definition }) }
  assert.equal((await managedSkills(ctx, home))[0].content, 'Evidence marker')
  assert.equal((await managedSkills(ctx, home))[0].id, 'release-review', 'existing managed IDs stay stable')
  definition = { ...skill, invocation: { modelInvocable: false } }
  assert.deepEqual(await managedSkills(ctx, home), [], 'fresh invocation policy beats stale summary')
  definition = { ...skill, resourceBase: { kind: 'directory', path: outside }, path: join(outside, 'SKILL.md') }
  assert.deepEqual(await managedSkills(ctx, home), [], 'other CLI roots are not imported')
  definition = { ...skill, path: join(outside, 'SKILL.md') }
  assert.deepEqual(await managedSkills(ctx, home), [], 'instruction file must be within resource directory')
  definition = skill
  await rm(join(dir, 'SKILL.md'))
  assert.deepEqual(await managedSkills(ctx, home), [], 'deleted file cannot survive stale registry entry')
  await writeFile(join(dir, 'SKILL.md'), '# marker')
  const controller = new AbortController(); controller.abort()
  await assert.rejects(managedSkills(ctx, home, controller.signal))

  const a = join(scratch, 'a'), b = join(scratch, 'b')
  await mkdir(join(a, '.git'), { recursive: true })
  await mkdir(b, { recursive: true }); await writeFile(join(b, '.git'), 'gitdir: external-worktree')
  const nested = join(a, 'src', 'nested'); await mkdir(nested, { recursive: true })
  const pa = await fixture(join(a, '.dsh', 'skills', 'release-review'), 'Project A')
  const pb = await fixture(join(b, '.agents', 'skills', 'release-review'), 'Project B')
  let currentA = pa, currentB = pb
  let seenCwd
  const projects = { get: () => ({
    list: async options => { seenCwd = options.cwd; return [options.cwd ? (options.cwd.startsWith(a) ? pa : pb) : skill] },
    get: async (_name, options) => options.cwd ? (options.cwd.startsWith(a) ? currentA : currentB) : skill,
  }) }
  const listA = await managedSkills(projects, home, undefined, { cwd: nested })
  assert.equal(seenCwd, nested, 'pass original cwd to official registry discovery')
  assert.deepEqual(listA.map(s => s.content), ['Evidence marker', 'Project A'])
  assert.equal(listA[0].id, 'release-review')
  assert.equal(listA[1].source, 'project-dsh')
  const listB = await managedSkills(projects, home, undefined, { cwd: b })
  assert.notEqual(listA[1].id, listB[1].id, 'same name is isolated between workspaces')
  assert.equal(listB[1].source, 'project-agents')
  assert.equal((await managedSkills(projects, home, undefined, { cwd: a }))[1].id, listA[1].id, 'nested cwd shares nearest git project identity')
  assert.ok(listA[1].id.length <= 64 && /^[a-z0-9][a-z0-9-]*$/.test(listA[1].id))
  currentA = { ...pa, invocation: { modelInvocable: false } }
  assert.equal((await managedSkills(projects, home, undefined, { cwd: a })).length, 1, 'fresh project disable is respected')
  currentA = undefined
  assert.equal((await managedSkills(projects, home, undefined, { cwd: a })).length, 1, 'missing definition is withdrawn')
  currentA = pa
  await rm(pa.path)
  assert.equal((await managedSkills(projects, home, undefined, { cwd: a })).length, 1, 'deleted project file is withdrawn')
  await writeFile(pa.path, '# marker')
  currentA = { ...pa, resourceBase: { kind: 'url', url: 'https://example.invalid/skill' } }
  assert.equal((await managedSkills(projects, home, undefined, { cwd: a })).length, 1, 'remote skill is never represented as local')
  currentA = { ...pb }
  assert.equal((await managedSkills(projects, home, undefined, { cwd: a })).length, 1, 'other workspace path is rejected')
  currentA = pa
  for (const cwd of ['relative', '', 123, join(scratch, 'missing'), skill.path]) {
    await assert.rejects(managedSkills(projects, home, undefined, { cwd }), undefined, 'invalid cwd must not fall back')
  }
  // No git marker means exactly cwd, matching the official provider fallback.
  const bare = join(scratch, 'bare')
  const bareSkill = await fixture(join(bare, '.agents', 'skills', 'bare'), 'No git', 'bare')
  const bareCtx = { get: () => ({ list: async o => o.cwd ? [bareSkill] : [], get: async () => bareSkill }) }
  assert.equal((await managedSkills(bareCtx, home, undefined, { cwd: bare }))[0].content, 'No git')

  const escape = join(scratch, 'escape')
  await mkdir(join(escape, '.git'), { recursive: true })
  await mkdir(join(escape, '.dsh'), { recursive: true })
  await symlink(await realpath(join(a, '.dsh', 'skills')), join(escape, '.dsh', 'skills'), process.platform === 'win32' ? 'junction' : 'dir')
  const escapeCtx = { get: () => ({ list: async o => o.cwd ? [pa] : [], get: async () => pa }) }
  assert.deepEqual(await managedSkills(escapeCtx, home, undefined, { cwd: escape }), [], 'symlink skill root cannot escape selected project')
  const linked = join(a, '.agents', 'skills')
  await mkdir(linked, { recursive: true })
  await symlink(await realpath(outside), join(linked, 'outside'), process.platform === 'win32' ? 'junction' : 'dir')
  currentA = { ...pa, resourceBase: { kind: 'directory', path: join(linked, 'outside') }, path: join(linked, 'outside', 'SKILL.md') }
  assert.equal((await managedSkills(projects, home, undefined, { cwd: a })).length, 1, 'symlink entry cannot escape approved root')
  currentA = pa
  const during = new AbortController()
  const cancelCtx = { get: () => ({ list: async () => { during.abort(); return [skill] }, get: async () => skill }) }
  await assert.rejects(managedSkills(cancelCtx, home, during.signal), undefined, 'cancellation after asynchronous discovery is respected')
  console.log('check-skills: managed identity, two projects, nearest git/worktree/no-git roots, policy, deletion, invalid cwd, remote/path/symlink escapes and cancellation passed')
} finally { await rm(scratch, { recursive: true, force: true }) }
