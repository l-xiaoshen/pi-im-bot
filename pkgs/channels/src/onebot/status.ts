import { z } from 'zod'
import { OneBotTargetsSchema } from './config'
import { MediaOriginsSchema } from './media'

export const DiscoveredChatSchema = z.object({
  selfId: z.string(),
  chatId: z.string(),
  name: z.string(),
  kind: z.enum(['group', 'direct']),
  seenAt: z.number()
})
export type DiscoveredChat = z.infer<typeof DiscoveredChatSchema>
export const RouteReasonSchema = z.enum([
  'recorded',
  'command',
  'agent',
  'duplicate',
  'uncertain',
  'unmatched',
  'not_selected',
  'self',
  'invalid',
  'disabled',
  'error'
])
export type RouteReason = z.infer<typeof RouteReasonSchema>
export const OneBotStatusSchema = z.object({
  connected: z.boolean(),
  accounts: z.array(z.string()),
  received: z.number(),
  recorded: z.number(),
  lastReceivedAt: z.number().nullable(),
  lastAuthFailure: z.object({ at: z.number(), reason: z.string() }).nullable(),
  chats: z.array(DiscoveredChatSchema),
  recent: z.array(
    z.object({
      at: z.number(),
      selfId: z.string(),
      chatId: z.string().optional(),
      reason: RouteReasonSchema
    })
  )
})
export type OneBotStatus = z.infer<typeof OneBotStatusSchema>
export const OneBotPublicSettingsSchema = z.object({
  version: z.string(),
  enabled: z.boolean(),
  path: z.string(),
  commandPrefix: z.string(),
  tokenConfigured: z.boolean(),
  allowPrivate: z.boolean(),
  mediaOrigins: MediaOriginsSchema.default([]),
  targets: OneBotTargetsSchema
})
export type OneBotPublicSettings = z.infer<typeof OneBotPublicSettingsSchema>
export const OneBotSettingsInputSchema = z
  .object({
    version: z.string(),
    enabled: z.boolean(),
    commandPrefix: z.string().trim().min(1).max(32),
    accessToken: z.string().max(4096).optional(),
    clearToken: z.boolean().default(false),
    mediaOrigins: MediaOriginsSchema.optional(),
    targets: OneBotTargetsSchema
  })
  .refine((input) => {
    return !input.clearToken || !input.accessToken
  }, '不能同时填写和清除 Token')
export type OneBotSettingsInput = z.infer<typeof OneBotSettingsInputSchema>
