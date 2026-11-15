import { z } from 'zod'
import { BACKGROUND_CONTEXT, awaitWithContext, withAbortSignal } from '@earendil-works/chord/context'
import type { StateStore } from '@pi-im-bot/storage/state'
import type { ChannelRegistry } from '@pi-im-bot/channels/registry'
import { ChatMessageSchema, addressKey, type Room, type Attachment } from '@pi-im-bot/contracts/message'
import { ArtifactStore } from '@pi-im-bot/artifacts/store'
import { IncomingMediaSchema, type IncomingMedia, type MediaRecord } from './schema'
import { RunLimiter } from '@pi-im-bot/support/limiter'
import { inspectImage, projectImage } from './image'
import { quoteContext, type QuoteContext, type ImageReference } from './provenance'

export class MediaService {
  private readonly pending = new Map<
    string,
    { task: Promise<string>; controller: AbortController; readers: number }
  >()
  private readonly downloads = new RunLimiter(2)
  private readonly decoders = new RunLimiter(2)
  constructor(
    private readonly dataDir: string,
    private readonly store: Pick<StateStore, keyof StateStore>,
    private readonly channels: ChannelRegistry
  ) {}

  capture(room: Room, messageId: string, input: IncomingMedia): Attachment {
    const media = IncomingMediaSchema.parse(input)
    const record: MediaRecord = {
      ...media,
      id: crypto.randomUUID(),
      roomId: room.id,
      messageId,
      createdAt: Date.now()
    }
    this.store.saveMedia(record)
    return this.attachment(record)
  }

  require(roomId: string, id: string) {
    z.uuid().parse(id)
    const record = this.store.getMedia(id)
    if (!record || record.roomId !== roomId) {
      throw new Error('当前会话中不存在该媒体')
    }
    if (record.messageId && this.store.getMessage(record.messageId)?.recalled) {
      throw new Error('来源消息已撤回')
    }
    return record
  }

  attachment(record: MediaRecord): Attachment {
    return {
      type: record.type,
      name: record.name,
      mimeType: record.mimeType,
      mediaId: record.id,
      url: `/api/rooms/${encodeURIComponent(record.roomId)}/media/${record.id}/content`
    }
  }

  async upload(room: Room, file: File) {
    if (file.size > 8 * 1024 * 1024 || file.size === 0) {
      throw new Error('附件须为 1 字节至 8 MiB')
    }
    const bytes = new Uint8Array(await file.arrayBuffer())
    let mimeType = file.type || 'application/octet-stream'
    let type: Attachment['type'] = 'file'
    if (file.type.startsWith('image/')) {
      mimeType = inspectImage(bytes).mimeType
      type = 'image'
    }
    if (file.type.startsWith('audio/')) {
      type = 'audio'
    }
    if (file.type.startsWith('video/')) {
      type = 'video'
    }
    const name = file.name.slice(0, 200) || 'attachment'
    const id = crypto.randomUUID()
    const artifact = await new ArtifactStore(this.dataDir, room.id, undefined, undefined, () => {
      return { mediaIds: [id], capabilities: ['media_read'] }
    }).save(name, mimeType, 'upload', bytes)
    const record: MediaRecord = {
      id,
      roomId: room.id,
      name,
      mimeType,
      type,
      artifactId: artifact.id,
      createdAt: Date.now()
    }
    this.store.saveMedia(record)
    return this.attachment(record)
  }

  async resolve(room: Room, id: string, signal: AbortSignal) {
    signal.throwIfAborted()
    const record = this.require(room.id, id)
    let artifactId = record.artifactId
    if (!artifactId) {
      if (record.error) {
        throw new Error(record.error)
      }
      let shared = this.pending.get(id)
      if (!shared) {
        const controller = new AbortController()
        shared = { task: this.fetch(room, record, controller.signal), controller, readers: 0 }
        this.pending.set(id, shared)
        const current = shared
        const cleanup = () => {
          if (this.pending.get(id) === current) {
            this.pending.delete(id)
          }
        }
        void shared.task.then(cleanup, cleanup)
      }
      shared.readers += 1
      try {
        artifactId = await awaitWithContext(shared.task, withAbortSignal(signal, BACKGROUND_CONTEXT))
      } finally {
        shared.readers -= 1
        if (shared.readers === 0 && this.pending.get(id) === shared) {
          this.pending.delete(id)
          shared.controller.abort(new Error('媒体读取已取消'))
        }
      }
    }
    signal.throwIfAborted()
    this.require(room.id, id)
    return new ArtifactStore(this.dataDir, room.id).content(artifactId)
  }

