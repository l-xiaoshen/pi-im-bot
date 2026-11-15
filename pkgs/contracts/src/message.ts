import { z } from "zod"
import { SettingsPatchSchema } from "@pi-im-bot/settings/schema"
import { ReplyReferenceSchema, type IncomingMedia, type ReplyReference } from "@pi-im-bot/media/schema"
import { InboundAdmissionSchema } from "@pi-im-bot/messages/admission"

export const AddressSchema = z.object({
  channel: z.string().min(1),
  accountId: z.string().min(1),
  kind: z.enum(["group", "direct"]),
  chatId: z.string().min(1),
  threadId: z.string().optional()
})
export type Address = z.infer<typeof AddressSchema>

export const AttachmentSchema = z.object({
  type: z.enum(["image", "file", "audio", "video"]),
  name: z.string(),
  url: z.string(),
  mimeType: z.string().optional(),
  mediaId: z.uuid().optional()
})
export type Attachment = z.infer<typeof AttachmentSchema>

export const RoomSchema = z.object({
  id: z.string(),
  name: z.string(),
  address: AddressSchema,
  mode: z.enum(["demo", "live"]),
  currentConversationId: z.string().default(""),
  conversationEpoch: z.number().int().nonnegative().default(0),
  settings: SettingsPatchSchema.prefault({}),
  revision: z.number().int().min(1).default(1),
  createdAt: z.number(),
  updatedAt: z.number()
})
export type Room = z.infer<typeof RoomSchema>

export const ChatMessageSchema = z.object({
  id: z.string(),
  roomId: z.string(),
  role: z.enum(["user", "assistant", "system"]),
  actorId: z.string(),
  actorName: z.string(),
  text: z.string(),
  attachments: z.array(AttachmentSchema).default([]),
  replyTo: ReplyReferenceSchema.optional(),
  createdAt: z.number(),
  runId: z.string().optional(),
  conversationId: z.string().optional(),
  platformMessageIds: z.array(z.string()).default([]),
  recalled: z.boolean().default(false),
  recalledPlatformIds: z.array(z.string()).optional(),
  deliveryState: z.enum(["sent", "unknown", "partial"]).optional(),
  inbound: InboundAdmissionSchema.optional()
})
export type ChatMessage = z.infer<typeof ChatMessageSchema>

export interface IncomingMessage {
  address: Address
  externalId: string
  actorId: string
  actorName: string
  text: string
  attachments: IncomingMedia[]
  replyTo?: ReplyReference
  receivedAt: number
  isSelf?: boolean
  platformRole?: "owner" | "admin" | "member"
}

export type InboundOutcome = "recorded" | "command" | "agent" | "duplicate" | "unmatched" | "self" | "uncertain"

export interface DeliveryReceipt {
  messageIds: string[]
  sentAt: number
}

export function addressKey(address: Address) {
  return JSON.stringify([address.channel, address.accountId, address.kind, address.chatId, address.threadId ?? ""])
}
