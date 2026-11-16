// Factory for a DSH test plugin. Only public LLM adapter/default-model seams;
// no fabricated Session messages or request-header events.
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createNativeCodexInference } from '../native-model-relay.mjs'
export function fixturePlugin({ runtimeDir, packageDir, expectedNativeHash, budgetUrl, budgetModule, agentDir, authFile, proxyConfig, evidenceFile }) {
  return {
    name: 'billion-native-codex-fixture', inject: ['llm', 'agentDefaultModel', 'agents'],
    async apply(ctx) {
      const pkg = JSON.parse(await readFile(join(packageDir, 'package.json'), 'utf8'))
      if (pkg.name !== 'billion-context' || pkg.version !== '0.1.201') throw new Error('Billion fixture version guard refused the package')
      const hash = createHash('sha256').update(await readFile(join(packageDir, 'dist/agent/dsh-native.js'))).digest('hex')
      if (hash !== expectedNativeHash) throw new Error('Billion native entry hash guard refused the package')
      process.env.BILI_FIXTURE_BUDGET_URL = budgetUrl
      process.env.BILI_CONFIG_FILE = proxyConfig
      process.env.BILI_REPLAY_RETRY_MAX = '1'
      process.env.ACP_AUTO_UPDATE = '0'
      process.env.NODE_OPTIONS = `--import=${pathToFileURL(budgetModule).href}`
      await import(pathToFileURL(budgetModule).href)
      const { LlmAdapter } = await import(pathToFileURL(join(runtimeDir, 'node_modules/@deepseek-ai/dsh-llm/lib/index.js')).href)
      const infer = createNativeCodexInference({ agentDir, authFile })
      class Direct extends LlmAdapter {
        async listModels(provider) { return [{ provider, id: 'gpt-6-luna', name: 'Billion direct Luna fixture' }] }
        async resolveModel(provider, model) { return { provider, id: model, name: 'Billion direct Luna fixture', context: { contextWindow: 262144 }, defaultMaxTokens: 512, reasoning: { efforts: [{ id: 'off', name: 'Off' }, { id: 'low', name: 'Low' }] } } }
        async *stream(options) {
          const messages = options.messages.map(message => ({ role: message.role, content: message.content.map(block => {
            if (block.type !== 'text') throw new Error('This original fixture only accepts text history')
            return block.text
          }).join('\n') }))
          const result = await infer({ payload: { model: 'gpt-6-luna', messages, max_tokens: 512, stream: true }, signal: options.signal })
          if (result.toolCalls?.length) throw new Error('Unexpected model tool request in the compression/recall fixture')
          let index = 0
          for (const [type, text] of [['reasoning', result.reasoning], ['text', result.content]]) if (text) {
            yield { type: 'block-start', index, blockType: type }
            yield { type: type === 'text' ? 'text-delta' : 'reasoning-delta', index, text }
            yield { type: 'block-end', index, block: { type, text } }; index++
          }
          const cached = result.usage.cached_tokens ?? 0, written = result.usage.cache_write_tokens ?? 0
          yield { type: 'usage', usage: { inputTokens: result.usage.prompt_tokens - cached - written, outputTokens: result.usage.completion_tokens, cacheReadTokens: cached, cacheWriteTokens: written, ...(result.usage.reasoning_tokens === undefined ? {} : { reasoningTokens: result.usage.reasoning_tokens }) } }
          yield { type: 'finish', reason: { kind: 'stop' } }
        }
      }
      ctx.llm.registerAdapter(['native-codex-fixture'], new Direct())
      await ctx.llm.listModels('native-codex-fixture')
      await ctx.llm.resolveModelInfo('native-codex-fixture','gpt-6-luna')
      const selection = ctx.agentDefaultModel.currentSelection()
      if (selection.provider !== 'native-codex-fixture' || selection.model !== 'gpt-6-luna') throw new Error('Fixed fixture default model does not match the actual inference route')
      ctx.reflect.provide('nativeBillionFixtureReady', Object.freeze({ version: pkg.version, nativeHash: hash }))
    },
  }
}
