import { defineDocFamily, type ConversationId } from "@earendil-works/pi-durable"

export const ConversationBinding = defineDocFamily<{ conversationId: ConversationId | null }, null>({
  kind: "bot.conversation-binding",
  version: 1,
  scope: "session",
  family: true,
  initial: () => ({ conversationId: null }),
  checkpointWhen: () => true
})
