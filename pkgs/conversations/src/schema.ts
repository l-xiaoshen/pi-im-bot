import { z } from 'zod'
import { SettingsPatchSchema } from '@pi-im-bot/settings/schema'

export const ConversationSchema = z.object({
  id: z.string().min(1),
  roomId: z.string().min(1),
  title: z.string().min(1).max(100),
  kind: z.enum(['root', 'schedule', 'job']).default('root'),
  parentId: z.string().optional(),
  sessionKey: z.string().min(1),
  settings: SettingsPatchSchema.prefault({}),
  revision: z.number().int().min(1).default(1),
  createdAt: z.number(),
  updatedAt: z.number()
})
export type Conversation = z.infer<typeof ConversationSchema>
