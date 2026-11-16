// Useful workflows with published community plugins, the real Tangu loader and GPT 6 Luna.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const packages = [
  'dsh-free-search@0.9.26',
  '@michengai/dsh-skills-manager@1.2.24',
  '@linxin666/dsh-client-ui-task-board@0.4.7',
  '@linxin666/dsh-client-ui-git-graph@0.4.7',
]

export async function runScenarios({ api, prefix, run, test, out, shared, workspace, model }) {
  const suffix = randomUUID().slice(0, 8)
  const marker = `DSH release review ${suffix}`
  const skillName = `dsh-release-review-${suffix}`
  const description = `Verify plugin compatibility with DSH 0.2.1-rc.2. Evidence ${suffix}.`
  const seed = { shared, workspace, model, marker, description, skillName, packages, popular: true }
  const saveSeed = () => writeFileSync(join(out, 'gui-seed.json'), JSON.stringify(seed, null, 2))
  saveSeed()
  const git = (...args) => execFileSync('git', args, { cwd: workspace, encoding: 'utf8', windowsHide: true }).trim()
  git('init', '-b', 'main')
  git('config', 'user.name', 'DSH acceptance')
  git('config', 'user.email', 'acceptance@example.invalid')
  writeFileSync(join(workspace, 'README.md'), '# DSH release review\n\nVerify the runtime and community plugin compatibility.\n')
  git('add', 'README.md'); git('commit', '-m', `Initialize release review ${suffix}`)
  mkdirSync(join(workspace, 'docs'), { recursive: true })
  writeFileSync(join(workspace, 'docs/release-checklist.md'), `# Release checklist\n\n${description}\n\n- Check npm package metadata\n- Verify tool approvals\n- Restart and check persistence\n`)
  git('add', 'docs/release-checklist.md'); git('commit', '-m', `Add release checklist ${suffix}`)
  seed.gitHead = git('rev-parse', 'HEAD')
  seed.gitMessage = `Add release checklist ${suffix}`
  seed.gitBranch = `review/${suffix}`
  git('branch', seed.gitBranch)
  saveSeed()

  const status = await api(prefix + '/status')
  writeFileSync(join(out, 'plugins-evidence.json'), JSON.stringify({ packages, tools: status.tools }, null, 2))
  await test('dshpopular_research', 'Research an npm package and turn the source into a persistent review task', async row => {
    const tools = ['dsh__platform_search', 'dsh__task_board_create', 'dsh__task_board_get']
    const trace = await run('popular-research', `Use platform_search with platform "npm" to find the npm package @deepseek-ai/dsh. Use the actual returned npm URL to create one local todo task titled "${marker}". Set its description to "${description}" followed by the source URL. Read the new task back by its taskId and report the saved description and source. Do not run or schedule the task.`, tools)
    for (const tool of tools) assert.ok(trace.results.some(r => r.name === tool && !r.isError), `successful ${tool}`)
    const search = trace.results.find(r => r.name === tools[0] && !r.isError)
    assert.match(String(search.result), /npmjs\.com/)
    assert.match(String(search.result), /deepseek-ai/)
    const task = trace.results.find(r => r.name === 'dsh__task_board_get' && !r.isError)
    assert.ok(String(task.result).includes(marker))
    assert.ok(String(task.result).includes(suffix))
    assert.match(String(task.result), /npmjs\.com/)
    assert.ok(trace.approvals.length >= 3)
    row.output = trace.content
  })
  await test('dshpopular_skill', 'Create a reusable release-review skill and verify its actual Markdown file', async row => {
    const trace = await run('popular-skill', `Use create_skill to create a skill named "${skillName}". Description: "Review DSH plugin releases in an isolated workspace". Body must contain a heading and these exact checklist lines: "Check DSH 0.2.1-rc.2 compatibility", "Approve tools before execution", "Verify persistence after restart", and "Evidence ${suffix}". This is a local DSH skill, not a Tangu skill. Report its saved path.`, ['dsh__create_skill'])
    assert.ok(trace.results.some(r => r.name === 'dsh__create_skill' && !r.isError))
    assert.ok(trace.approvals.length >= 1)
    const file = join(shared, 'tangu/plugin-data/dsh2forsion/home/skills', skillName, 'SKILL.md')
    assert.ok(existsSync(file), `skill exists at ${file}`)
    const content = readFileSync(file, 'utf8')
    for (const line of ['Check DSH 0.2.1-rc.2 compatibility', 'Approve tools before execution', 'Verify persistence after restart', `Evidence ${suffix}`]) assert.ok(content.includes(line), line)
    writeFileSync(join(out, 'skill-evidence.json'), JSON.stringify({ file, content }, null, 2))
    seed.skillFile = file; seed.skillMarker = `Evidence ${suffix}`; saveSeed()
    row.output = trace.content
  })
  await test('dshpopular_resume', 'A fresh model conversation finds and updates the review task after a DSH restart', async row => {
    await api(prefix + '/sidecar/restart', {})
    const tools = ['dsh__task_board_list', 'dsh__task_board_update', 'dsh__task_board_get']
    const updated = `${description} Review notes saved after restart.`
    const trace = await run('popular-resume', `Find the local task titled "${marker}" using task_board_list. Update its description to exactly "${updated}". Read it back and report the saved description. Do not create, run, or schedule a task.`, tools)
    for (const tool of tools) assert.ok(trace.results.some(r => r.name === tool && !r.isError), `successful ${tool}`)
    assert.ok(trace.results.some(r => r.name === 'dsh__task_board_get' && !r.isError && String(r.result).includes(updated)))
    seed.description = updated; saveSeed()
    assert.ok(readFileSync(seed.skillFile, 'utf8').includes(seed.skillMarker))
    row.output = trace.content
  })
}
