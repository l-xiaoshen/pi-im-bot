import { z } from 'zod'
import type { Attachment, ChatMessage } from '@pi-im-bot/contracts/message'

export const ImageReferenceSchema = z.object({
  source: z.enum(['media', 'artifact']),
  id: z.uuid(),
  type: z.enum(['image', 'audio', 'video', 'file']),
  name: z.string().max(200)
})
export type ImageReference = z.infer<typeof ImageReferenceSchema>
export const QuoteContextSchema = z.object({
  state: z.enum(['observed', 'not_observed', 'recalled']),
  messageId: z.string().optional(),
  platformMessageId: z.string().optional(),
  text: z.string().optional(),
  actorId: z.string().optional(),
  actorName: z.string().optional(),
  attachments: z.array(ImageReferenceSchema).default([])
})
export type QuoteContext = z.infer<typeof QuoteContextSchema>

export function attachmentReferences(roomId: string, attachments: readonly Attachment[]): ImageReference[] {
  return attachments.flatMap((attachment): ImageReference[] => {
    if (attachment.mediaId) {
      return [
        { source: 'media' as const, id: attachment.mediaId, type: attachment.type, name: attachment.name }
      ]
    }
    const prefix = `/api/rooms/${encodeURIComponent(roomId)}/artifacts/`
    if (attachment.url.startsWith(prefix)) {
      const id = attachment.url.slice(prefix.length).split('/')[0]
      if (z.uuid().safeParse(id).success) {
        return [
          { source: 'artifact' as const, id, type: attachment.type, name: attachment.name.slice(0, 200) }
        ]
      }
    }
    return []
  })
}

export function quoteContext(message: ChatMessage): QuoteContext {
  if (message.recalled) {
    return { state: 'recalled', messageId: message.id, attachments: [] }
  }
  return {
    state: 'observed',
    messageId: message.id,
    text: message.text.slice(0, 8000),
    actorId: message.actorId,
    actorName: message.actorName,
    attachments: attachmentReferences(message.roomId, message.attachments)
  }
}
