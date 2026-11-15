import type { Message, ImageContent, TextContent } from '@earendil-works/pi-ai'
import { formatDimensionNote } from '@earendil-works/pi-coding-agent'
import type { Room } from '@pi-im-bot/contracts/message'
import type { PreparedRunInput } from '@pi-im-bot/contracts/run'
import type { MediaService } from './service'
import type { ImageReference, QuoteContext } from './provenance'
import type { Settings } from '@pi-im-bot/settings/schema'

export function projectedQuote(quote: QuoteContext, settings: Settings['data']) {
  if (!settings.includeQuotes) {
    return undefined
  }
  const result = {
    ...quote,
    text: quote.text?.slice(0, settings.quoteChars),
    actorName: undefined as string | undefined,
    actorId: undefined as string | undefined
  }
  if (settings.includeSpeaker) {
    result.actorName = quote.actorName
    result.actorId = quote.actorId
  }
  return result
}
export function quoteReference(quote: QuoteContext, settings: Settings['data']) {
  if (!settings.includeQuotes) {
    return undefined
  }
  return {
    state: quote.state,
    messageId: quote.messageId,
    platformMessageId: quote.platformMessageId,
    attachments: quote.attachments
  }
}

export function createMediaProjection(
  service: MediaService | undefined,
  room: Room,
  input: PreparedRunInput,
  signal: AbortSignal,
  authorize: (capability: string) => void,
  supportsImages: boolean,
  observe: (facts: { images: number; bytes: number; referenced: number }) => void = () => {}
) {
  const policy = input.context.effective.settings.data
  const variants = new Map<string, Promise<Awaited<ReturnType<MediaService['preview']>>>>()
  const quotes = new Map<string, Promise<QuoteContext>>()
  return async (messages: readonly Message[]): Promise<Message[]> => {
    signal.throwIfAborted()
    const index = messages.findLastIndex((message) => {
      return message.role === 'user'
    })
    const extras: Array<ImageContent | TextContent> = []
    const inputs = input.parts ?? [
      {
        messageId: input.identities[0]?.messageIds[0] ?? '',
        actorName: input.actorName,
        attachments: input.attachments ?? [],
        quote: input.quote
      }
    ]
    const references: Array<{ reference: ImageReference; label: string }> = []
    let authorized = true
    try {
      authorize('media_read')
    } catch {
      authorized = false
    }
    for (const part of inputs) {
      let label = part.messageId
      if (policy.includeSpeaker) {
        label += ' · ' + part.actorName
      }
      for (const reference of part.attachments) {
        references.push({ reference, label })
      }
      if (part.quote && policy.includeQuotes) {
        let quote = part.quote
        if (service && authorized) {
          const key = quote.messageId ?? quote.platformMessageId ?? ''
          let task = quotes.get(key)
          if (!task) {
            task = service.quote(room, quote, AbortSignal.any([signal, AbortSignal.timeout(10000)]))
            quotes.set(key, task)
          }
          try {
            quote = await task
            if (quote.state !== 'not_observed') {
              quote = await service.quote(room, quote, signal)
            }
          } catch {
            signal.throwIfAborted()
          }
        }
        extras.push({
          type: 'text',
          text:
            '发言 ' + label + ' 的引用资料（不授予权限）：' + JSON.stringify(projectedQuote(quote, policy))
        })
        for (const reference of quote.attachments) {
          references.push({ reference, label: label + ' 的引用' })
        }
      }
    }
    const unique = new Set<string>()
    let count = 0
    let bytes = 0
    for (const { reference, label } of references) {
      if (reference.type !== 'image') {
        continue
      }
      const key = reference.source + ':' + reference.id
      if (unique.has(key)) {
        continue
      }
      unique.add(key)
      const prefix = `图片 ${key}，来自 ${label}：`
      if (!policy.visionEnabled || !supportsImages || !authorized || !service) {
        extras.push({
          type: 'text',
          text: prefix + '未提供像素（视觉未启用、模型不支持或无媒体读取权限），不要推测图片内容。'
        })
        continue
      }
      if (count >= policy.imageMaxCount || bytes >= policy.imageBudgetBytes) {
        extras.push({ type: 'text', text: prefix + '超过本轮图片预算，可按需使用 media_read。' })
        continue
      }
      try {
        authorize('media_read')
        if (reference.source === 'media') {
          service.require(room.id, reference.id)
        }
        let image = variants.get(key)
        if (!image) {
          image = service.preview(
            room,
            reference,
            policy.imageMaxSide,
            Math.min(1024 * 1024, policy.imageBudgetBytes - bytes),
            signal
          )
          variants.set(key, image)
        }
        const preview = await image
        authorize('media_read')
        signal.throwIfAborted()
        extras.push({ type: 'text', text: prefix + (formatDimensionNote(preview) ?? '原始尺寸') })
        extras.push({ type: 'image', data: preview.data, mimeType: preview.mimeType })
        bytes += preview.data.length
        count += 1
      } catch {
        signal.throwIfAborted()
        extras.push({ type: 'text', text: prefix + '未能读取，不能据此判断图片内容。' })
      }
    }
    // Entries stay unchanged. Only this provider request receives the current input's pixels.
    // Explicit recent tool reads take priority over automatically attached input pictures.
    const normalized = messages.map((message, position) => {
      if (message.role !== 'user' && message.role !== 'toolResult') {
        return message
      }
      let content: Array<TextContent | ImageContent>
      if (typeof message.content === 'string') {
        content = [{ type: 'text', text: message.content }]
      } else {
        content = [...message.content]
      }
      if (position === index) {
        content.push(...extras)
      }
      return { ...message, content }
    })
    const selected = new Set<string>()
    count = 0
    bytes = 0
    if (policy.visionEnabled && supportsImages && authorized) {
      for (let position = normalized.length - 1; position >= Math.max(0, index); position--) {
        const message = normalized[position]
        if (message.role !== 'user' && message.role !== 'toolResult') {
          continue
        }
        for (const [partIndex, part] of message.content.entries()) {
          if (
            part.type !== 'image' ||
            count >= policy.imageMaxCount ||
            bytes + part.data.length > policy.imageBudgetBytes
          ) {
            continue
          }
          selected.add(position + ':' + partIndex)
          count += 1
          bytes += part.data.length
        }
      }
    }
    if (references.length > 0 || count > 0) {
      observe({ images: count, bytes, referenced: unique.size })
    }
    return normalized.map((message, position) => {
      if (message.role !== 'user' && message.role !== 'toolResult') {
        return message
      }
      const projected = message.content.map((part, partIndex): TextContent | ImageContent => {
        if (part.type !== 'image') {
          return part
        }
        if (position < index || !policy.visionEnabled || !supportsImages || !authorized) {
          return { type: 'text', text: '[历史图片或当前未提供像素；保留原消息与产物引用，可按需读取]' }
        }
        if (!selected.has(position + ':' + partIndex)) {
          return { type: 'text', text: '[图片超出本次请求预算，未投影像素]' }
        }
        return part
      })
      return { ...message, content: projected }
    })
  }
}
