import { expect, test } from 'bun:test'
import { z } from 'zod'
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import { jobHarness } from './job-harness'
import { responsesReply } from './responses-fixture'
import { pngImage } from './image-fixture'
import { ConversationBinding } from '@pi-im-bot/agent/durable/documents'
import { inspectImage } from '@pi-im-bot/media/image'
import { createFakeShipyard } from './shipyard-fixture'
import { ShipyardConfigSchema } from '@pi-im-bot/execution/config'

const ContentSchema = z.union([
  z.string(),
  z.array(
    z
      .object({ type: z.string(), image_url: z.string().optional(), text: z.string().optional() })
      .passthrough()
  )
])
const RequestSchema = z.object({
  input: z.array(
    z
      .object({
        role: z.string().optional(),
        content: ContentSchema.optional(),
        output: ContentSchema.optional()
      })
      .passthrough()
  )
})
function images(raw: string) {
  return RequestSchema.parse(JSON.parse(raw)).input.flatMap((entry) => {
    return [entry.content, entry.output].flatMap((content) => {
      if (!Array.isArray(content)) {
        return []
      }
      return content.filter((part) => {
        return part.type === 'input_image'
      })
    })
  })
}

test('uploaded images are resized for the current durable request, remain references in history, and can be explicitly quoted later', async () => {
  const env = await jobHarness(() => {
    return responsesReply({ kind: 'text', text: 'IMAGE_ANALYZED' })
  })
  try {
    const attachment = await env.media.upload(
      env.room,
      new File([pngImage(2048, 1024)], 'wide.png', { type: 'image/png' })
    )
    const first = await env.coordinator.receive(env.room.id, 'Inspect this image', 'alice', 'Alice', [
      attachment.mediaId!
    ])
    expect(first).not.toBeNull()
    expect((await env.coordinator.waitRun(first!.id)).status).toBe('completed')
    const pixels = images(env.requests[0])
    expect(pixels).toHaveLength(1)
    const image = inspectImage(Buffer.from(pixels[0].image_url!.split(',')[1], 'base64'))
    expect(image.width).toBeLessThanOrEqual(1536)
    const binding = await env.runtime.native.snapshot(
      ConversationBinding,
      env.room.id + ':' + first!.context!.conversationId + ':' + first!.mode,
      BACKGROUND_CONTEXT
    )
    const nativeId = binding!.conversationId!
    const conversation = (await env.runtime.native.conversation(nativeId, BACKGROUND_CONTEXT))!
    const history = await conversation.entries({}, 100, undefined, BACKGROUND_CONTEXT)
    expect(JSON.stringify(history)).not.toContain(pixels[0].image_url!.split(',')[1])
    const second = await env.coordinator.receive(env.room.id, 'A plain follow-up', 'bob', 'Bob')
    await env.coordinator.waitRun(second!.id)
    expect(images(env.requests.at(-1)!)).toHaveLength(0)
    const original = env.store.listMessages(env.room.id).find((message) => {
      return message.role === 'user'
    })!
    const quoted = await env.coordinator.receive(env.room.id, 'Look at the quoted image', 'bob', 'Bob', [], {
      messageId: original.id
    })
    await env.coordinator.waitRun(quoted!.id)
    expect(images(env.requests.at(-1)!)).toHaveLength(1)
    expect(env.requests.at(-1)).toContain('Alice')
    expect(env.requests.at(-1)).toContain('引用资料')
    const other = env.coordinator.createMockRoom('other', 'group')
    await expect(
      env.coordinator.receive(other.id, 'steal', 'bob', 'Bob', [attachment.mediaId!])
    ).rejects.toThrow('当前会话')
    await expect(
      env.coordinator.receive(other.id, 'quote', 'bob', 'Bob', [], { messageId: original.id })
    ).rejects.toThrow('当前会话')
  } finally {
    await env.close()
  }
})

