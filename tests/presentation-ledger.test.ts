import { expect, test } from 'bun:test'
import { MemoryState } from './memory-state'
import { ChannelRegistry } from '@pi-im-bot/channels/registry'
import { RoomSchema } from '@pi-im-bot/contracts/message'
import { EventHub } from '@pi-im-bot/contracts/events'
import {
  DeliveryService,
  DeliverySuppressed,
  DeliveryUncertain,
  DeliveryCancelled
} from '@pi-im-bot/runtime/delivery'
import type { DeliveryPresentation } from '@pi-im-bot/contracts/presentation'

test('prepared media survives interrupted dispatch, completed presentation never repeats, and observer errors cannot turn a send into unknown', async () => {
  const store = new MemoryState()
  const channels = new ChannelRegistry()
  const delivered: string[] = []
  channels.register({
    id: 'fake',
    capabilities: { text: true, images: false, files: false, threads: false, edit: false, recall: false },
    async send(_address, text) {
      delivered.push(text)
      return { messageIds: ['receipt'], sentAt: Date.now() }
    }
  })
  const room = RoomSchema.parse({
    id: 'room',
    name: 'Room',
    address: { channel: 'fake', accountId: 'bot', chatId: 'room', kind: 'group' },
    mode: 'live',
    createdAt: 1,
    updatedAt: 1
  })
  let prepared = 0
  const presentation: DeliveryPresentation = {
    key: 'fixed',
    async prepare() {
      prepared += 1
      return { text: 'RENDERED', artifactIds: [], allow: true, handlers: [] }
    },
    validate() {},
    receipt() {
      throw new Error('observer failed')
    }
  }
  const first = new DeliveryService(channels, store, new EventHub())
  await expect(
    first.send(room, 'ORIGINAL', 'run', 'assistant', 'delivery', {
      presentation,
      beforePart() {
        if (prepared > 0) {
          throw new Error('shutdown before platform request')
        }
      }
    })
  ).rejects.toBeInstanceOf(DeliveryCancelled)
  expect(store.getOutbound('delivery')?.state).toBe('cancelled')
  expect(delivered).toHaveLength(0)
  const recovered = new DeliveryService(channels, store, new EventHub())
  await expect(
    recovered.send(room, 'ORIGINAL', 'run', 'assistant', 'delivery', { presentation })
  ).rejects.toBeInstanceOf(DeliveryCancelled)
  // Independent process-exit fixture: presentation committed, transport never claimed.
  // A cancelled operation above is never reset or resent.
  store.saveOutbound({
    ...store.getOutbound('delivery')!,
    id: 'prepared-before-exit',
    messageId: 'prepared-message',
    state: 'prepared',
    error: undefined
  })
  await recovered.send(room, 'ORIGINAL', 'run', 'assistant', 'prepared-before-exit', { presentation })
  await recovered.send(room, 'ORIGINAL', 'run', 'assistant', 'prepared-before-exit', { presentation })
  expect(prepared).toBe(1)
  expect(delivered).toEqual(['RENDERED'])
  expect(store.getOutbound('prepared-before-exit')?.state).toBe('sent')
  const deny = {
    ...presentation,
    key: 'deny',
    async prepare() {
      return { text: 'HIDDEN', artifactIds: [], allow: false, handlers: [] }
    }
  }
  await expect(
    recovered.send(room, 'HIDDEN', undefined, 'assistant', 'hidden', { presentation: deny })
  ).rejects.toBeInstanceOf(DeliverySuppressed)
  expect(store.getOutbound('hidden')?.state).toBe('suppressed')
  expect(store.listMessages(room.id)).toHaveLength(1)
  store.saveOutbound({
    ...store.getOutbound('prepared-before-exit')!,
    id: 'incomplete',
    state: 'preparing',
    presentationKey: 'fixed'
  })
  await expect(
    recovered.send(room, 'ORIGINAL', 'run', 'assistant', 'incomplete', { presentation })
  ).rejects.toBeInstanceOf(DeliveryUncertain)
  expect(prepared).toBe(1)
})
