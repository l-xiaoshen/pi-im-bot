import { expect, test } from 'bun:test'
import { MemoryState } from './memory-state'
import { ChannelRegistry } from '@pi-im-bot/channels/registry'
import { RoomSchema } from '@pi-im-bot/contracts/message'
import { DeliveryService, DeliveryUncertain, DeliveryAdmissionUnknown } from '@pi-im-bot/runtime/delivery'
import { DeliveryDeferred } from '@pi-im-bot/contracts/rendering'
import { EventHub } from '@pi-im-bot/contracts/events'
import { jobHarness } from './job-harness'
import { responsesReply } from './responses-fixture'
import { localIdentity } from '@pi-im-bot/permissions/identity'

test('persisted rendering decision survives admission interruption, resumes original fallback once, and never fabricates an ACK', async () => {
  const fixture = await jobHarness(() => {
    return responsesReply({ kind: 'text', text: 'unused' })
  })
  try {
    const invocation = fixture.coordinator.jobInvocation(
      fixture.room.id,
      localIdentity('mock', 'mock-bot', 'actor', 'Actor'),
      'fixture'
    )
    const store = new MemoryState()
    const channels = new ChannelRegistry()
    let sends = 0
    let choices = 0
    let captures = 0
    channels.register({
      id: 'fake',
      capabilities: { text: true, images: false, files: false, threads: false, edit: false, recall: false },
      async send() {
        sends += 1
        return { messageIds: ['ack'], sentAt: Date.now() }
      }
    })
    const room = RoomSchema.parse({
      ...invocation.room,
      address: { channel: 'fake', accountId: 'bot', chatId: 'chat', kind: 'group' }
    })
    const presentation = {
      key: 'snapshot',
      captureAdmission() {
        captures += 1
        return { configSnapshot: 'fixed', input: invocation.input, mode: room.mode }
      },
      async prepare(text: string) {
        choices += 1
        return {
          allow: true,
          text,
          artifactIds: [],
          handlers: [],
          render: {
            capability: 'plugin:renderer/render',
            arguments: { text },
            access: { mediaIds: [], capabilities: [] }
          }
        }
      },
      validate() {},
      async enqueue() {
        throw new Error('crash after plan, before admission receipt')
      }
    }
    const service = new DeliveryService(channels, store, new EventHub())
    await expect(
      service.send(room, 'original', 'run', 'assistant', 'once', { presentation })
    ).rejects.toBeInstanceOf(DeliveryAdmissionUnknown)
    expect(store.getOutbound('once')?.state).toBe('rendering')
    expect(store.getOutbound('once')?.renderAdmission?.input.context.authority).toEqual(
      invocation.input.context.authority
    )
    expect(sends).toBe(0)
    const recovered = new DeliveryService(channels, store, new EventHub())
    const resume = {
      ...presentation,
      async enqueue() {
        return 'same-job'
      }
    }
    await expect(
      recovered.send(room, 'original', 'run', 'assistant', 'once', { presentation: resume })
    ).rejects.toBeInstanceOf(DeliveryDeferred)
    expect(choices).toBe(1)
    expect(captures).toBe(1)
    await recovered.completeRender(room, 'once', undefined, {})
    await recovered.completeRender(room, 'once', undefined, {})
    expect(sends).toBe(1)
    expect(store.getOutbound('once')?.renderedText).toBe('original')
    store.saveOutbound({ ...store.getOutbound('once')!, state: 'unknown' })
    await expect(recovered.completeRender(room, 'once', undefined, {})).rejects.toBeInstanceOf(
      DeliveryUncertain
    )
    expect(sends).toBe(1)
  } finally {
    await fixture.close()
  }
})
