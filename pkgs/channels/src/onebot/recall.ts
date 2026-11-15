import { z } from 'zod'
import type { Address } from '@pi-im-bot/contracts/message'

const IdSchema = z.union([z.string(), z.number()]).transform(String)
const RecallSchema = z.object({
  post_type: z.literal('notice'),
  notice_type: z.enum(['group_recall', 'friend_recall']),
  self_id: IdSchema,
  group_id: IdSchema.optional(),
  user_id: IdSchema.optional(),
  message_id: IdSchema
})
export function parseRecall(input: unknown, selfId: string) {
  const result = RecallSchema.safeParse(input)
  if (!result.success || result.data.self_id !== selfId) {
    return undefined
  }
  const notice = result.data
  let kind: Address['kind'] = 'direct'
  let chatId = notice.user_id
  if (notice.notice_type === 'group_recall') {
    kind = 'group'
    chatId = notice.group_id
  }
  if (!chatId) {
    return undefined
  }
  return { address: { channel: 'onebot-v11', accountId: selfId, kind, chatId }, messageId: notice.message_id }
}
