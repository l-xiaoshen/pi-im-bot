import { z } from "zod"
import { OneBotMessageInputSchema, OneBotMessageSchema } from "./message"

/**
 * OneBot 11 documents IDs as int64 numbers, but implementations frequently
 * serialise them as strings. Accept numbers, numeric strings, and bigints, then
 * normalise to a spec-compliant int64 bigint.
 */
export const OneBotIdSchema = z
  .union([z.number().int(), z.string().regex(/^-?\d+$/u, "ID 必须是整数"), z.bigint()])
  .transform((value) => BigInt(value))
  .pipe(z.int64())
export type OneBotId = z.infer<typeof OneBotIdSchema>

export const OneBotSexSchema = z.enum(["male", "female", "unknown"])
export type OneBotSex = z.infer<typeof OneBotSexSchema>

export const OneBotRoleSchema = z.enum(["owner", "admin", "member"])
export type OneBotRole = z.infer<typeof OneBotRoleSchema>

export const OneBotAnonymousSchema = z.object({
  id: OneBotIdSchema,
  name: z.string(),
  flag: z.string()
})
export type OneBotAnonymous = z.infer<typeof OneBotAnonymousSchema>

/**
 * Sender fields are best-effort in the spec, so every field is optional.
 */
export const OneBotPrivateSenderSchema = z.object({
  user_id: OneBotIdSchema.optional(),
  nickname: z.string().optional(),
  sex: OneBotSexSchema.optional(),
  age: z.number().int().optional()
})
export type OneBotPrivateSender = z.infer<typeof OneBotPrivateSenderSchema>

export const OneBotGroupSenderSchema = OneBotPrivateSenderSchema.extend({
  card: z.string().optional(),
  area: z.string().optional(),
  level: z.string().optional(),
  role: OneBotRoleSchema.optional(),
  title: z.string().optional()
})
export type OneBotGroupSender = z.infer<typeof OneBotGroupSenderSchema>

export const OneBotStatusSchema = z.looseObject({
  online: z.boolean().nullable(),
  good: z.boolean()
})
export type OneBotStatus = z.infer<typeof OneBotStatusSchema>

const OneBotEventBaseSchema = {
  time: z.number().int(),
  self_id: OneBotIdSchema
}

const OneBotMessageEventBaseSchema = {
  ...OneBotEventBaseSchema,
  post_type: z.literal("message"),
  message_id: OneBotIdSchema,
  user_id: OneBotIdSchema,
  message: OneBotMessageSchema,
  raw_message: z.string(),
  font: z.number().int()
}

export const OneBotPrivateMessageEventSchema = z.object({
  ...OneBotMessageEventBaseSchema,
  message_type: z.literal("private"),
  sub_type: z.enum(["friend", "group", "other"]),
  sender: OneBotPrivateSenderSchema
})
export type OneBotPrivateMessageEvent = z.infer<typeof OneBotPrivateMessageEventSchema>

export const OneBotGroupMessageEventSchema = z.object({
  ...OneBotMessageEventBaseSchema,
  message_type: z.literal("group"),
  sub_type: z.enum(["normal", "anonymous", "notice"]),
  group_id: OneBotIdSchema,
  anonymous: OneBotAnonymousSchema.nullable(),
  sender: OneBotGroupSenderSchema
})
export type OneBotGroupMessageEvent = z.infer<typeof OneBotGroupMessageEventSchema>

export const OneBotMessageEventSchema = z.discriminatedUnion("message_type", [
  OneBotPrivateMessageEventSchema,
  OneBotGroupMessageEventSchema
])
export type OneBotMessageEvent = z.infer<typeof OneBotMessageEventSchema>

const OneBotNoticeEventBaseSchema = {
  ...OneBotEventBaseSchema,
  post_type: z.literal("notice")
}

export const OneBotGroupUploadNoticeEventSchema = z.object({
  ...OneBotNoticeEventBaseSchema,
  notice_type: z.literal("group_upload"),
  group_id: OneBotIdSchema,
  user_id: OneBotIdSchema,
  file: z.object({
    id: z.string(),
    name: z.string(),
    size: z.number().int(),
    busid: z.number().int()
  })
})
export type OneBotGroupUploadNoticeEvent = z.infer<typeof OneBotGroupUploadNoticeEventSchema>

