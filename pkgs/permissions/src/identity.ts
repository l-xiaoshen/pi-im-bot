import { z } from 'zod'

export const TriggerIdentitySchema = z.object({
  origin: z.enum(['platform', 'local', 'mock', 'legacy']),
  actorId: z.string(),
  actorName: z.string(),
  channel: z.string(),
  accountId: z.string(),
  role: z.enum(['owner', 'admin', 'member']).optional(),
  messageIds: z.array(z.string()).default([])
})
export type TriggerIdentity = Readonly<z.infer<typeof TriggerIdentitySchema>>

export const AuthoritySchema = z.object({
  identities: z.array(TriggerIdentitySchema).min(1),
  capabilities: z.array(z.string()),
  policyRevision: z.string()
})
export type Authority = z.infer<typeof AuthoritySchema>

// Editable Web/Mock display labels are never platform credentials.
export function localIdentity(
  channel: string,
  accountId: string,
  actorId = 'developer',
  actorName = '开发者'
): TriggerIdentity {
  let origin: TriggerIdentity['origin'] = 'local'
  if (channel === 'mock') {
    origin = 'mock'
  }
  return Object.freeze({ origin, channel, accountId, actorId, actorName, messageIds: [] })
}
