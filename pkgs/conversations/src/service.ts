import type { Room } from "@pi-im-bot/contracts/message"
import type { StateStore } from "@pi-im-bot/storage/state"
import type { EventHub } from "@pi-im-bot/contracts/events"
import { ConversationSchema, type Conversation } from "./schema"

export class ConversationService {
  constructor(
    private readonly store: Pick<StateStore, keyof StateStore>,
    private readonly events: EventHub
  ) {}

  require(id: string, roomId: string) {
    const conversation = this.store.getConversation(id)
    if (!conversation || conversation.roomId !== roomId) {
      throw new Error("对话不属于当前聊天范围")
    }
    return conversation
  }

  current(room: Room) {
    return this.require(room.currentConversationId, room.id)
  }

  create(room: Room, title = "新对话", kind: Conversation["kind"] = "root", parentId?: string) {
    const id = crypto.randomUUID()
    const conversation = ConversationSchema.parse({
      id,
      roomId: room.id,
      title,
      kind,
      parentId,
      sessionKey: id,
      createdAt: Date.now(),
      updatedAt: Date.now()
    })
    if (kind === "root") {
      this.select(room, conversation)
    } else {
      this.store.saveConversation(conversation)
    }
    return conversation
  }

  ensureChild(room: Room, id: string, title: string, parentId: string) {
    const existing = this.store.getConversation(id)
    if (existing) {
      if (existing.roomId !== room.id || existing.kind !== "job" || existing.parentId !== parentId) {
        throw new Error("任务对话标识冲突")
      }
      return existing
    }
    const conversation = ConversationSchema.parse({
      id,
      roomId: room.id,
      title,
      kind: "job",
      parentId,
      sessionKey: id,
      createdAt: Date.now(),
      updatedAt: Date.now()
    })
    this.store.saveConversation(conversation)
    return conversation
  }

  select(room: Room, conversation: Conversation) {
    if (conversation.roomId !== room.id || conversation.kind !== "root") {
      throw new Error("只能切换到本聊天范围的主对话")
    }
    const next = {
      ...room,
      currentConversationId: conversation.id,
      conversationEpoch: room.conversationEpoch + 1,
      revision: room.revision + 1,
      updatedAt: Date.now()
    }
    this.store.saveConversationSelection(next, conversation)
    this.events.emit({ type: "room", room: next })
    return next
  }
}