export const OneBotGroupAdminNoticeEventSchema = z.object({
  ...OneBotNoticeEventBaseSchema,
  notice_type: z.literal("group_admin"),
  sub_type: z.enum(["set", "unset"]),
  group_id: OneBotIdSchema,
  user_id: OneBotIdSchema
})
export type OneBotGroupAdminNoticeEvent = z.infer<typeof OneBotGroupAdminNoticeEventSchema>

export const OneBotGroupDecreaseNoticeEventSchema = z.object({
  ...OneBotNoticeEventBaseSchema,
  notice_type: z.literal("group_decrease"),
  sub_type: z.enum(["leave", "kick", "kick_me"]),
  group_id: OneBotIdSchema,
  operator_id: OneBotIdSchema,
  user_id: OneBotIdSchema
})
export type OneBotGroupDecreaseNoticeEvent = z.infer<typeof OneBotGroupDecreaseNoticeEventSchema>

export const OneBotGroupIncreaseNoticeEventSchema = z.object({
  ...OneBotNoticeEventBaseSchema,
  notice_type: z.literal("group_increase"),
  sub_type: z.enum(["approve", "invite"]),
  group_id: OneBotIdSchema,
  operator_id: OneBotIdSchema,
  user_id: OneBotIdSchema
})
export type OneBotGroupIncreaseNoticeEvent = z.infer<typeof OneBotGroupIncreaseNoticeEventSchema>

export const OneBotGroupBanNoticeEventSchema = z.object({
  ...OneBotNoticeEventBaseSchema,
  notice_type: z.literal("group_ban"),
  sub_type: z.enum(["ban", "lift_ban"]),
  group_id: OneBotIdSchema,
  operator_id: OneBotIdSchema,
  user_id: OneBotIdSchema,
  duration: z.number().int()
})
export type OneBotGroupBanNoticeEvent = z.infer<typeof OneBotGroupBanNoticeEventSchema>

export const OneBotFriendAddNoticeEventSchema = z.object({
  ...OneBotNoticeEventBaseSchema,
  notice_type: z.literal("friend_add"),
  user_id: OneBotIdSchema
})
export type OneBotFriendAddNoticeEvent = z.infer<typeof OneBotFriendAddNoticeEventSchema>

export const OneBotGroupRecallNoticeEventSchema = z.object({
  ...OneBotNoticeEventBaseSchema,
  notice_type: z.literal("group_recall"),
  group_id: OneBotIdSchema,
  user_id: OneBotIdSchema,
  operator_id: OneBotIdSchema,
  message_id: OneBotIdSchema
})
export type OneBotGroupRecallNoticeEvent = z.infer<typeof OneBotGroupRecallNoticeEventSchema>

export const OneBotFriendRecallNoticeEventSchema = z.object({
  ...OneBotNoticeEventBaseSchema,
  notice_type: z.literal("friend_recall"),
  user_id: OneBotIdSchema,
  message_id: OneBotIdSchema
})
export type OneBotFriendRecallNoticeEvent = z.infer<typeof OneBotFriendRecallNoticeEventSchema>

export const OneBotPokeNoticeEventSchema = z.object({
  ...OneBotNoticeEventBaseSchema,
  notice_type: z.literal("notify"),
  sub_type: z.literal("poke"),
  group_id: OneBotIdSchema,
  user_id: OneBotIdSchema,
  target_id: OneBotIdSchema
})
export type OneBotPokeNoticeEvent = z.infer<typeof OneBotPokeNoticeEventSchema>

export const OneBotLuckyKingNoticeEventSchema = z.object({
  ...OneBotNoticeEventBaseSchema,
  notice_type: z.literal("notify"),
  sub_type: z.literal("lucky_king"),
  group_id: OneBotIdSchema,
  user_id: OneBotIdSchema,
  target_id: OneBotIdSchema
})
export type OneBotLuckyKingNoticeEvent = z.infer<typeof OneBotLuckyKingNoticeEventSchema>

export const OneBotHonorNoticeEventSchema = z.object({
  ...OneBotNoticeEventBaseSchema,
  notice_type: z.literal("notify"),
  sub_type: z.literal("honor"),
  group_id: OneBotIdSchema,
  user_id: OneBotIdSchema,
  honor_type: z.enum(["talkative", "performer", "emotion"])
})
export type OneBotHonorNoticeEvent = z.infer<typeof OneBotHonorNoticeEventSchema>

