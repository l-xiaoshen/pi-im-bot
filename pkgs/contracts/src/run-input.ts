import { z } from 'zod'
import { AuthoritySchema, TriggerIdentitySchema } from '@pi-im-bot/permissions/identity'
import { ImageReferenceSchema, QuoteContextSchema } from '@pi-im-bot/media/provenance'

export const RunSourceSchema = z.enum(['im', 'command', 'schedule', 'job'])
export const BatchPartSchema = z.object({
  messageId: z.string(),
  text: z.string(),
  actorId: z.string(),
  actorName: z.string(),
  receivedAt: z.number(),
  attachments: z.array(ImageReferenceSchema).default([]),
  quote: QuoteContextSchema.optional()
})
export const RunInputSchema = z.object({
  scheduled: z.object({ id: z.string(), name: z.string(), at: z.number(), timezone: z.string() }).optional(),
  roomId: z.string(),
  text: z.string(),
  actorId: z.string(),
  actorName: z.string(),
  source: RunSourceSchema,
  receivedAt: z.number(),
  identities: z.array(TriggerIdentitySchema).min(1).readonly(),
  inheritedAuthority: AuthoritySchema.optional(),
  parts: z.array(BatchPartSchema).readonly().optional(),
  conversationId: z.string().optional(),
  workspaceScope: z.string().optional(),
  attachments: z.array(ImageReferenceSchema).optional(),
  quote: QuoteContextSchema.optional()
})
export type RunInput = z.infer<typeof RunInputSchema>
