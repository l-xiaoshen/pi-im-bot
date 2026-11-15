import { z } from 'zod'
import { RoomSchema } from '@pi-im-bot/contracts/message'
import { ConversationSchema } from './schema'

const LegacyRoomSchema = z.object({
  generation: z.number().int().nonnegative().default(0),
  providerGroup: z.string().optional()
})

export function migrateRoom(value: unknown) {
  const room = RoomSchema.parse(value)
  if (room.currentConversationId) {
    return { room }
  }
  const legacy = LegacyRoomSchema.parse(value)
  if (legacy.providerGroup) {
    room.settings.preferences = { ...room.settings.preferences, providerGroup: legacy.providerGroup }
  }
  const conversation = ConversationSchema.parse({
    id: crypto.randomUUID(),
    roomId: room.id,
    title: '已有对话',
    // Keep Pi's existing on-disk session mapping; no history or workspace copy.
    sessionKey: `${room.id}:${legacy.generation}`,
    createdAt: room.createdAt,
    updatedAt: room.updatedAt
  })
  room.currentConversationId = conversation.id
  room.conversationEpoch = legacy.generation
  return { room, conversation }
}
