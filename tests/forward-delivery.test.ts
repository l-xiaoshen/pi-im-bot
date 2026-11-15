import { expect, test } from 'bun:test'
import { z } from 'zod'
import { OneBotAdapter } from '@pi-im-bot/channels/onebot/adapter'
import { OneBotConfigSchema } from '@pi-im-bot/channels/onebot/config'
import { tokenRevision } from '@pi-im-bot/channels/onebot/auth'
import { EventHub } from '@pi-im-bot/contracts/events'
import { ChannelRegistry } from '@pi-im-bot/channels/registry'
import { sendTransport } from '@pi-im-bot/runtime/transport'
import { createMockAdapter } from '@pi-im-bot/channels/mock'
import { pngImage } from './image-fixture'

const ActionSchema = z.object({
  action: z.string(),
  echo: z.string(),
  params: z.object({
    messages: z.array(
      z.object({
        type: z.literal('node'),
        data: z.object({ uin: z.string(), name: z.string(), content: z.array(z.unknown()) })
      })
    )
  })
})

test('OneBot forward produces one genuine ACK; an uncertain forward never falls back to direct sends', async () => {
  for (const unknown of [false, true]) {
    const config = OneBotConfigSchema.parse({
      targets: [{ selfId: '11', chatId: '22', name: 'authored', enabled: true }]
    })
    const adapter = new OneBotAdapter(
      () => {
        return config
      },
      new EventHub(),
      async () => {
        return 'recorded'
      },
      () => {}
    )
    const actions: z.infer<typeof ActionSchema>[] = []
    const socket = {
      send(raw: string) {
        const action = ActionSchema.parse(JSON.parse(raw))
        actions.push(action)
        queueMicrotask(() => {
          if (unknown) {
            adapter.disconnect('11', socket)
          } else {
            void adapter.message(
              '11',
              JSON.stringify({ retcode: 0, echo: action.echo, data: { message_id: 'real-ack' } }),
              socket
            )
          }
        })
        return raw.length
      },
      close() {}
    }
    adapter.connect('11', socket, tokenRevision(''))
    const registry = new ChannelRegistry()
    registry.register(adapter)
    const parts: string[][] = []
    const promise = sendTransport(
      registry,
      { channel: 'onebot-v11', accountId: '11', kind: 'group', chatId: '22' },
      'authored result',
      [{ id: crypto.randomUUID(), kind: 'image', mimeType: 'image/png', name: 'a.png', data: pngImage() }],
      'forward',
      true,
      {},
      (_files, ids) => {
        parts.push(ids)
      }
    )
    if (unknown) {
      await expect(promise).rejects.toThrow()
      expect(parts).toHaveLength(0)
    } else {
      expect((await promise).messageIds).toEqual(['real-ack'])
      expect(parts).toEqual([['real-ack']])
    }
    expect(actions).toHaveLength(1)
    expect(actions[0].action).toBe('send_group_forward_msg')
    expect(actions[0].params.messages).toHaveLength(2)
    expect(actions[0].params.messages[0].data.uin).toBe('11')
    adapter.disconnect('11', socket)
  }
})

test('target is rechecked after forward preflight and unsupported adapters downgrade before any send', async () => {
  const config = OneBotConfigSchema.parse({
    targets: [{ selfId: '11', chatId: '22', name: 'authored', enabled: true }]
  })
  const adapter = new OneBotAdapter(
    () => {
      return config
    },
    new EventHub(),
    async () => {
      return 'recorded'
    },
    () => {}
  )
  let calls = 0
  const socket = {
    send(raw: string) {
      calls += 1
      return raw.length
    },
    close() {}
  }
  adapter.connect('11', socket, tokenRevision(''))
  await expect(
    adapter.sendForward({ channel: 'onebot-v11', accountId: '11', kind: 'group', chatId: '22' }, 'text', [], {
      beforePart() {
        config.targets[0].enabled = false
      }
    })
  ).rejects.toThrow('停用')
  expect(calls).toBe(0)
  adapter.disconnect('11', socket)
  const registry = new ChannelRegistry()
  registry.register(createMockAdapter())
  const result = await sendTransport(
    registry,
    { channel: 'mock', accountId: 'bot', kind: 'group', chatId: 'authored' },
    'text',
    [],
    'forward',
    true,
    {},
    () => {}
  )
  expect(result.messageIds).toHaveLength(1)
})