export const OneBotNoticeEventSchema = z.union([
  OneBotGroupUploadNoticeEventSchema,
  OneBotGroupAdminNoticeEventSchema,
  OneBotGroupDecreaseNoticeEventSchema,
  OneBotGroupIncreaseNoticeEventSchema,
  OneBotGroupBanNoticeEventSchema,
  OneBotFriendAddNoticeEventSchema,
  OneBotGroupRecallNoticeEventSchema,
  OneBotFriendRecallNoticeEventSchema,
  OneBotPokeNoticeEventSchema,
  OneBotLuckyKingNoticeEventSchema,
  OneBotHonorNoticeEventSchema
])
export type OneBotNoticeEvent = z.infer<typeof OneBotNoticeEventSchema>

const OneBotRequestEventBaseSchema = {
  ...OneBotEventBaseSchema,
  post_type: z.literal("request")
}

export const OneBotFriendRequestEventSchema = z.object({
  ...OneBotRequestEventBaseSchema,
  request_type: z.literal("friend"),
  user_id: OneBotIdSchema,
  comment: z.string(),
  flag: z.string()
})
export type OneBotFriendRequestEvent = z.infer<typeof OneBotFriendRequestEventSchema>

export const OneBotGroupRequestEventSchema = z.object({
  ...OneBotRequestEventBaseSchema,
  request_type: z.literal("group"),
  sub_type: z.enum(["add", "invite"]),
  group_id: OneBotIdSchema,
  user_id: OneBotIdSchema,
  comment: z.string(),
  flag: z.string()
})
export type OneBotGroupRequestEvent = z.infer<typeof OneBotGroupRequestEventSchema>

export const OneBotRequestEventSchema = z.discriminatedUnion("request_type", [
  OneBotFriendRequestEventSchema,
  OneBotGroupRequestEventSchema
])
export type OneBotRequestEvent = z.infer<typeof OneBotRequestEventSchema>

const OneBotMetaEventBaseSchema = {
  ...OneBotEventBaseSchema,
  post_type: z.literal("meta_event")
}

export const OneBotLifecycleMetaEventSchema = z.object({
  ...OneBotMetaEventBaseSchema,
  meta_event_type: z.literal("lifecycle"),
  sub_type: z.enum(["enable", "disable", "connect"])
})
export type OneBotLifecycleMetaEvent = z.infer<typeof OneBotLifecycleMetaEventSchema>

export const OneBotHeartbeatMetaEventSchema = z.object({
  ...OneBotMetaEventBaseSchema,
  meta_event_type: z.literal("heartbeat"),
  status: OneBotStatusSchema,
  interval: z.number().int()
})
export type OneBotHeartbeatMetaEvent = z.infer<typeof OneBotHeartbeatMetaEventSchema>

export const OneBotMetaEventSchema = z.discriminatedUnion("meta_event_type", [
  OneBotLifecycleMetaEventSchema,
  OneBotHeartbeatMetaEventSchema
])
export type OneBotMetaEvent = z.infer<typeof OneBotMetaEventSchema>

export const OneBotEventSchema = z.union([
  OneBotMessageEventSchema,
  OneBotNoticeEventSchema,
  OneBotRequestEventSchema,
  OneBotMetaEventSchema
])
export type OneBotEvent = z.infer<typeof OneBotEventSchema>

/**
 * Quick operations accepted in HTTP POST responses and by the hidden
 * `.handle_quick_operation` API. Fields are only meaningful for the matching
 * event type, so the object is intentionally loose.
 */
export const OneBotQuickOperationSchema = z.looseObject({
  reply: OneBotMessageInputSchema.optional(),
  auto_escape: z.boolean().optional(),
  at_sender: z.boolean().optional(),
  delete: z.boolean().optional(),
  kick: z.boolean().optional(),
  ban: z.boolean().optional(),
  ban_duration: z.number().int().optional(),
  approve: z.boolean().optional(),
  remark: z.string().optional(),
  reason: z.string().optional()
})
export type OneBotQuickOperation = z.infer<typeof OneBotQuickOperationSchema>
