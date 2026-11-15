import { z } from "zod"
import type { ChatMessage } from "@pi-im-bot/contracts/message"

export const RecallRecordSchema = z.object({
  id: z.string(),
  roomId: z.string(),
  platformMessageId: z.string(),
  createdAt: z.number()
})
export type RecallRecord = z.infer<typeof RecallRecordSchema>
export function recallKey(roomId: string, platformId: string) {
  return JSON.stringify([roomId, platformId])
}

export function recalledMessage(message: ChatMessage, ids: readonly string[]) {
  const recalledPlatformIds = [...new Set([...(message.recalledPlatformIds ?? []), ...ids])]
  return {
    ...message,
    recalledPlatformIds,
    recalled:
      message.recalled ||
      (message.platformMessageIds.length > 0 &&
        message.platformMessageIds.every((id) => {
          return recalledPlatformIds.includes(id)
        }))
  }
}
