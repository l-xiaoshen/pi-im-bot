import { expect, test } from 'bun:test'
import { pluginFixture } from './plugin-fixture'
import { mcpFixture } from './mcp-fixture'
import { jobHarness } from './job-harness'
import { responsesReply } from './responses-fixture'
import { ResourceLibrary } from '@pi-im-bot/resources/library'
import { ResourcesConfigSchema } from '@pi-im-bot/resources/schema'
import { inspectMcp } from '@pi-im-bot/resources/mcp/client'
import { createMcpTools } from '@pi-im-bot/resources/mcp/tools'
import { ArtifactStore } from '@pi-im-bot/artifacts/store'
import { PluginService } from '@pi-im-bot/plugins/service'

test('context connectors recheck live read-only metadata while ordinary authorized MCP calls keep working with their pinned catalog', async () => {
  const env = await pluginFixture()
  const mcp = mcpFixture({ content: [{ type: 'text', text: 'REMOTE_SIDE_EFFECT_RESULT' }] })
  mcp.state.tools[0].annotations = { readOnlyHint: true }
  const manifest = await inspectMcp(mcp.config, new AbortController().signal)
  const binding = await env.register(
    'reader',
    `export default { hooks: { async context(input, ctx) {
    const result = await ctx.host('connector:info', { tool: 'long-result', arguments: { query: input.text } })
    return { fragments: [{ key: 'remote', text: result.text }] }
  } } }`,
    { hooks: [{ id: 'context', point: 'context.collect@1', mode: 'collect', grants: ['connector:info'] }] }
  )
  binding.instance.grants = ['connector:info']
  binding.instance.connectors = { info: mcp.config.id }
  const resources = new ResourceLibrary(
    ResourcesConfigSchema.parse({ plugins: [binding.instance], mcp: [mcp.config] }),
    [manifest],
    [],
    [binding.bundle]
  )
  const app = await jobHarness(
    () => {
      return responsesReply({ kind: 'text', text: 'ANSWER_WITHOUT_OPTIONAL_CONTEXT' })
    },
    resources,
    (coordinator, config) => {
      config.bot.plugins = env.manager.config
      coordinator.plugins = new PluginService(() => {
        return config
      }, env.manager)
    }
  )
  try {
    mcp.state.tools[0].annotations = { readOnlyHint: false }
    const run = await app.coordinator.receive(app.room.id, 'query')
    expect((await app.coordinator.waitRun(run!.id)).status).toBe('completed')
    expect(mcp.state.calls).toBe(0)
    expect(app.requests[0]).not.toContain('REMOTE_SIDE_EFFECT_RESULT')
    expect(
      app.store.listTraces(app.room.id).some((trace) => {
        return trace.detail.includes('仍声明为只读')
      })
    ).toBe(true)
    const settings = app.coordinator.effective(app.room.id).settings
    const tools = createMcpTools(
      resources,
      settings,
      resources.capabilityIds(settings),
      new ArtifactStore(app.config.dataDir, app.room.id),
      new AbortController().signal
    )
    try {
      await tools.tools[0].execute(
        'normal',
        { query: 'explicit authorized call' },
        new AbortController().signal,
        undefined
      )
      expect(mcp.state.calls).toBe(1)
    } finally {
      await tools.close()
    }
  } finally {
    await app.close()
    await env.close()
    await mcp.server.stop(true)
  }
})
