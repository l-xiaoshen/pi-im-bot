import { expect, test } from 'bun:test'
import { pluginFixture } from './plugin-fixture'
import { jobHarness } from './job-harness'
import { responsesReply } from './responses-fixture'
import { PluginService } from '@pi-im-bot/plugins/service'
import { ResourcesConfigSchema } from '@pi-im-bot/resources/schema'
import { ResourceLibrary } from '@pi-im-bot/resources/library'
import { RuntimeStatusSchema } from '@pi-im-bot/runtime/status/schema'

test('system status is a scoped read-only RPC, not a selectable model tool or arbitrary host file reader', async () => {
  const env = await pluginFixture()
  const binding = await env.register(
    'system-reader',
    `export default { operations: { async inspect(input, ctx) { return { value: await ctx.host('system.status', input) } } } }`,
    {
      operations: [
        {
          id: 'inspect',
          title: 'Status',
          description: 'Status',
          inputSchema: { type: 'object' },
          grants: ['system.status']
        }
      ],
      commands: [
        {
          id: 'status',
          names: ['read_system_test'],
          operation: 'inspect',
          arguments: 'json',
          description: 'Status fixture'
        }
      ]
    }
  )
  binding.instance.grants = ['system.status']
  const library = new ResourceLibrary(
    ResourcesConfigSchema.parse({ plugins: [binding.instance] }),
    [],
    [],
    [binding.bundle]
  )
  const app = await jobHarness(
    () => {
      return responsesReply({ kind: 'text', text: 'unused' })
    },
    library,
    (coordinator, config) => {
      config.bot.plugins = env.manager.config
      config.framework.defaults.resources.tools = { mode: 'selected', ids: ['plugin:system-reader/inspect'] }
      coordinator.plugins = new PluginService(() => {
        return config
      }, env.manager)
    }
  )
  try {
    app.config.framework.defaults.behavior.agentEnabled = false
    await app.coordinator.receive(app.room.id, '/read_system_test {}')
    const message = app.store.listMessages(app.room.id).at(-1)!
    const value = RuntimeStatusSchema.parse(JSON.parse(message.text))
    expect(value.observer).toBe('bot-control-plane')
    expect(value.disk?.scope).toBe('bot-data-filesystem')
    expect(value.bot.runtime).toBe('bun')
    expect(value.bot.modelsEnabled).toBe(1)
    expect(message.text).not.toContain('http://')
    expect(message.text).not.toContain(app.config.dataDir)
    expect(message.text).not.toContain('baseUrl')
    await app.coordinator.receive(app.room.id, '/read_system_test {"path":"/etc/passwd"}')
    expect(app.store.listMessages(app.room.id).at(-1)?.text).not.toContain('bot-control-plane')
    app.config.framework.defaults.permissions.rules = [
      { effect: 'deny', capabilities: ['runtime_status'], subjects: [{ kind: 'mock' }] }
    ]
    await app.coordinator.receive(app.room.id, '/read_system_test {}')
    expect(app.store.listMessages(app.room.id).at(-1)?.text).toContain('runtime_status')
    expect(app.store.listMessages(app.room.id).at(-1)?.text).not.toContain('bot-control-plane')
    expect(app.requests).toHaveLength(0)
  } finally {
    await app.close()
    await env.close()
  }
})
