import type { Tx } from '@earendil-works/pi-durable'
import { ConversationBinding, ConversationBindingsReady, ConversationIndex } from './documents'

export async function migrateConversationIndex(tx: Tx) {
  const state = await tx.doc(ConversationBindingsReady)
  if (state.migrated) {
    return
  }
  const legacy = await tx.doc(ConversationIndex)
  for (const [key, id] of Object.entries(legacy.conversations)) {
    const binding = await tx.doc(ConversationBinding, key, null)
    binding.conversationId = id
  }
  legacy.conversations = {}
  state.migrated = true
}
