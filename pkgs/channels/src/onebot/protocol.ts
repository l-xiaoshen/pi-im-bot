import { z } from 'zod'
import { parseOneBotContent } from './content'

const IdSchema = z.union([z.string(), z.number()]).transform(String)
export const OneBotSegmentSchema = z.object({ type: z.string(), data: z.record(z.string(), z.unknown()) })
export const OneBotMessageSchema = z.object({
  post_type: z.enum(['message', 'message_sent']),
  message_type: z.enum(['group', 'private']),
  self_id: IdSchema,
  user_id: IdSchema,
  group_id: IdSchema.optional(),
  group_name: z.string().optional(),
  message_id: IdSchema,
  time: z.number().optional(),
  message: z.union([z.string(), z.array(OneBotSegmentSchema)]),
  sender: z
    .object({
      nickname: z.string().optional(),
      card: z.string().optional(),
      role: z.enum(['owner', 'admin', 'member']).optional()
    })
    .default({})
})
export type OneBotMessage = z.infer<typeof OneBotMessageSchema>
export const OneBotResponseSchema = z.object({
  echo: z.string(),
  retcode: z.number(),
  status: z.string().optional(),
  data: z.unknown().optional(),
  message: z.string().optional(),
  wording: z.string().optional()
})

export function messageText(event: OneBotMessage) {
  return parseOneBotContent(event.message).text
}
