import { z } from "zod"
import { OneBotMessageInputSchema, OneBotMessageSchema } from "./message"

/**
 * OneBot 11 标准中 ID 为 int64 数字，但实现经常将其序列化为字符串。
 * 这里接受数字、数字字符串和 bigint，并统一转换为符合标准的 int64 bigint。
 */
export const OneBotIdSchema = z
  .union([z.number().int(), z.string().regex(/^-?\d+$/u, "ID 必须是整数"), z.bigint()])
  .transform((value) => BigInt(value))
  .pipe(z.int64())
export type OneBotId = z.infer<typeof OneBotIdSchema>

/** 性别。 */
export const OneBotSexSchema = z.enum(["male", "female", "unknown"])
export type OneBotSex = z.infer<typeof OneBotSexSchema>

/** 群成员角色。 */
export const OneBotRoleSchema = z.enum(["owner", "admin", "member"])
export type OneBotRole = z.infer<typeof OneBotRoleSchema>

/** 匿名信息。 */
export const OneBotAnonymousSchema = z.object({
  id: OneBotIdSchema,
  name: z.string(),
  flag: z.string()
})
export type OneBotAnonymous = z.infer<typeof OneBotAnonymousSchema>

/**
 * 私聊消息发送人信息。标准中发送人字段为尽力提供，因此所有字段都是可选的。
 */
export const OneBotPrivateSenderSchema = z.object({
  user_id: OneBotIdSchema.optional(),
  nickname: z.string().optional(),
  sex: OneBotSexSchema.optional(),
  age: z.number().int().optional()
})
export type OneBotPrivateSender = z.infer<typeof OneBotPrivateSenderSchema>

/** 群消息发送人信息。 */
export const OneBotGroupSenderSchema = OneBotPrivateSenderSchema.extend({
  card: z.string().optional(),
  area: z.string().optional(),
  level: z.string().optional(),
  role: OneBotRoleSchema.optional(),
  title: z.string().optional()
})
export type OneBotGroupSender = z.infer<typeof OneBotGroupSenderSchema>

/** OneBot 运行状态。 */
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

/** 私聊消息事件。 */
export const OneBotPrivateMessageEventSchema = z.object({
  ...OneBotMessageEventBaseSchema,
  message_type: z.literal("private"),
  sub_type: z.enum(["friend", "group", "other"]),
  sender: OneBotPrivateSenderSchema
})
export type OneBotPrivateMessageEvent = z.infer<typeof OneBotPrivateMessageEventSchema>

/** 群消息事件。 */
export const OneBotGroupMessageEventSchema = z.object({
  ...OneBotMessageEventBaseSchema,
  message_type: z.literal("group"),
  sub_type: z.enum(["normal", "anonymous", "notice"]),
  group_id: OneBotIdSchema,
  anonymous: OneBotAnonymousSchema.nullable(),
  sender: OneBotGroupSenderSchema
})
export type OneBotGroupMessageEvent = z.infer<typeof OneBotGroupMessageEventSchema>

/** 消息事件。 */
export const OneBotMessageEventSchema = z.discriminatedUnion("message_type", [
  OneBotPrivateMessageEventSchema,
  OneBotGroupMessageEventSchema
])
export type OneBotMessageEvent = z.infer<typeof OneBotMessageEventSchema>

const OneBotNoticeEventBaseSchema = {
  ...OneBotEventBaseSchema,
  post_type: z.literal("notice")
}

/** 群文件上传。 */
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

/** 群管理员变动。 */
export const OneBotGroupAdminNoticeEventSchema = z.object({
  ...OneBotNoticeEventBaseSchema,
  notice_type: z.literal("group_admin"),
  sub_type: z.enum(["set", "unset"]),
  group_id: OneBotIdSchema,
  user_id: OneBotIdSchema
})
export type OneBotGroupAdminNoticeEvent = z.infer<typeof OneBotGroupAdminNoticeEventSchema>

/** 群成员减少。 */
export const OneBotGroupDecreaseNoticeEventSchema = z.object({
  ...OneBotNoticeEventBaseSchema,
  notice_type: z.literal("group_decrease"),
  sub_type: z.enum(["leave", "kick", "kick_me"]),
  group_id: OneBotIdSchema,
  operator_id: OneBotIdSchema,
  user_id: OneBotIdSchema
})
export type OneBotGroupDecreaseNoticeEvent = z.infer<typeof OneBotGroupDecreaseNoticeEventSchema>

/** 群成员增加。 */
export const OneBotGroupIncreaseNoticeEventSchema = z.object({
  ...OneBotNoticeEventBaseSchema,
  notice_type: z.literal("group_increase"),
  sub_type: z.enum(["approve", "invite"]),
  group_id: OneBotIdSchema,
  operator_id: OneBotIdSchema,
  user_id: OneBotIdSchema
})
export type OneBotGroupIncreaseNoticeEvent = z.infer<typeof OneBotGroupIncreaseNoticeEventSchema>

/** 群禁言。 */
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

