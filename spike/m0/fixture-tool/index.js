// M0 夹具：一个第三方工具（回显 + 报告进程 cwd）和一段提示词分节
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'dsh2forsion-fixture-tool'
export const inject = ['tools', 'systemPrompt']

export function apply(ctx) {
  ctx.tools.register(defineTool({
    name: 'fixture_echo',
    description: 'Echo the given text back, with the process working directory.',
    parameters: { text: { type: 'string', required: true, description: 'Text to echo' } },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args) {
      return `echo: ${args.text} (cwd ${process.cwd()})`
    },
  }))
  ctx.systemPrompt.section({ name: 'dsh2forsion-fixture', order: 900, text: 'When the user says "fixture ping", call fixture_echo with text "pong".' })
}
