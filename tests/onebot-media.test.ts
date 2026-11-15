import { expect, test } from 'bun:test'
import { z } from 'zod'
import { OneBotAdapter } from '@pi-im-bot/channels/onebot/adapter'
import { OneBotConfigSchema } from '@pi-im-bot/channels/onebot/config'
import { tokenRevision } from '@pi-im-bot/channels/onebot/auth'
import { extractPrompt } from '@pi-im-bot/runtime/trigger'
import { parseOneBotContent } from '@pi-im-bot/channels/onebot/content'
import { downloadMedia } from '@pi-im-bot/media/download'
import { oneBotMediaAllowed } from '@pi-im-bot/channels/onebot/media'
import { jobHarness, untilJob } from './job-harness'
import { pngImage } from './image-fixture'
import { responsesReply } from './responses-fixture'

const ActionSchema = z.object({
  action: z.string(),
  echo: z.string(),
  params: z.record(z.string(), z.unknown())
})

test('QQ records media without fetching, loads quoted images only when triggered, and rejects cross-group quote responses without leaking signed URLs', async () => {
  const env = await jobHarness(() => {
    return responsesReply({ kind: 'text', text: 'QQ_IMAGE_REPLY' })
  })
  let downloads = 0
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request) {
      downloads += 1
      expect(request.headers.get('authorization')).toBeNull()
      return new Response(pngImage(), { headers: { 'content-type': 'image/png' } })
    }
  })
  const origin = `http://127.0.0.1:${server.port}`
  const config = OneBotConfigSchema.parse({
    targets: [{ selfId: '11', chatId: '22', name: 'media', enabled: true }],
    mediaOrigins: [origin]
  })
  env.config.bot.onebot = config
  const room = {
    ...env.store.getRoom(env.room.id)!,
    address: { channel: 'onebot-v11', accountId: '11', kind: 'group' as const, chatId: '22' }
  }
  env.store.saveRoom(room)
  const adapter = new OneBotAdapter(
    () => {
      return config
    },
    env.coordinator.events,
    async (message) => {
      return env.coordinator.receiveIncoming(room.id, message, extractPrompt(message.text, '!pi', '11'))
    },
    (address, id) => {
      env.coordinator.receiveRecall(address, id)
    }
  )
  let lookup = 0
  const socket = {
    send(raw: string) {
      const action = ActionSchema.parse(JSON.parse(raw))
      let data: object = { message_id: crypto.randomUUID() }
      if (action.action === 'get_image') {
        data = { url: origin + '/image?rkey=SIGNED_SECRET' }
      }
      if (action.action === 'get_msg') {
        lookup += 1
        let group = '22'
        if (action.params.message_id === '999') {
          group = 'another-group'
        }
        data = {
          message_id: action.params.message_id,
          message_type: 'group',
          group_id: group,
          time: 123456,
          sender: { user_id: '44', nickname: 'Quoted member' },
          message: [
            { type: 'text', data: { text: 'REMOTE_QUOTED_FACT' } },
            { type: 'image', data: { file: 'quoted.image', url: origin + '/image?rkey=SIGNED_SECRET' } }
          ]
        }
      }
      queueMicrotask(() => {
        void adapter.message('11', JSON.stringify({ retcode: 0, echo: action.echo, data }), socket)
      })
      return raw.length
    },
    close() {}
  }
  env.channels.register(adapter)
  adapter.connect('11', socket, tokenRevision(''))
  async function receive(
    id: number,
    message: string | Array<{ type: string; data: Record<string, string> }>
  ) {
    await adapter.message(
      '11',
      JSON.stringify({
        post_type: 'message',
        message_type: 'group',
        self_id: '11',
        user_id: '33',
        group_id: '22',
        message_id: id,
        sender: { nickname: 'Caller' },
        message
      }),
      socket
    )
  }
  try {
    await receive(1, '[CQ:image,file=hash.image]')
    expect(downloads).toBe(0)
    expect(env.requests).toHaveLength(0)
    expect(env.store.listMessages(room.id)[0].attachments[0].mediaId).toBeDefined()
    await receive(2, '[CQ:reply,id=1][CQ:at,qq=11] 看这张图')
    await untilJob(() => {
      return env.store.listRuns().some((run) => {
        return run.status === 'completed'
      })
    }, 'Image request did not finish')
    expect(downloads).toBe(1)
    expect(env.requests[0]).toContain('input_image')
    expect(env.requests[0]).not.toContain('SIGNED_SECRET')
    await receive(3, [
      { type: 'reply', data: { id: '88' } },
      { type: 'text', data: { text: '!pi 查看引用' } }
    ])
    await untilJob(() => {
      return (
        env.store.listRuns().filter((run) => {
          return run.status === 'completed'
        }).length === 2
      )
    }, 'Remote quote request did not finish')
    expect(lookup).toBe(1)
    expect(env.requests.at(-1)).toContain('REMOTE_QUOTED_FACT')
    expect(env.requests.at(-1)).toContain('input_image')
    expect(env.store.listRuns().at(-1)?.context?.authority.identities[0].actorId).toBe('33')
    expect(JSON.stringify(env.store.listMessages(room.id))).not.toContain('SIGNED_SECRET')
    await receive(4, '[CQ:reply,id=999]!pi 读取另一个引用')
    await untilJob(() => {
      return (
        env.store.listRuns().filter((run) => {
          return run.status === 'completed'
        }).length === 3
      )
    }, 'Cross-scope quote rejection blocked text response')
    expect(lookup).toBe(2)
    expect(env.requests.at(-1)).not.toContain('input_image')
    expect(env.store.findPlatformMessage(room.id, '999')).toBeUndefined()
    expect(env.requests.join('')).not.toContain('SIGNED_SECRET')
    const original = env.store.findPlatformMessage(room.id, '1')!
    await adapter.message(
      '11',
      JSON.stringify({
        post_type: 'notice',
        notice_type: 'group_recall',
        self_id: '11',
        group_id: '22',
        user_id: '33',
        message_id: '1'
      }),
      socket
    )
    expect(env.store.getMessage(original.id)?.recalled).toBe(true)
    await expect(
      env.media.resolve(room, original.attachments[0].mediaId!, new AbortController().signal)
    ).rejects.toThrow('已撤回')
    await adapter.message(
      '11',
      JSON.stringify({
        post_type: 'notice',
        notice_type: 'group_recall',
        self_id: '11',
        group_id: '22',
        user_id: '44',
        message_id: '77'
      }),
      socket
    )
    await receive(5, '[CQ:reply,id=77]!pi 这个引用还能看吗')
    await untilJob(() => {
      return (
        env.store.listRuns().filter((run) => {
          return run.status === 'completed'
        }).length === 4
      )
    }, 'Recalled quote did not settle')
    expect(lookup).toBe(2)
    expect(env.requests.at(-1)).toContain('recalled')
    expect(env.requests.at(-1)).not.toContain('input_image')
  } finally {
    adapter.close()
    await env.close()
    await server.stop(true)
  }
})

