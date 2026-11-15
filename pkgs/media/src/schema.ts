import { z } from 'zod'

export const PlatformMediaRefSchema = z.object({
  id: z.string().max(1024 * 1024),
  url: z.string().max(16000).optional()
})
export type PlatformMediaRef = z.infer<typeof PlatformMediaRefSchema>
export const IncomingMediaSchema = z.object({
  type: z.enum(['image', 'audio', 'video', 'file']),
  name: z.string().max(200),
  mimeType: z.string().max(100).optional(),
  reference: PlatformMediaRefSchema
})
export type IncomingMedia = z.infer<typeof IncomingMediaSchema>
export const MediaRecordSchema = z.object({
  id: z.uuid(),
  roomId: z.string(),
  messageId: z.string().optional(),
  type: IncomingMediaSchema.shape.type,
  name: z.string().max(200),
  mimeType: z.string().optional(),
  createdAt: z.number(),
  reference: PlatformMediaRefSchema.optional(),
  artifactId: z.uuid().optional(),
  error: z.string().optional()
})
export type MediaRecord = z.infer<typeof MediaRecordSchema>
export interface MediaBytes {
  data: Uint8Array
  mimeType: string
}

export const ReplyReferenceSchema = z
  .object({
    messageId: z.string().optional(),
    platformMessageId: z.string().optional()
  })
  .refine((reference) => {
    return Boolean(reference.messageId || reference.platformMessageId)
  }, '引用缺少消息 ID')
export type ReplyReference = z.infer<typeof ReplyReferenceSchema>
