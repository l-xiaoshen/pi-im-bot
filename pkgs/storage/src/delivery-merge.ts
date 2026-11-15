import type { ChatMessage } from "@pi-im-bot/contracts/message"
import type { Outbound } from "@pi-im-bot/contracts/delivery"
import { recalledMessage } from "@pi-im-bot/messages/recall"

export function deliveryMessage(outbound: Outbound): ChatMessage {
  let text = outbound.renderedText ?? outbound.text
  if (outbound.inlineRender) {
    text = outbound.text
  }
  let deliveryState: ChatMessage["deliveryState"] = "sent"
  if (outbound.state !== "sent") {
    deliveryState = "unknown"
  }
  if (outbound.state === "cancelled") {
    deliveryState = "partial"
  }
  return {
    id: outbound.messageId,
    roomId: outbound.roomId,
    role: outbound.role,
    actorId: "bot",
    actorName: "Pi",
    text,
    attachments: outbound.attachments,
    createdAt: outbound.sentAt ?? outbound.createdAt,
    platformMessageIds: outbound.platformMessageIds,
    runId: outbound.runId,
    conversationId: outbound.conversationId,
    recalled: false,
    deliveryState
  }
}

export function mergeDeliveryEchoes(message: ChatMessage, echoes: ChatMessage[]) {
  const related = echoes.filter((echo) => {
    return echo.roomId === message.roomId && echo.role !== "user" && echo.id !== message.id
  })
  return {
    message: recalledMessage(
      message,
      related.flatMap((echo) => {
        if (echo.recalled) {
          return echo.platformMessageIds
        }
        return echo.recalledPlatformIds ?? []
      })
    ),
    removedIds: [
      ...new Set(
        related.map((echo) => {
          return echo.id
        })
      )
    ]
  }
}
