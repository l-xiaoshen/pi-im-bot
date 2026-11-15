import { z } from 'zod'
import type { PluginHostServices } from './rpc/services'
import type { PluginInvocation } from './invocation'
import { reserveMediaSources } from '@pi-im-bot/media/dependencies'

export const MediaReadSchema = z
  .object({
    mediaId: z.uuid(),
    offset: z.number().int().min(0).default(0),
    limit: z.number().int().min(0).max(196608).default(65536),
    maxBytes: z
      .number()
      .int()
      .min(1)
      .max(8 * 1024 * 1024)
      .default(8 * 1024 * 1024)
  })
  .strict()
export const MediaChunkSchema = z
  .object({
    mediaId: z.uuid(),
    name: z.string(),
    mimeType: z.string(),
    bytes: z.number().int().nonnegative(),
    offset: z.number().int().nonnegative(),
    base64: z.base64(),
    hasMore: z.boolean()
  })
  .strict()
const MimeSchema = z
  .string()
  .max(200)
  .transform((value) => {
    return value.split(';')[0].trim().toLowerCase()
  })
  .pipe(z.string().regex(/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/u))

export function registerPluginMedia(
  host: PluginHostServices,
  invocation: PluginInvocation,
  authorize: () => void,
  sources: Set<string>
) {
  let total = 0
  let reads = 0
  host.register('media.read', 'media.read', MediaReadSchema, async (input, context) => {
    authorize()
    reads += 1
    total += input.limit
    if (reads > 128 || total > 8 * 1024 * 1024) {
      throw new Error('本次媒体读取额度已用完')
    }
    const media = invocation.services.media
    if (!media) {
      throw new Error('入站媒体服务未配置')
    }
    reserveMediaSources(sources, [input.mediaId])
    const { metadata, file } = await media.content({ source: 'media', id: input.mediaId }, context.signal)
    if (metadata.bytes > input.maxBytes || file.size !== metadata.bytes || file.size === 0) {
      throw new Error('媒体超过本次读取预算或内容大小不匹配')
    }
    const bytes = await file.slice(input.offset, input.offset + input.limit).arrayBuffer()
    context.signal.throwIfAborted()
    authorize()
    media.require(input.mediaId)
    return MediaChunkSchema.parse({
      mediaId: input.mediaId,
      name: metadata.name,
      mimeType: MimeSchema.parse(metadata.mimeType),
      bytes: metadata.bytes,
      offset: input.offset,
      base64: Buffer.from(bytes).toString('base64'),
      hasMore: input.offset + bytes.byteLength < metadata.bytes
    })
  })
}
