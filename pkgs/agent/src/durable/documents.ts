import { defineDoc, defineDocFamily, type ConversationId } from '@earendil-works/pi-durable'

export const ConversationIndex = defineDoc<{ conversations: Record<string, ConversationId> }>({
  kind: 'bot.conversation-index',
  version: 1,
  scope: 'session',
  initial: () => ({ conversations: {} }),
  checkpointWhen: () => false
})

export const ConversationBindingsReady = defineDoc<{ migrated: boolean }>({
  kind: 'bot.conversation-bindings-ready',
  version: 1,
  scope: 'session',
  initial: () => ({ migrated: false }),
  checkpointWhen: () => true
})
export const ConversationBinding = defineDocFamily<{ conversationId: ConversationId | null }, null>({
  kind: 'bot.conversation-binding',
  version: 1,
  scope: 'session',
  family: true,
  initial: () => ({ conversationId: null }),
  checkpointWhen: () => true
})

export const ToolExposure = defineDoc<{ turn: number; lastUsed: Record<string, number> }>({
  kind: 'bot.tool-exposure',
  version: 1,
  scope: 'conversation',
  history: 'latest',
  fork: 'current',
  initial: () => ({ turn: 0, lastUsed: {} }),
  checkpointWhen: () => false
})
