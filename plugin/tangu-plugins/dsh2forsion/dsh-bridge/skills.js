import { realpath } from 'node:fs/promises'
import { isAbsolute, join, relative, sep } from 'node:path'

const inside = (root, file) => {
  const rel = relative(root, file)
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
}

// Use DSH's public registry so invocation policy and provider overrides remain
// authoritative. This first slice exports only this profile's DSH_HOME/skills,
// never the user's other CLI skills, project skills or bundled DSH built-ins.
export async function managedSkills(ctx, home, signal) {
  signal?.throwIfAborted()
  const service = ctx.get('skills')
  if (!service || !home) return []
  const [homeDir, root] = await Promise.all([realpath(home).catch(() => null), realpath(join(home, 'skills')).catch(() => null)])
  if (!homeDir || !root || !inside(homeDir, root)) return []
  const out = []
  const lookup = { signal }
  const summaries = await service.list(lookup)
  for (const summary of summaries) {
    signal?.throwIfAborted()
    if (!summary.invocation?.modelInvocable) continue
    const skill = await service.get(summary.name, lookup)
    if (!skill?.invocation?.modelInvocable || skill.resourceBase?.kind !== 'directory' || !skill.path) continue
    const [dir, file] = await Promise.all([realpath(skill.resourceBase.path).catch(() => null), realpath(skill.path).catch(() => null)])
    if (!dir || !file || !inside(root, dir) || !inside(dir, file)) continue
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(skill.name) || typeof skill.content !== 'string') continue
    out.push({ id: skill.name, name: skill.name, description: skill.description || '', content: skill.content, dir })
  }
  return out
}
