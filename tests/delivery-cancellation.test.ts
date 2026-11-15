import { expect, test } from 'bun:test'
import { jobHarness } from './job-harness'
import { responsesReply } from './responses-fixture'
import { pluginFixture } from './plugin-fixture'
import { PluginService } from '@pi-im-bot/plugins/service'
import { createMockAdapter } from '@pi-im-bot/channels/mock'
import { PartialDelivery } from '@pi-im-bot/contracts/channel-media'

for (const enabled of [false, true]) {
  test('stop before transport blocks final delivery with plugins enabled=' + enabled, async () => {
    const plugins = await pluginFixture()
    const app = await jobHarness(
      () => {
        return responsesReply({ kind: 'text', text: 'answer' })
      },
      undefined,
      (coordinator, config) => {
        if (enabled) {
          config.bot.plugins = plugins.manager.config
          coordinator.plugins = new PluginService(() => {
            return config
          }, plugins.manager)
        }
      }
    )
    const entered = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    let sends = 0
    app.channels.register({
      ...createMockAdapter(),
      async send(_address, _text, _media, control) {
        entered.resolve()
        await release.promise
        await control?.beforePart?.()
        sends += 1
        return { messageIds: ['sent'], sentAt: Date.now() }
      }
    })
    try {
      const run = (await app.coordinator.receive(app.room.id, 'answer'))!
      await entered.promise
      app.coordinator.stop(app.room.id)
      release.resolve()
      expect((await app.coordinator.waitRun(run.id)).status).toBe('cancelled')
      expect(sends).toBe(0)
      expect(app.store.getOutbound('run:' + run.id + ':assistant')?.state).toBe('cancelled')
      expect(
        app.store.listMessages(app.room.id).filter((message) => {
          return message.role === 'assistant'
        })
      ).toHaveLength(0)
    } finally {
      release.resolve()
      await app.close()
      await plugins.close()
    }
  })
}

test('stop after transport preserves the confirmed send while the run is cancelled', async () => {
  const app = await jobHarness(() => {
    return responsesReply({ kind: 'text', text: 'answer' })
  })
  const sent = Promise.withResolvers<void>()
  const receipt = Promise.withResolvers<void>()
  app.channels.register({
    ...createMockAdapter(),
    async send(_address, _text, _media, control) {
      await control?.beforePart?.()
      sent.resolve()
      await receipt.promise
      return { messageIds: ['already-sent'], sentAt: Date.now() }
    }
  })
  try {
    const run = (await app.coordinator.receive(app.room.id, 'answer'))!
    await sent.promise
    app.coordinator.stop(app.room.id)
    receipt.resolve()
    expect((await app.coordinator.waitRun(run.id)).status).toBe('cancelled')
    expect(app.store.getOutbound('run:' + run.id + ':assistant')).toMatchObject({
      state: 'sent',
      platformMessageIds: ['already-sent']
    })
    expect(app.store.listMessages(app.room.id).at(-1)?.deliveryState).toBe('sent')
  } finally {
    receipt.resolve()
    await app.close()
  }
})

test('local veto between parts records confirmed partial delivery and never retries it', async () => {
  const app = await jobHarness(() => {
    return responsesReply({ kind: 'text', text: 'unused' })
  })
  const controller = new AbortController()
  let sends = 0
  app.channels.register({
    ...createMockAdapter(),
    async send(_address, _text, _media, control) {
      await control?.beforePart?.()
      sends += 1
      await control?.received?.(['part-1'], 100)
      controller.abort('user')
      try {
        await control?.beforePart?.()
      } catch (error) {
        throw new PartialDelivery(['part-1'], 100, error)
      }
      throw new Error('part 2 must not send')
    }
  })
  const options = {
    beforePart() {
      controller.signal.throwIfAborted()
    }
  }
  try {
    await expect(
      app.coordinator.delivery.send(app.room, 'parts', undefined, 'assistant', 'parts', options)
    ).rejects.toThrow('停止')
    expect(app.store.getOutbound('parts')).toMatchObject({
      state: 'cancelled',
      platformMessageIds: ['part-1']
    })
    expect(app.store.listMessages(app.room.id).at(-1)?.deliveryState).toBe('partial')
    await expect(
      app.coordinator.delivery.send(app.room, 'parts', undefined, 'assistant', 'parts')
    ).rejects.toThrow('停止')
    expect(sends).toBe(1)
  } finally {
    await app.close()
  }
})

test('deadline is rechecked at transport and a failure notice can still explain the timeout', async () => {
  const app = await jobHarness(() => {
    return responsesReply({ kind: 'text', text: 'answer' })
  })
  const entered = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  const texts: string[] = []
  app.channels.register({
    ...createMockAdapter(),
    async send(_address, text, _media, control) {
      if (text === 'answer') {
        entered.resolve()
        await release.promise
      }
      await control?.beforePart?.()
      texts.push(text)
      return { messageIds: ['notice'], sentAt: Date.now() }
    }
  })
  try {
    const run = (await app.coordinator.receive(app.room.id, 'answer'))!
    await entered.promise
    run.deadlineAt = Date.now() - 1
    release.resolve()
    expect((await app.coordinator.waitRun(run.id)).status).toBe('failed')
    expect(texts).toHaveLength(1)
    expect(texts[0]).toContain('任务失败')
    expect(app.store.getOutbound('run:' + run.id + ':assistant')?.state).toBe('cancelled')
  } finally {
    release.resolve()
    await app.close()
  }
})
