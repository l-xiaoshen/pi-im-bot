import { expect, test } from 'bun:test'
import { join } from 'node:path'
import { pluginFixture } from './plugin-fixture'
import { jobHarness, untilJob } from './job-harness'
import { responsesReply } from './responses-fixture'
import { PluginService } from '@pi-im-bot/plugins/service'
import { PluginWorkerManager } from '@pi-im-bot/plugins/runtime/manager'
import { ResourceLibrary } from '@pi-im-bot/resources/library'
import { ResourcesConfigSchema } from '@pi-im-bot/resources/schema'
import { createMockAdapter } from '@pi-im-bot/channels/mock'
import type { ChannelAdapter } from '@pi-im-bot/contracts/channel'

test('a receipt observer schedules a persistent scoped recall, survives restart and never adds a model call or reruns its handler', async () => {
  const env = await pluginFixture()
  const binding = await env.register(
    'recaller',
    `export default { hooks: { async receipt(input, ctx) {
    const file = Bun.file('observed.txt')
    let count = 0
    if (await file.exists()) { count = Number(await file.text()) }
    await Bun.write(file, String(count + 1))
    await ctx.host('delivery.recall', { messageId: input.messageId, delayMs: 900 })
  } } }`,
    { hooks: [{ id: 'receipt', point: 'delivery.receipt@1', mode: 'observe', grants: ['delivery.recall'] }] }
  )
  binding.instance.grants = ['delivery.recall']
  const resources = new ResourceLibrary(
    ResourcesConfigSchema.parse({ plugins: [binding.instance] }),
    [],
    [],
    [binding.bundle]
  )
  let manager = env.manager
  const app = await jobHarness(
    () => {
      return responsesReply({ kind: 'text', text: 'VISIBLE_REPLY' })
    },
    resources,
    (coordinator, config) => {
      config.bot.plugins = manager.config
      coordinator.plugins = new PluginService(() => {
        return config
      }, manager)
    }
  )
  const recalled: string[] = []
  function adapter(): ChannelAdapter {
    return {
      ...createMockAdapter(),
      async recall(_address, id) {
        recalled.push(id)
      }
    }
  }
  app.channels.register(adapter())
  try {
    const run = await app.coordinator.receive(app.room.id, 'answer', 'alice', 'Alice')
    expect((await app.coordinator.waitRun(run!.id)).status).toBe('completed')
    try {
      await untilJob(async () => {
        return Boolean(
          (await app.coordinator.observations!.status()).active.find((item) => {
            return item.dueAt !== undefined
          })
        )
      }, 'recall action was not scheduled')
    } catch (error) {
      throw new Error(String(error) + JSON.stringify(await app.coordinator.observations!.status()))
    }
    const message = app.store.listMessages(app.room.id, 10).find((message) => {
      return message.text === 'VISIBLE_REPLY'
    })!
    expect(message.recalled).toBe(false)
    await app.restart(async () => {
      await manager.close()
      manager = new PluginWorkerManager(env.root, env.manager.config, env.backend, env.root, env.volumes)
      await manager.start()
    })
    app.channels.register(adapter())
    await untilJob(async () => {
      if (app.store.getMessage(message.id)?.recalled !== true) {
        return false
      }
      return (await app.coordinator.observations!.status()).recent.some((record) => {
        return record.dueAt !== undefined && record.state === 'done'
      })
    }, 'recall did not resume with a completed observation')
    expect(recalled).toEqual(message.platformMessageIds)
    expect(app.requests).toHaveLength(1)
    const spec = [...env.backend.specifications.values()].find((spec) => {
      return spec.Labels['io.pi-im.plugin-instance'] === 'recaller'
    })!
    const count = join(
      spec.HostConfig.Mounts.find((mount) => {
        return mount.Target === '/data'
      })!.Source,
      'files',
      'observed.txt'
    )
    expect(await Bun.file(count).text()).toBe('1')
    expect(app.store.observationCount()).toBe(0)
    expect(
      (await app.coordinator.observations!.status()).recent.some((record) => {
        return record.dueAt !== undefined && record.state === 'done'
      })
    ).toBe(true)
  } finally {
    await app.close()
    await manager.close()
    await env.close()
  }
})

test('a stuck observer leaves delivery and another observer responsive, and message observers record ordinary input without invoking a model', async () => {
  const env = await pluginFixture({ maxWorkers: 3, maxObserverMs: 200, maxObserverPerPlugin: 1 })
  const blocked = await env.register(
    'blocked',
    `export default { hooks: { receipt() { while (true) {} } } }`,
    { hooks: [{ id: 'receipt', point: 'delivery.receipt@1', mode: 'observe' }] }
  )
  const healthy = await env.register(
    'healthy',
    `export default { hooks: {
    async receipt(input) { await Bun.write('receipt-' + input.messageId, 'observed') },
    async message(input) { await Bun.write('message-' + input.message.id, input.message.actorId) }
  } }`,
    {
      hooks: [
        { id: 'receipt', point: 'delivery.receipt@1', mode: 'observe' },
        { id: 'message', point: 'message.recorded@1', mode: 'observe' }
      ]
    }
  )
  const resources = new ResourceLibrary(
    ResourcesConfigSchema.parse({ plugins: [blocked.instance, healthy.instance] }),
    [],
    [],
    [blocked.bundle, healthy.bundle]
  )
  const app = await jobHarness(
    () => {
      return responsesReply({ kind: 'text', text: 'FAST_REPLY' })
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
    const run = await app.coordinator.receive(app.room.id, 'fast', 'alice', 'Alice')
    expect((await app.coordinator.waitRun(run!.id)).status).toBe('completed')
    try {
      await untilJob(async () => {
        return (await app.coordinator.observations!.status()).recent.some((entry) => {
          return entry.handler === 'healthy/receipt' && entry.state === 'done'
        })
      }, 'healthy observer was blocked')
    } catch (error) {
      throw new Error(String(error) + JSON.stringify(await app.coordinator.observations!.status()))
    }
    await untilJob(async () => {
      return (await app.coordinator.observations!.status()).recent.some((entry) => {
        return entry.handler === 'blocked/receipt' && entry.state === 'unknown'
      })
    }, 'stuck observer did not time out')
    expect(
      app.store.listMessages(app.room.id, 10).some((message) => {
        return message.text === 'FAST_REPLY'
      })
    ).toBe(true)
    const before = app.requests.length
    await app.coordinator.receiveIncoming(
      app.room.id,
      {
        address: app.room.address,
        externalId: 'ordinary',
        actorId: 'bob',
        actorName: 'Bob',
        text: 'ordinary untriggered message',
        attachments: [],
        receivedAt: Date.now()
      },
      null
    )
    await untilJob(async () => {
      return (
        (await app.coordinator.observations!.status()).recent.filter((entry) => {
          return entry.handler === 'healthy/message' && entry.state === 'done'
        }).length >= 2
      )
    }, 'ordinary input was not observed')
    expect(app.requests).toHaveLength(before)
  } finally {
    await app.close()
    await env.close()
  }
})