  retry(roomId: string, id: string) {
    const record = this.require(roomId, id)
    this.store.saveMedia({ ...record, error: undefined })
  }
  async quote(room: Room, reference: QuoteContext, signal: AbortSignal) {
    if (reference.platformMessageId && this.store.wasRecalled(room.id, reference.platformMessageId)) {
      return { ...reference, state: 'recalled' as const, text: undefined, attachments: [] }
    }
    let known = undefined
    if (reference.messageId) {
      known = this.store.getMessage(reference.messageId)
    }
    if (!known && reference.platformMessageId) {
      known = this.store.findPlatformMessage(room.id, reference.platformMessageId)
    }
    if (known && known.roomId === room.id) {
      return quoteContext(known)
    }
    if (reference.state !== 'not_observed' || !reference.platformMessageId) {
      return reference
    }
    const adapter = this.channels.get(room.address.channel)
    if (!adapter.lookupMessage) {
      return reference
    }
    const incoming = await adapter.lookupMessage(room.address, reference.platformMessageId, signal)
    if (
      addressKey(incoming.address) !== addressKey(room.address) ||
      incoming.externalId !== reference.platformMessageId
    ) {
      throw new Error('引用消息来源与请求不匹配')
    }
    signal.throwIfAborted()
    const existing = this.store.findPlatformMessage(room.id, incoming.externalId)
    if (existing) {
      return quoteContext(existing)
    }
    const id = crypto.randomUUID()
    let role: 'user' | 'assistant' = 'user'
    if (incoming.isSelf) {
      role = 'assistant'
    }
    const message = ChatMessageSchema.parse({
      id,
      roomId: room.id,
      role,
      actorId: incoming.actorId,
      actorName: incoming.actorName,
      text: incoming.text,
      attachments: incoming.attachments.map((media) => {
        return this.capture(room, id, media)
      }),
      createdAt: incoming.receivedAt,
      platformMessageIds: [incoming.externalId],
      recalled: this.store.wasRecalled(room.id, incoming.externalId)
    })
    this.store.saveMessage(message)
    return quoteContext(message)
  }
  async content(room: Room, reference: Pick<ImageReference, 'id' | 'source'>, signal: AbortSignal) {
    if (reference.source === 'media') {
      return this.resolve(room, reference.id, signal)
    }
    signal.throwIfAborted()
    return new ArtifactStore(this.dataDir, room.id).content(reference.id)
  }
  async preview(
    room: Room,
    reference: Pick<ImageReference, 'id' | 'source'>,
    maxSide: number,
    maxBytes: number,
    signal: AbortSignal
  ) {
    const { metadata, file } = await this.content(room, reference, signal)
    if (file.size > 8 * 1024 * 1024) {
      throw new Error('图片超过读取预算')
    }
    const release = await this.decoders.acquire(signal)
    try {
      signal.throwIfAborted()
      const image = await projectImage(new Uint8Array(await file.arrayBuffer()), maxSide, maxBytes)
      signal.throwIfAborted()
      return { ...image, artifactId: metadata.id }
    } finally {
      release()
    }
  }

  private async fetch(room: Room, record: MediaRecord, parent: AbortSignal) {
    const signal = AbortSignal.any([parent, AbortSignal.timeout(15000)])
    const release = await this.downloads.acquire(signal)
    try {
      const adapter = this.channels.get(room.address.channel)
      if (!adapter.readMedia || !record.reference) {
        throw new Error('媒体读取未配置')
      }
      const content = await adapter.readMedia(
        room.address,
        { ...record, reference: record.reference },
        signal
      )
      if (!content.data.byteLength || content.data.byteLength > 8 * 1024 * 1024) {
        throw new Error('媒体大小不在预算内')
      }
      let mimeType = content.mimeType
      if (record.type === 'image') {
        mimeType = inspectImage(content.data).mimeType
      }
      signal.throwIfAborted()
      this.require(room.id, record.id)
      const artifact = await new ArtifactStore(this.dataDir, room.id, undefined, undefined, () => {
        return { mediaIds: [record.id], capabilities: ['media_read'] }
      }).save(record.name, mimeType, 'im:' + room.address.channel, content.data)
      signal.throwIfAborted()
      this.require(room.id, record.id)
      this.store.saveMedia({ ...record, artifactId: artifact.id, mimeType })
      return artifact.id
    } catch {
      parent.throwIfAborted()
      const error = '媒体暂不可用：来源可能过期、格式不支持或超过下载预算。可在网页重新读取。'
      this.store.saveMedia({ ...record, error })
      throw new Error(error)
    } finally {
      release()
    }
  }
}
