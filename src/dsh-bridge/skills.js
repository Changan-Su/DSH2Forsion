import { createHash } from 'node:crypto'
import { access, realpath, stat } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

const inside = (root, file) => {
  const rel = relative(root, file)
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
}
const within = (root, file) => root === file || inside(root, file)
const checkAbort = signal => signal?.throwIfAborted()

// Pinned to dsh-skill-filesystem 0.2.1-rc.2 findProjectRoot: nearest existing
// .git (file or directory), otherwise the supplied cwd. Resolve real paths only
// after selecting the same lexical root as the official filesystem provider.
async function projectRoots(cwd, signal) {
  if (typeof cwd !== 'string' || !isAbsolute(cwd)) throw new Error('DSH skill cwd must be an absolute directory')
  if (!(await stat(cwd)).isDirectory()) throw new Error('DSH skill cwd must be a directory')
  const start = resolve(cwd)
  let selected = start
  for (let current = start; ; current = dirname(current)) {
    checkAbort(signal)
    if (await access(join(current, '.git')).then(() => true, () => false)) { selected = current; break }
    if (dirname(current) === current) break
  }
  const root = await realpath(selected)
  const result = []
  for (const [folder, source] of [['.dsh', 'project-dsh'], ['.agents', 'project-agents']]) {
    const dir = await realpath(join(selected, folder, 'skills')).catch(() => null)
    if (dir && inside(root, dir)) result.push({ dir, source, projectRoot: root })
  }
  return result
}

// Registry remains authoritative for invocation policy, provider precedence and
// fresh bodies. Root checks only export local files; they grant no Tangu file
// access. Never import other CLI, bundled, URL or opaque resources implicitly.
export async function managedSkills(ctx, home, signal, { cwd } = {}) {
  checkAbort(signal)
  const service = ctx.get('skills')
  if (!service || !home) return []
  const projects = cwd === undefined ? [] : await projectRoots(cwd, signal)
  const [homeDir, managedRoot] = await Promise.all([realpath(home).catch(() => null), realpath(join(home, 'skills')).catch(() => null)])
  const managed = homeDir && managedRoot && inside(homeDir, managedRoot) ? [{ dir: managedRoot, source: 'managed' }] : []
  const out = []
  // Separate observations preserve the existing global IDs even when a project
  // skill wins the same registry name in a workspace-sensitive lookup.
  for (const [roots, lookup] of [[managed, { signal }], [projects, { cwd, signal }]]) {
    if (!roots.length) continue
    checkAbort(signal)
    const summaries = await service.list(lookup)
    checkAbort(signal)
    for (const summary of summaries) {
      checkAbort(signal)
      if (!summary.invocation?.modelInvocable) continue
      const skill = await service.get(summary.name, lookup)
      checkAbort(signal)
      if (!skill?.invocation?.modelInvocable || skill.name !== summary.name || skill.resourceBase?.kind !== 'directory' || !skill.path) continue
      if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(skill.name) || typeof skill.content !== 'string') continue
      const [dir, file] = await Promise.all([realpath(skill.resourceBase.path).catch(() => null), realpath(skill.path).catch(() => null)])
      checkAbort(signal)
      if (!dir || !file || !inside(dir, file)) continue
      const owner = roots.find(root => within(root.dir, dir) && inside(root.dir, file))
      if (!owner) continue
      const id = owner.source === 'managed' ? skill.name : `p-${createHash('sha256').update(`${owner.projectRoot}\0${owner.source}\0${skill.name}`).digest('hex').slice(0, 20)}-${skill.name.slice(0, 41)}`
      out.push({ id, name: skill.name, description: skill.description || '', content: skill.content, dir, source: owner.source, ...(owner.projectRoot ? { projectRoot: owner.projectRoot } : {}) })
    }
  }
  return out
}
