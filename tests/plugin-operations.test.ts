import { expect, test } from 'bun:test'
import { pluginFixture } from './plugin-fixture'
import { jobHarness } from './job-harness'
import { responsesReply } from './responses-fixture'
import { ResourceLibrary } from '@pi-im-bot/resources/library'
import { ResourcesConfigSchema } from '@pi-im-bot/resources/schema'
import { PluginService } from '@pi-im-bot/plugins/service'

test('plugin operation RPC preserves the original authority and private settings, rejects target revocation and breaks reentry without waiting', async () => {
  const env = await pluginFixture({ maxWorkers: 2 })
  const target = await env.register(
    'target',
    `export default { operations: { echo(input, ctx) {
    return { text: ctx.invocation.actors[0].id + ':' + input.text, value: { callerSecret: ctx.invocation.settings.callerSecret ?? null } }
  } } }`
  )
  const caller = await env.register(
    'caller',
    `export default { operations: { async echo(input, ctx) {
    let method = 'operation:backend/echo'
    if (input.text === 'loop') { method = 'operation:self/echo' }
    const result = await ctx.host(method, { arguments: { text: input.text, actorId: 'admin' } })
    return result
  } } }`,
    {
      operations: [
        {
          id: 'echo',
          title: 'Forward',
          description: 'Forward to another plugin',
          inputSchema: { type: 'object' },
          grants: ['operation:backend/echo', 'operation:self/echo']
        }
      ],
      commands: [{ id: 'forward', names: ['forward'], operation: 'echo', description: 'Forward fixture' }]
    }
  )
  caller.instance.dependencies = { backend: 'target', self: 'caller' }
  caller.instance.grants = ['operation:backend/echo', 'operation:self/echo']
  caller.instance.settings = { callerSecret: 'CALLER_PRIVATE_SENTINEL' }
  const resources = new ResourceLibrary(
    ResourcesConfigSchema.parse({ plugins: [caller.instance, target.instance] }),
    [],
    [],
    [caller.bundle, target.bundle]
  )
  const app = await jobHarness(
    () => {
      return responsesReply({ kind: 'text', text: 'unused' })
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
    await app.coordinator.receive(app.room.id, '/forward hello', 'alice', 'Alice')
    const visible = app.store.listMessages(app.room.id, 10).find((message) => {
      return message.role === 'assistant'
    })!
    expect(visible.text).toContain('alice:hello')
    expect(visible.text).toContain('"callerSecret":null')
    expect(visible.text).not.toContain('CALLER_PRIVATE_SENTINEL')
    app.config.framework.defaults.permissions.rules = [
      { effect: 'deny', capabilities: ['plugin:target/*'], subjects: [{ kind: 'mock' }] }
    ]
    await app.coordinator.receive(app.room.id, '/forward denied', 'alice', 'Alice')
    expect(
      app.store.listMessages(app.room.id, 20).some((message) => {
        return message.text.startsWith('alice:denied')
      })
    ).toBe(false)
    app.config.framework.defaults.permissions.rules = []
    const start = performance.now()
    await app.coordinator.receive(app.room.id, '/forward loop', 'alice', 'Alice')
    expect(performance.now() - start).toBeLessThan(1000)
    expect(app.store.listMessages(app.room.id, 20).at(-1)?.text).toContain('环路')
    expect(app.requests).toHaveLength(0)
  } finally {
    await app.close()
    await env.close()
  }
})
