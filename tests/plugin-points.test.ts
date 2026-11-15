import { expect, test } from 'bun:test'
import { pluginFixture } from './plugin-fixture'
import { jobHarness, untilJob } from './job-harness'
import { responsesReply } from './responses-fixture'
import { ResourceLibrary } from '@pi-im-bot/resources/library'
import { ResourcesConfigSchema } from '@pi-im-bot/resources/schema'
import { PluginService } from '@pi-im-bot/plugins/service'
import { PluginJsonSchema } from '@pi-im-bot/plugins/manifest'

test('a domain operation invokes its own schema-checked pipeline without executing its entry in validators or exposing owner settings to integrations', async () => {
  const env = await pluginFixture()
  const schema = PluginJsonSchema.parse({
    type: 'object',
    properties: { prompt: { type: 'string' }, target: { type: 'string' } },
    required: ['prompt', 'target'],
    additionalProperties: false
  })
  const owner = await env.register(
    'owner',
    `
    if (process.env.BOT_PLUGIN_MODE === 'validator') { throw new Error('Owner code must never run in validators') }
    export default { operations: { async echo(input, ctx) {
      let prompt = input.text
      if (prompt === 'invalid') { prompt = 42 }
      const value = await ctx.host('point:plugin.self.prepare@1', { value: { prompt, target: 'QQ' } })
      if (input.text === 'observe') { await ctx.host('point:plugin.self.ready@1', { value }) }
      return { text: value.prompt, value: { target: value.target } }
    } } }`,
    {
      configSchema: { type: 'object', properties: { secret: { type: 'string' } }, required: ['secret'] },
      operations: [
        {
          id: 'echo',
          title: 'Prepare',
          description: 'Domain prepare',
          inputSchema: { type: 'object' },
          grants: ['point:plugin.self.prepare@1', 'point:plugin.self.ready@1']
        }
      ],
      commands: [{ id: 'prepare', names: ['prepare'], operation: 'echo', description: 'Prepare fixture' }],
      points: [
        {
          id: 'prepare@1',
          mode: 'transform',
          inputSchema: schema,
          outputSchema: schema,
          writable: ['/prompt']
        },
        { id: 'ready@1', mode: 'observe', inputSchema: schema, outputSchema: { type: 'null' } }
      ]
    }
  )
  owner.instance.settings = { secret: 'OWNER_PRIVATE_KEY' }
  owner.instance.grants = ['point:plugin.self.prepare@1', 'point:plugin.self.ready@1']
  const clean = await env.register(
    'clean',
    `export default { hooks: { change(input, ctx) {
    if (ctx.invocation.settings.secret) { throw new Error('Owner settings leaked') }
    return { baseRevision: ctx.invocation.inputRevision, patch: [{ op: 'set', path: '/prompt', value: input.prompt + ':CLEAN' }] }
  } } }`,
    { hooks: [{ id: 'change', point: 'plugin.owner.prepare@1', mode: 'transform', priority: 100 }] }
  )
  const wrongField = await env.register(
    'wrongfield',
    `export default { hooks: { change(input, ctx) { return { baseRevision: ctx.invocation.inputRevision, patch: [{ op: 'set', path: '/prompt', value: 'POISON' }, { op: 'set', path: '/target', value: 'OTHER' }] } } } }`,
    { hooks: [{ id: 'change', point: 'plugin.owner.prepare@1', mode: 'transform', priority: 50 }] }
  )
  const wrongType = await env.register(
    'wrongtype',
    `export default { hooks: { change(input, ctx) { return { baseRevision: ctx.invocation.inputRevision, patch: [{ op: 'set', path: '/prompt', value: 42 }] } } } }`,
    { hooks: [{ id: 'change', point: 'plugin.owner.prepare@1', mode: 'transform', priority: 25 }] }
  )
  const final = await env.register(
    'final',
    `export default { hooks: { change(input, ctx) { return { baseRevision: ctx.invocation.inputRevision, patch: [{ op: 'set', path: '/prompt', value: input.prompt + ':FINAL' }] } }, async observed(input) { await Bun.write('fact.txt', input.prompt) } } }`,
    {
      hooks: [
        { id: 'change', point: 'plugin.owner.prepare@1', mode: 'transform' },
        { id: 'observed', point: 'plugin.owner.ready@1', mode: 'observe' }
      ]
    }
  )
  const all = [owner, clean, wrongField, wrongType, final]
  const library = new ResourceLibrary(
    ResourcesConfigSchema.parse({
      plugins: all.map((item) => {
        return item.instance
      })
    }),
    [],
    [],
    all.map((item) => {
      return item.bundle
    })
  )
  const app = await jobHarness(
    () => {
      return responsesReply({ kind: 'text', text: 'unused' })
    },
    library,
    (coordinator, config) => {
      config.bot.plugins = env.manager.config
      coordinator.plugins = new PluginService(() => {
        return config
      }, env.manager)
    }
  )
  try {
    await app.coordinator.receive(app.room.id, '/prepare hello')
    const first = app.store.listMessages(app.room.id, 10).find((message) => {
      return message.role === 'assistant'
    })!
    expect(first.text).toContain('hello:CLEAN:FINAL')
    expect(first.text).toContain('"target":"QQ"')
    expect(first.text).not.toContain('OWNER_PRIVATE_KEY')
    await app.coordinator.receive(app.room.id, '/prepare invalid')
    expect(app.store.listMessages(app.room.id, 20).at(-1)?.role).toBe('system')
    app.config.framework.defaults.permissions.rules = [
      { effect: 'deny', capabilities: ['hook:plugin:final/*'], subjects: [{ kind: 'mock' }] }
    ]
    await app.coordinator.receive(app.room.id, '/prepare restricted')
    expect(app.store.listMessages(app.room.id, 20).at(-1)?.text).toContain('restricted:CLEAN')
    expect(app.store.listMessages(app.room.id, 20).at(-1)?.text).not.toContain(':FINAL')
    app.config.framework.defaults.permissions.rules = []
    await app.coordinator.receive(app.room.id, '/prepare observe')
    await untilJob(async () => {
      return (await app.coordinator.observations!.status()).recent.some((record) => {
        return record.handler === 'final/observed' && record.state === 'done'
      })
    }, 'custom observation was not executed')
    const validators = [...env.backend.specifications.values()].filter((spec) => {
      return spec.Labels['io.pi-im.plugin-mode'] === 'validator'
    })
    expect(validators).toHaveLength(1)
    expect(
      validators[0].HostConfig.Mounts.some((mount) => {
        return mount.Target === '/data'
      })
    ).toBe(false)
    expect(app.requests).toHaveLength(0)
  } finally {
    await app.close()
    await env.close()
  }
})

