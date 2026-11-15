import { expect, test } from 'bun:test'
import type { AssistantMessage, UserMessage } from '@earendil-works/pi-ai'
import { pluginFixture } from './plugin-fixture'
import { jobHarness } from './job-harness'
import { responsesReply } from './responses-fixture'
import { PluginService } from '@pi-im-bot/plugins/service'
import { ResourceLibrary } from '@pi-im-bot/resources/library'
import { ResourcesConfigSchema } from '@pi-im-bot/resources/schema'
import { projectPluginHistory } from '@pi-im-bot/plugins/hooks/model-history'
import { localIdentity } from '@pi-im-bot/permissions/identity'
import { pluginToolName } from '@pi-im-bot/plugins/identity'

test('history projection shares unrelated large histories and redacts only verified own tool arguments, including supported start_job', async () => {
  const worker = await pluginFixture()
  const binding = await worker.register(
    'history',
    'export default {hooks:{history(){return {hideArguments:["echo","not_registered"]}}}}',
    { hooks: [{ id: 'history', point: 'model.history@1', mode: 'collect' }] }
  )
  const resources = new ResourceLibrary(
    ResourcesConfigSchema.parse({ plugins: [binding.instance] }),
    [],
    [],
    [binding.bundle]
  )
  const env = await jobHarness(
    () => {
      return responsesReply({ kind: 'text', text: 'unused' })
    },
    resources,
    (coordinator, config) => {
      config.bot.plugins = worker.manager.config
      coordinator.plugins = new PluginService(() => {
        return config
      }, worker.manager)
    }
  )
  try {
    const original = env.coordinator.jobInvocation(env.room.id, localIdentity('web', 'reader'), 'projection')
    const invocation = {
      ...original,
      services: {
        authorize: original.authorize,
        history() {
          return []
        },
        async send() {
          throw new Error('unused')
        }
      }
    }
    const large: UserMessage = {
      role: 'user',
      content: [{ type: 'image', data: 'a'.repeat(2 * 1024 * 1024), mimeType: 'image/png' }],
      timestamp: 0
    }
    const assistant: AssistantMessage = {
      role: 'assistant',
      api: 'openai-responses',
      provider: 'openai',
      model: 'fixture',
      timestamp: 0,
      stopReason: 'toolUse',
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
      },
      content: [
        { type: 'toolCall', id: '1', name: pluginToolName('history', 'echo'), arguments: { text: 'HIDDEN' } },
        {
          type: 'toolCall',
          id: '2',
          name: 'start_job',
          arguments: { title: 'mine', capability: 'plugin:history/echo', arguments: { text: 'HIDDEN' } }
        },
        {
          type: 'toolCall',
          id: '3',
          name: 'start_job',
          arguments: { title: 'other', capability: 'plugin:other/echo', arguments: { text: 'RETAINED' } }
        },
        {
          type: 'toolCall',
          id: '4',
          name: 'start_job',
          arguments: { kind: 'agent', capability: 'plugin:history/echo', arguments: { text: 'RETAINED' } }
        }
      ]
    }
    const unchanged = await projectPluginHistory(
      env.coordinator.plugins,
      invocation,
      [large],
      AbortSignal.timeout(5000)
    )
    expect(unchanged[0]).toBe(large)
    expect(unchanged[0].content).toBe(large.content)
    const projected = await projectPluginHistory(
      env.coordinator.plugins,
      invocation,
      [large, assistant],
      AbortSignal.timeout(5000)
    )
    expect(projected[0]).toBe(large)
    expect(projected[1]).not.toBe(assistant)
    const result = projected[1] as AssistantMessage
    expect(JSON.stringify(result.content.slice(0, 2))).not.toContain('HIDDEN')
    expect(result.content[2]).toBe(assistant.content[2])
    expect(result.content[3]).toBe(assistant.content[3])
    expect(JSON.stringify(assistant.content)).toContain('HIDDEN')
    expect(env.requests).toHaveLength(0)
  } finally {
    await env.close()
    await worker.close()
  }
})
