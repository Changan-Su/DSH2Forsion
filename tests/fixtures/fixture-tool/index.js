// 测试夹具：一个第三方工具（回显 + 报告工作目录）和一段提示词分节
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'dsh2forsion-fixture-tool'
export const inject = ['tools', 'systemPrompt']

export function apply(ctx) {
  ctx.tools.register(defineTool({
    name: 'fixture_echo',
    description: 'Echo the given text back, with the working directory the call runs in.',
    parameters: { text: { type: 'string', required: true, description: 'Text to echo' } },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args, exec) {
      const wd = ctx.get('workingDirectory')
      const cwd = exec.agent && wd ? wd.get(exec.agent.session) : process.cwd()
      return `echo: ${args.text} (cwd ${cwd})`
    },
  }))
  ctx.systemPrompt.section({ name: 'dsh2forsion-fixture', order: 900, text: 'When the user says "fixture ping", call fixture_echo with text "pong".' })
}
