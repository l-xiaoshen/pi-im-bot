import { expect, test } from 'bun:test'
import { MemoryState } from './memory-state'
import { ChannelRegistry } from '@pi-im-bot/channels/registry'
import { EventHub } from '@pi-im-bot/contracts/events'
import { DeliveryService } from '@pi-im-bot/runtime/delivery'
import { RoomSchema } from '@pi-im-bot/contracts/message'

test('delivery receipts deduplicate completed sends and uncertain outcomes are never automatically resent', async () => {
  const state = new MemoryState()
  const registry = new ChannelRegistry()
  let sends = 0
  let uncertain = false
  registry.register({
    id: 'fake',
    capabilities: { text: true, recall: false, images: false, files: false, edit: false, threads: false },
    async send() {
      sends += 1
      if (uncertain) {
        throw new Error('Connection lost after dispatch')
      }
      return { messageIds: ['platform-' + sends], sentAt: Date.now() }
    }
  })
  const delivery = new DeliveryService(registry, state, new EventHub())
  const room = RoomSchema.parse({
    id: 'room',
    name: 'Room',
    address: { channel: 'fake', accountId: 'bot', kind: 'group', chatId: 'room' },
    mode: 'live',
    createdAt: 1,
    updatedAt: 1
  })
  const first = await delivery.send(room, 'answer', 'run', 'assistant', 'run:final')
  expect((await delivery.send(room, 'answer', 'run', 'assistant', 'run:final')).id).toBe(first.id)
  expect(sends).toBe(1)
  expect(state.listMessages(room.id)).toHaveLength(1)
  uncertain = true
  await expect(delivery.send(room, 'another answer', 'other', 'assistant', 'other:final')).rejects.toThrow(
    '不可确认'
  )
  await expect(delivery.send(room, 'another answer', 'other', 'assistant', 'other:final')).rejects.toThrow(
    '结果未知'
  )
  expect(sends).toBe(2)
  expect(state.getOutbound('other:final')?.state).toBe('unknown')
})

test('a recall notice before delivery receipts preserves partial recall and later recalls only remaining platform parts', async () => {
  const state = new MemoryState()
  const registry = new ChannelRegistry()
  const recalled: string[] = []
  registry.register({
    id: 'parts',
    capabilities: { text: true, recall: true, images: false, files: false, edit: false, threads: false },
    async send() {
      state.recordRecall('room', 'first')
      return { messageIds: ['first', 'second'], sentAt: Date.now() }
    },
    async recall(_address, id) {
      recalled.push(id)
    }
  })
  const service = new DeliveryService(registry, state, new EventHub())
  const room = RoomSchema.parse({
    id: 'room',
    name: 'Room',
    address: { channel: 'parts', accountId: 'bot', kind: 'group', chatId: 'room' },
    mode: 'live',
    createdAt: 1,
    updatedAt: 1
  })
  const message = await service.send(room, 'two parts')
  expect(message.recalled).toBe(false)
  expect(message.recalledPlatformIds).toEqual(['first'])
  await service.recall(room, message.id)
  expect(recalled).toEqual(['second'])
  expect(state.getMessage(message.id)?.recalled).toBe(true)
})