/** 好友添加。 */
export const OneBotFriendAddNoticeEventSchema = z.object({
  ...OneBotNoticeEventBaseSchema,
  notice_type: z.literal("friend_add"),
  user_id: OneBotIdSchema
})
export type OneBotFriendAddNoticeEvent = z.infer<typeof OneBotFriendAddNoticeEventSchema>

/** 群消息撤回。 */
export const OneBotGroupRecallNoticeEventSchema = z.object({
  ...OneBotNoticeEventBaseSchema,
  notice_type: z.literal("group_recall"),
  group_id: OneBotIdSchema,
  user_id: OneBotIdSchema,
  operator_id: OneBotIdSchema,
  message_id: OneBotIdSchema
})
export type OneBotGroupRecallNoticeEvent = z.infer<typeof OneBotGroupRecallNoticeEventSchema>

/** 好友消息撤回。 */
export const OneBotFriendRecallNoticeEventSchema = z.object({
  ...OneBotNoticeEventBaseSchema,
  notice_type: z.literal("friend_recall"),
  user_id: OneBotIdSchema,
  message_id: OneBotIdSchema
})
export type OneBotFriendRecallNoticeEvent = z.infer<typeof OneBotFriendRecallNoticeEventSchema>

/** 群内戳一戳。 */
export const OneBotPokeNoticeEventSchema = z.object({
  ...OneBotNoticeEventBaseSchema,
  notice_type: z.literal("notify"),
  sub_type: z.literal("poke"),
  group_id: OneBotIdSchema,
  user_id: OneBotIdSchema,
  target_id: OneBotIdSchema
})
export type OneBotPokeNoticeEvent = z.infer<typeof OneBotPokeNoticeEventSchema>

/** 群红包运气王。 */
export const OneBotLuckyKingNoticeEventSchema = z.object({
  ...OneBotNoticeEventBaseSchema,
  notice_type: z.literal("notify"),
  sub_type: z.literal("lucky_king"),
  group_id: OneBotIdSchema,
  user_id: OneBotIdSchema,
  target_id: OneBotIdSchema
})
export type OneBotLuckyKingNoticeEvent = z.infer<typeof OneBotLuckyKingNoticeEventSchema>

/** 群成员荣誉变更。 */
export const OneBotHonorNoticeEventSchema = z.object({
  ...OneBotNoticeEventBaseSchema,
  notice_type: z.literal("notify"),
  sub_type: z.literal("honor"),
  group_id: OneBotIdSchema,
  user_id: OneBotIdSchema,
  honor_type: z.enum(["talkative", "performer", "emotion"])
})
export type OneBotHonorNoticeEvent = z.infer<typeof OneBotHonorNoticeEventSchema>

/** 通知事件。 */
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

/** 加好友请求。 */
export const OneBotFriendRequestEventSchema = z.object({
  ...OneBotRequestEventBaseSchema,
  request_type: z.literal("friend"),
  user_id: OneBotIdSchema,
  comment: z.string(),
  flag: z.string()
})
export type OneBotFriendRequestEvent = z.infer<typeof OneBotFriendRequestEventSchema>

/** 加群请求／邀请。 */
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

/** 请求事件。 */
export const OneBotRequestEventSchema = z.discriminatedUnion("request_type", [
  OneBotFriendRequestEventSchema,
  OneBotGroupRequestEventSchema
])
export type OneBotRequestEvent = z.infer<typeof OneBotRequestEventSchema>

const OneBotMetaEventBaseSchema = {
  ...OneBotEventBaseSchema,
  post_type: z.literal("meta_event")
}

/** 生命周期元事件。 */
export const OneBotLifecycleMetaEventSchema = z.object({
  ...OneBotMetaEventBaseSchema,
  meta_event_type: z.literal("lifecycle"),
  sub_type: z.enum(["enable", "disable", "connect"])
})
export type OneBotLifecycleMetaEvent = z.infer<typeof OneBotLifecycleMetaEventSchema>

/** 心跳元事件。 */
export const OneBotHeartbeatMetaEventSchema = z.object({
  ...OneBotMetaEventBaseSchema,
  meta_event_type: z.literal("heartbeat"),
  status: OneBotStatusSchema,
  interval: z.number().int()
})
export type OneBotHeartbeatMetaEvent = z.infer<typeof OneBotHeartbeatMetaEventSchema>

/** 元事件。 */
export const OneBotMetaEventSchema = z.discriminatedUnion("meta_event_type", [
  OneBotLifecycleMetaEventSchema,
  OneBotHeartbeatMetaEventSchema
])
export type OneBotMetaEvent = z.infer<typeof OneBotMetaEventSchema>

/** 事件。 */
export const OneBotEventSchema = z.union([
  OneBotMessageEventSchema,
  OneBotNoticeEventSchema,
  OneBotRequestEventSchema,
  OneBotMetaEventSchema
])
export type OneBotEvent = z.infer<typeof OneBotEventSchema>

/**
 * 快速操作，可在 HTTP POST 响应中返回，也可通过隐藏 API
 * `.handle_quick_operation` 执行。字段只对相应的事件类型有意义，
 * 因此对象允许额外字段。
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
