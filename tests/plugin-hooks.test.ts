import { expect, test } from 'bun:test'
import { join } from 'node:path'
import { pluginFixture } from './plugin-fixture'
import { jobHarness } from './job-harness'
import { untilJob } from './job-harness'
import { responsesReply } from './responses-fixture'
import { PluginService } from '@pi-im-bot/plugins/service'
import { ResourceLibrary } from '@pi-im-bot/resources/library'
import { ResourcesConfigSchema } from '@pi-im-bot/resources/schema'

test('real delivery hooks collect context once, suppress intermediate sends, compose validated text, select one renderer and preserve model originals', async () => {
  const env = await pluginFixture({ maxWorkers: 4 })
  const facts = await env.register(
    'facts',
    `export default { hooks: { context(input, ctx) { return { fragments: [{ key: 'shared', text: 'SCOPED_FACT_FOR_' + ctx.invocation.actors[0].id }] } } } }`,
    { hooks: [{ id: 'context', point: 'context.collect@1', mode: 'collect' }] }
  )
  const policy = await env.register(
    'visibility',
    `export default { hooks: { silent() { return { allow: false, reason: 'only final replies' } } } }`,
    {
      hooks: [
        {
          id: 'silent',
          point: 'delivery.visibility@1',
          mode: 'policy',
          selector: { phases: ['tool-direct'] }
        }
      ]
    }
  )
  const clean = await env.register(
    'clean',
    `export default { hooks: { clean(input, ctx) { return { baseRevision: ctx.invocation.inputRevision, patch: [{ op: 'set', path: '/text', value: input.text.trim() + ':CLEAN' }] } } } }`,
    { hooks: [{ id: 'clean', point: 'delivery.text@1', mode: 'transform', priority: 100 }] }
  )
  const broken = await env.register(
    'broken',
    `export default { hooks: { break(input, ctx) { return { baseRevision: ctx.invocation.inputRevision, patch: [{ op: 'set', path: '/text', value: 'POISON' }, { op: 'set', path: '/roomId', value: 'elsewhere' }] } } } }`,
    { hooks: [{ id: 'break', point: 'delivery.text@1', mode: 'transform', priority: 0 }] }
  )
  const voice = await env.register(
    'voice',
    `export default { hooks: { async render(input, ctx) {
    if (input.text !== 'FINAL:CLEAN') { throw new Error('Wrong transformation input: ' + input.text) }
    const file = Bun.file('renders.txt')
    let count = 0
    if (await file.exists()) { count = Number(await file.text()) }
    await Bun.write(file, String(count + 1))
    const audio = await ctx.host('artifact.write', { name: 'voice.wav', mimeType: 'audio/wav', encoding: 'base64', data: 'UklGRiQAAABXQVZFZm10IBAAAAABAAEAgD4AAAB9AAACABAAZGF0YQAAAAA=' })
    return { text: '', artifactIds: [audio.id] }
  } } }`,
    {
      hooks: [
        {
          id: 'render',
          point: 'delivery.presentation@1',
          mode: 'select',
          priority: 50,
          grants: ['artifact.write']
        }
      ]
    }
  )
  voice.instance.grants = ['artifact.write']
  const loser = await env.register(
    'loser',
    `export default { hooks: { render() { throw new Error('Lower priority renderer must not run') } } }`,
    { hooks: [{ id: 'render', point: 'delivery.presentation@1', mode: 'select', priority: 0 }] }
  )
  const bindings = [facts, policy, clean, broken, voice, loser]
  const resources = new ResourceLibrary(
    ResourcesConfigSchema.parse({
      plugins: bindings.map((entry) => {
        return entry.instance
      })
    }),
    [],
    [],
    bindings.map((entry) => {
      return entry.bundle
    })
  )
  const app = await jobHarness(
    (_raw, call) => {
      if (call === 1) {
        return responsesReply({ kind: 'tool', name: 'chat_send', arguments: { text: 'INTERMEDIATE' } })
      }
      return responsesReply({ kind: 'text', text: '  FINAL  ' })
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
    const run = await app.coordinator.receive(app.room.id, 'please answer', 'alice', 'Alice')
    const result = await app.coordinator.waitRun(run!.id)
    expect(result.status).toBe('completed')
    expect(result.rawReply).toBe('  FINAL  ')
    expect(app.requests).toHaveLength(2)
    expect(app.requests[0]).toContain('SCOPED_FACT_FOR_alice')
    expect(app.requests[1]).toContain('suppressed')
    const outbound = app.store.listOutbound(app.room.id)
    expect(
      outbound.find((item) => {
        return item.text === 'INTERMEDIATE'
      })?.state
    ).toBe('suppressed')
    const sent = outbound.find((item) => {
      return item.state === 'sent'
    })!
    expect(sent.text).toBe('FINAL')
    expect(sent.artifactIds).toHaveLength(1)
    expect(sent.requestedArtifactIds).toEqual([])
    expect(
      app.store.listMessages(app.room.id, 20).filter((message) => {
        return message.role === 'assistant'
      })
    ).toHaveLength(1)
    expect(app.store.getMessage(sent.messageId)?.attachments[0].type).toBe('audio')
    const spec = [...env.backend.specifications.values()].find((entry) => {
      return entry.Labels['io.pi-im.plugin-instance'] === 'voice'
    })!
    const countFile = join(
      spec.HostConfig.Mounts.find((mount) => {
        return mount.Target === '/data'
      })!.Source,
      'files',
      'renders.txt'
    )
    expect(await Bun.file(countFile).text()).toBe('1')
    const input = { ...result.input!, context: result.context! }
    await app.coordinator.delivery.send(
      app.coordinator.requireRoom(app.room.id),
      'FINAL',
      result.id,
      'assistant',
      sent.id,
      {
        presentation: app.coordinator.presentation(
          app.config,
          app.coordinator.requireRoom(app.room.id),
          input,
          sent.id,
          'final',
          new AbortController().signal
        )
      }
    )
    expect(await Bun.file(countFile).text()).toBe('1')
    expect(
      [...env.backend.specifications.values()].some((entry) => {
        return entry.Labels['io.pi-im.plugin-instance'] === 'loser'
      })
    ).toBe(false)
  } finally {
    await app.close()
    await env.close()
  }
})

test('an operation sending through its own hook fails reentry promptly and its detached receipt observer still runs', async () => {
  const env = await pluginFixture()
  const binding = await env.register(
    'selfsend',
    `export default {
    operations: { async echo(input, ctx) { await ctx.host('delivery.send', { text: 'DIRECT_MESSAGE' }); return { text: '' } } },
    hooks: {
      text(input, ctx) { return { baseRevision: ctx.invocation.inputRevision, patch: [{ op: 'set', path: '/text', value: 'MUST_SKIP_SELF_REENTRY' }] } },
      async receipt(input) { if (input.state === 'sent') { await Bun.write('observed.txt', 'yes') } }
    }
  }`,
    {
      operations: [
        {
          id: 'echo',
          title: 'Direct',
          description: 'Direct send',
          inputSchema: { type: 'object' },
          grants: ['delivery.send']
        }
      ],
      commands: [{ id: 'direct', names: ['direct'], operation: 'echo', description: 'Direct send' }],
      hooks: [
        { id: 'text', point: 'delivery.text@1', mode: 'transform', selector: { phases: ['tool-direct'] } },
        { id: 'receipt', point: 'delivery.receipt@1', mode: 'observe' }
      ]
    }
  )
  binding.instance.grants = ['delivery.send']
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
      coordinator.plugins = new PluginService(() => {
        return config
      }, env.manager)
    }
  )
  try {
    const start = performance.now()
    await app.coordinator.receive(app.room.id, '/direct')
    expect(performance.now() - start).toBeLessThan(1000)
    expect(
      app.store
        .listMessages(app.room.id, 10)
        .filter((message) => {
          return message.role === 'assistant'
        })
        .map((message) => {
          return message.text
        })
    ).toEqual(['DIRECT_MESSAGE'])
    const sent = app.store.listOutbound(app.room.id).find((outbound) => {
      return outbound.state === 'sent'
    })!
    await untilJob(async () => {
      return (await app.coordinator.observations!.status()).recent.some((record) => {
        return (
          record.handler === 'selfsend/receipt' &&
          record.eventId === 'delivery.receipt@1:' + sent.id &&
          record.state === 'done'
        )
      })
    }, 'receipt observer inherited its parent call chain')
    expect(app.requests).toHaveLength(0)
  } finally {
    await app.close()
    await env.close()
  }
})