test('batched image requests keep speaker provenance, intersect media permission and report omitted pixels without granting the quoted author authority', async () => {
  const env = await jobHarness(() => {
    return responsesReply({ kind: 'text', text: 'BATCH_DONE' })
  })
  try {
    env.config.framework.defaults.behavior.batchQuietMs = 80
    env.config.framework.defaults.permissions.rules = [
      {
        effect: 'deny',
        capabilities: ['media_read'],
        subjects: [{ kind: 'platform-user', channel: 'mock', accountId: 'mock-bot', actorId: 'bob' }]
      }
    ]
    const attachment = await env.media.upload(
      env.room,
      new File([pngImage()], 'batch.png', { type: 'image/png' })
    )
    async function receive(actorId: string, id: string) {
      return env.coordinator.receiveIncoming(
        env.room.id,
        {
          address: env.room.address,
          externalId: id,
          actorId,
          actorName: actorId,
          text: 'image question ' + actorId,
          attachments: [],
          receivedAt: Date.now()
        },
        'image question ' + actorId
      )
    }
    await receive('alice', 'a')
    const alice = env.store.listMessages(env.room.id).at(-1)!
    // An already observed image may be quoted by another member; it supplies no authority.
    env.store.saveMessage({ ...alice, attachments: [attachment] })
    await env.coordinator.receiveIncoming(
      env.room.id,
      {
        address: env.room.address,
        externalId: 'b',
        actorId: 'bob',
        actorName: 'bob',
        text: 'quoted question',
        attachments: [],
        replyTo: { platformMessageId: 'a' },
        receivedAt: Date.now()
      },
      'quoted question'
    )
    const run = env.store.listRuns(env.room.id)[0]
    await env.coordinator.waitRun(run.id)
    expect(env.requests).toHaveLength(1)
    expect(images(env.requests[0])).toHaveLength(0)
    expect(env.requests[0]).toContain('alice')
    expect(env.requests[0]).toContain('bob')
    expect(env.requests[0]).toContain('未提供像素')
    expect(env.store.getRun(run.id)?.context?.authority.capabilities).not.toContain('media_read')
  } finally {
    await env.close()
  }
})

test('an explicit older-image read takes the visual budget ahead of automatic pictures and can stage bytes only into the current sandbox', async () => {
  const bay = createFakeShipyard()
  let olderId = ''
  const env = await jobHarness((_raw, call) => {
    if (call === 1) {
      return responsesReply({ kind: 'tool', name: 'media_read', arguments: { id: olderId, stage: true } })
    }
    return responsesReply({ kind: 'text', text: 'READ_OLD_IMAGE' })
  })
  try {
    env.config.bot.agent.execution = ShipyardConfigSchema.parse({
      backend: 'shipyard',
      endpoint: bay.endpoint,
      apiKey: 'test-bay-key'
    })
    env.config.framework.defaults.data.imageMaxCount = 1
    const older = await env.media.upload(
      env.room,
      new File([pngImage(32, 16)], 'older.png', { type: 'image/png' })
    )
    const current = await env.media.upload(
      env.room,
      new File([pngImage(16, 16)], 'current.png', { type: 'image/png' })
    )
    olderId = older.mediaId!
    const run = await env.coordinator.receive(
      env.room.id,
      'Compare with older media ' + olderId,
      'alice',
      'Alice',
      [current.mediaId!]
    )
    expect((await env.coordinator.waitRun(run!.id)).status).toBe('completed')
    const pixels = images(env.requests.at(-1)!)
    expect(pixels).toHaveLength(1)
    expect(inspectImage(Buffer.from(pixels[0].image_url!.split(',')[1], 'base64')).width).toBe(32)
    expect(env.requests.at(-1)).toContain('/workspace/.bot-media/' + olderId)
    expect(bay.files.get('sbx-1')?.get('/workspace/.bot-media/' + olderId + '.png')).toEqual(pngImage(32, 16))
  } finally {
    await env.close()
    await bay.close()
  }
})
