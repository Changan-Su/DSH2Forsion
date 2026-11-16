import { defineTool } from '@deepseek-ai/dsh-tools'
import { appendFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout } from 'node:timers/promises'

export const name = 'dsh2forsion-live-probe'
export const inject = ['tools']
export function apply(ctx) {
  ctx.tools.register(defineTool({
    name: 'acceptance_probe',
    description: 'Acceptance test only: record a marker in the current test workspace and report its working directory. Optional waitMs delays completion and supports cancellation.',
    parameters: {
      marker: { type: 'string', required: true, description: 'Exact acceptance marker supplied by the user.' },
      waitMs: { type: 'number', description: 'Delay in milliseconds, between 0 and 30000.' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args, exec) {
      const cwd = ctx.get('workingDirectory')?.get(exec.agent?.session)
      if (!cwd || !args.marker?.startsWith('D2F-')) throw new Error('An isolated acceptance workspace and D2F marker are required')
      const record = phase => appendFile(join(cwd, 'dsh-probe.jsonl'), JSON.stringify({ marker: args.marker, phase, cwd }) + '\n')
      await record('started')
      try {
        await setTimeout(Math.max(0, Math.min(30000, Number(args.waitMs) || 0)), undefined, { signal: exec.signal })
        await record('finished')
        return JSON.stringify({ marker: args.marker, cwd, completed: true })
      } catch (error) {
        await record('cancelled')
        throw error
      }
    },
  }))
}
