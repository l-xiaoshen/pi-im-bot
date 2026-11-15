import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { z } from 'zod'
import { ArtifactStore } from '@pi-im-bot/artifacts/store'
import { OneBotAdapter } from '@pi-im-bot/channels/onebot/adapter'
import { OneBotConfigSchema } from '@pi-im-bot/channels/onebot/config'
import { tokenRevision } from '@pi-im-bot/channels/onebot/auth'
import { ChannelRegistry } from '@pi-im-bot/channels/registry'
import { ChatMessageSchema, RoomSchema } from '@pi-im-bot/contracts/message'
import { DeliveryService } from '@pi-im-bot/runtime/delivery'
import { EventHub, type AppEvent } from '@pi-im-bot/contracts/events'
import { MemoryState } from './memory-state'

const ActionSchema = z.object({
  action: z.string(),
  echo: z.string(),
  params: z.object({
    message: z.array(z.object({ type: z.string(), data: z.record(z.string(), z.string()) })).optional(),
    message_id: z.string().optional()
  })
})

test('QQ media receipts collapse multiple self echoes, deduplicate simultaneous sends, and recall every known platform message', async () => {
  const root = await mkdtemp('/tmp/pi-media-delivery-')
  const state = new MemoryState()
  const events = new EventHub()
  const updates: AppEvent[] = []
  events.subscribe((event) => {
    updates.push(event)
  })
  const channels = new ChannelRegistry()
  const config = OneBotConfigSchema.parse({
    targets: [{ selfId: '11', chatId: '33', name: 'Test', enabled: true }]
  })
  const adapter = new OneBotAdapter(
    () => {
      return config
    },
    events,
    async () => {
      return 'self'
    }
  )
  const room = RoomSchema.parse({
    id: 'media-room',
    name: 'Media',
    address: { channel: adapter.id, accountId: '11', kind: 'group', chatId: '33' },
    mode: 'live',
    currentConversationId: 'conversation',
    createdAt: 1,
    updatedAt: 1
  })
  const packets: z.infer<typeof ActionSchema>[] = []
  let failAudio = false
  const socket = {
    send(raw: string) {
      const action = ActionSchema.parse(JSON.parse(raw))
      packets.push(action)
      const id = String(packets.length)
      queueMicrotask(async () => {
        if (failAudio && action.params.message?.[0].type === 'record') {
          await adapter.message(
            '11',
            JSON.stringify({ retcode: 100, echo: action.echo, message: 'audio failed' }),
            socket
          )
          return
        }
        if (action.action.startsWith('send_')) {
          state.saveMessage(
            ChatMessageSchema.parse({
              id: 'echo-' + id,
              roomId: room.id,
              role: 'assistant',
              actorId: '11',
              actorName: 'Bot',
              text: 'echo',
              createdAt: Date.now(),
              platformMessageIds: [id]
            })
          )
        }
        await adapter.message(
          '11',
          JSON.stringify({ retcode: 0, echo: action.echo, data: { message_id: id } }),
          socket
        )
      })
      return raw.length
    },
    close() {}
  }
  channels.register(adapter)
  adapter.connect('11', socket, tokenRevision(''))
  const artifacts = new ArtifactStore(root, room.id)
  const delivery = new DeliveryService(channels, state, events, (roomId) => {
    return new ArtifactStore(root, roomId)
  })
  try {
    const image = await artifacts.save('image.png', 'image/png', 'test', new Uint8Array([137, 80, 78, 71]))
    const audio = await artifacts.save('speech.wav', 'audio/wav', 'test', 'RIFF')
    const options = { artifactIds: [image.id, audio.id] }
    const [first, repeated] = await Promise.all([
      delivery.send(room, 'result', 'run', 'assistant', 'media:result', options),
      delivery.send(room, 'result', 'run', 'assistant', 'media:result', options)
    ])
    expect(first.id).toBe(repeated.id)
    expect(packets).toHaveLength(2)
    expect(
      packets[0].params.message?.map((part) => {
        return part.type
      })
    ).toEqual(['text', 'image'])
    expect(packets[1].params.message?.[0].data.file).toBe(
      'base64://' + Buffer.from('RIFF').toString('base64')
    )
    expect(state.listMessages(room.id)).toHaveLength(1)
    expect(first.platformMessageIds).toEqual(['1', '2'])
    expect(first.attachments).toHaveLength(2)
    expect(
      updates.some((event) => {
        return event.type === 'message' && event.removedIds?.length === 2
      })
    ).toBe(true)
    expect(JSON.stringify(first)).not.toContain(root)
    await delivery.recall(room, first.id)
    expect(
      packets.slice(2).map((packet) => {
        return packet.params.message_id
      })
    ).toEqual(['1', '2'])
    await expect(
      delivery.send(room, 'result', 'run', 'assistant', 'media:result', { artifactIds: [audio.id] })
    ).rejects.toThrow('幂等键')

    failAudio = true
    await expect(delivery.send(room, 'partial', 'other', 'assistant', 'partial', options)).rejects.toThrow(
      '不可确认'
    )
    expect(state.getOutbound('partial')).toMatchObject({ state: 'unknown', platformMessageIds: ['5'] })
    const partial = state.listMessages(room.id).at(-1)!
    expect(partial.deliveryState).toBe('unknown')
    const count = packets.length
    await expect(delivery.send(room, 'partial', 'other', 'assistant', 'partial', options)).rejects.toThrow(
      '结果未知'
    )
    expect(packets).toHaveLength(count)
    await delivery.recall(room, partial.id)
    expect(packets.at(-1)?.params.message_id).toBe('5')

    const other = await new ArtifactStore(root, 'another-room').save(
      'private.png',
      'image/png',
      'test',
      'data'
    )
    await expect(
      delivery.send(room, 'cross scope', undefined, 'assistant', 'scope', { artifactIds: [other.id] })
    ).rejects.toThrow('当前聊天范围')
    expect(state.getOutbound('scope')).toBeUndefined()
    const document = await artifacts.save('report.pdf', 'application/pdf', 'test', 'pdf')
    const download = await delivery.send(room, 'report', undefined, 'assistant', 'download', {
      artifactIds: [document.id]
    })
    expect(download.text).toContain('Web 会话或任务页下载')
    expect(
      packets.at(-1)?.params.message?.map((part) => {
        return part.type
      })
    ).toEqual(['text'])
  } finally {
    adapter.close()
    await rm(root, { recursive: true, force: true })
  }
})