test('media download validates each redirect and CQ decoding keeps media URLs out of text', async () => {
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch() {
      return new Response(null, { status: 302, headers: { location: 'http://127.0.0.1:1/private' } })
    }
  })
  try {
    const origin = `http://127.0.0.1:${server.port}`
    await expect(
      downloadMedia(
        origin,
        (url) => {
          return oneBotMediaAllowed(url, [origin])
        },
        new AbortController().signal
      )
    ).rejects.toThrow('允许的地址')
    expect(oneBotMediaAllowed(new URL('https://gchat.qpic.cn/media'), [])).toBe(true)
    expect(oneBotMediaAllowed(new URL('https://qpic.cn.attacker.invalid/media'), [])).toBe(false)
    const result = parseOneBotContent(
      '文字&#91;literal&#93;[CQ:image,file=abc,url=https://gchat.qpic.cn/a?x=1&amp;y=2&#44;3]'
    )
    expect(result.text).toBe('文字[literal][图片]')
    expect(result.attachments[0].reference.url).toBe('https://gchat.qpic.cn/a?x=1&y=2,3')
    await expect(
      downloadMedia(
        'file:///etc/passwd',
        () => {
          return true
        },
        new AbortController().signal
      )
    ).rejects.toThrow('允许的地址')
  } finally {
    await server.stop(true)
  }
})