test('a pathological schema is bounded in a pure validator while control commands and another plugin remain responsive', async () => {
  const env = await pluginFixture({ maxWorkers: 2, maxPointMs: 200 })
  const owner = await env.register(
    'expensive',
    `export default { operations: { async echo(input, ctx) { return { value: await ctx.host('point:plugin.self.check@1', { value: { text: 'a'.repeat(12000) + '!' } }) } } } }`,
    {
      operations: [
        {
          id: 'echo',
          title: 'Check',
          description: 'Pathological schema',
          inputSchema: { type: 'object' },
          grants: ['point:plugin.self.check@1']
        }
      ],
      commands: [{ id: 'check', names: ['check'], operation: 'echo', description: 'Check fixture' }],
      points: [
        {
          id: 'check@1',
          mode: 'transform',
          inputSchema: { type: 'object', properties: { text: { type: 'string', pattern: '^(a+)+$' } } },
          outputSchema: { type: 'object' },
          writable: []
        }
      ]
    }
  )
  owner.instance.grants = ['point:plugin.self.check@1']
  const healthy = await env.register(
    'healthy',
    `export default { operations: { echo() { return { text: 'HEALTHY_PLUGIN' } } } }`,
    { commands: [{ id: 'healthy', names: ['healthy'], operation: 'echo', description: 'Healthy fixture' }] }
  )
  const all = [owner, healthy]
  const resources = new ResourceLibrary(
    ResourcesConfigSchema.parse({
      plugins: all.map((entry) => {
        return entry.instance
      })
    }),
    [],
    [],
    all.map((entry) => {
      return entry.bundle
    })
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
    const pending = app.coordinator.receive(app.room.id, '/check')
    await untilJob(() => {
      return env.manager.status().workers.some((worker) => {
        return worker.mode === 'validator' && worker.busy
      })
    }, 'validator did not start')
    await app.coordinator.receive(app.room.id, '/help')
    await app.coordinator.receive(app.room.id, '/healthy')
    await pending
    expect(
      app.store.listMessages(app.room.id, 20).some((message) => {
        return message.text === 'HEALTHY_PLUGIN'
      })
    ).toBe(true)
    expect(
      app.store.listMessages(app.room.id, 20).some((message) => {
        return message.text.includes('/help') && message.role === 'system'
      })
    ).toBe(true)
    expect(app.requests).toHaveLength(0)
  } finally {
    await app.close()
    await env.close()
  }
})
