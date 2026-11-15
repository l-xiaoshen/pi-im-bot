import { z } from "zod"
import {
  OneBotAnonymousSchema,
  OneBotGroupSenderSchema,
  OneBotIdSchema,
  OneBotQuickOperationSchema,
  OneBotSexSchema,
  OneBotStatusSchema
} from "./event"
import { OneBotMessageInputSchema, OneBotMessageSchema } from "./message"
import { OneBotNodeSegmentSchema } from "./segment"

/** 发送私聊消息。 */
export const OneBotSendPrivateMsgParamsSchema = z.object({
  user_id: OneBotIdSchema,
  message: OneBotMessageInputSchema,
  auto_escape: z.boolean().optional()
})
export type OneBotSendPrivateMsgParams = z.infer<typeof OneBotSendPrivateMsgParamsSchema>

/** 发送群消息。 */
export const OneBotSendGroupMsgParamsSchema = z.object({
  group_id: OneBotIdSchema,
  message: OneBotMessageInputSchema,
  auto_escape: z.boolean().optional()
})
export type OneBotSendGroupMsgParams = z.infer<typeof OneBotSendGroupMsgParamsSchema>

/** 发送消息。 */
export const OneBotSendMsgParamsSchema = z.object({
  message_type: z.enum(["private", "group"]).optional(),
  user_id: OneBotIdSchema.optional(),
  group_id: OneBotIdSchema.optional(),
  message: OneBotMessageInputSchema,
  auto_escape: z.boolean().optional()
})
export type OneBotSendMsgParams = z.infer<typeof OneBotSendMsgParamsSchema>

/** 撤回消息。 */
export const OneBotDeleteMsgParamsSchema = z.object({ message_id: OneBotIdSchema })
export type OneBotDeleteMsgParams = z.infer<typeof OneBotDeleteMsgParamsSchema>

/** 获取消息。 */
export const OneBotGetMsgParamsSchema = z.object({ message_id: OneBotIdSchema })
export type OneBotGetMsgParams = z.infer<typeof OneBotGetMsgParamsSchema>

/** 获取合并转发消息。 */
export const OneBotGetForwardMsgParamsSchema = z.object({ id: z.string() })
export type OneBotGetForwardMsgParams = z.infer<typeof OneBotGetForwardMsgParamsSchema>

/** 发送好友赞。 */
export const OneBotSendLikeParamsSchema = z.object({
  user_id: OneBotIdSchema,
  times: z.number().int().optional()
})
export type OneBotSendLikeParams = z.infer<typeof OneBotSendLikeParamsSchema>

/** 群组踢人。 */
export const OneBotSetGroupKickParamsSchema = z.object({
  group_id: OneBotIdSchema,
  user_id: OneBotIdSchema,
  reject_add_request: z.boolean().optional()
})
export type OneBotSetGroupKickParams = z.infer<typeof OneBotSetGroupKickParamsSchema>

/** 群组单人禁言。 */
export const OneBotSetGroupBanParamsSchema = z.object({
  group_id: OneBotIdSchema,
  user_id: OneBotIdSchema,
  duration: z.number().int().optional()
})
export type OneBotSetGroupBanParams = z.infer<typeof OneBotSetGroupBanParamsSchema>

/** 群组匿名用户禁言。 */
export const OneBotSetGroupAnonymousBanParamsSchema = z
  .object({
    group_id: OneBotIdSchema,
    anonymous: OneBotAnonymousSchema.optional(),
    anonymous_flag: z.string().optional(),
    flag: z.string().optional(),
    duration: z.number().int().optional()
  })
  .refine((params) => {
    return params.anonymous !== undefined || params.anonymous_flag !== undefined || params.flag !== undefined
  }, "anonymous、anonymous_flag 或 flag 必须提供其一")
export type OneBotSetGroupAnonymousBanParams = z.infer<typeof OneBotSetGroupAnonymousBanParamsSchema>

/** 群组全员禁言。 */
export const OneBotSetGroupWholeBanParamsSchema = z.object({
  group_id: OneBotIdSchema,
  enable: z.boolean().optional()
})
export type OneBotSetGroupWholeBanParams = z.infer<typeof OneBotSetGroupWholeBanParamsSchema>

/** 群组设置管理员。 */
export const OneBotSetGroupAdminParamsSchema = z.object({
  group_id: OneBotIdSchema,
  user_id: OneBotIdSchema,
  enable: z.boolean().optional()
})
export type OneBotSetGroupAdminParams = z.infer<typeof OneBotSetGroupAdminParamsSchema>

/** 群组匿名。 */
export const OneBotSetGroupAnonymousParamsSchema = z.object({
  group_id: OneBotIdSchema,
  enable: z.boolean().optional()
})
export type OneBotSetGroupAnonymousParams = z.infer<typeof OneBotSetGroupAnonymousParamsSchema>

/** 设置群名片（群备注）。 */
export const OneBotSetGroupCardParamsSchema = z.object({
  group_id: OneBotIdSchema,
  user_id: OneBotIdSchema,
  card: z.string().optional()
})
export type OneBotSetGroupCardParams = z.infer<typeof OneBotSetGroupCardParamsSchema>

/** 设置群名。 */
export const OneBotSetGroupNameParamsSchema = z.object({
  group_id: OneBotIdSchema,
  group_name: z.string()
})
export type OneBotSetGroupNameParams = z.infer<typeof OneBotSetGroupNameParamsSchema>

/** 退出群组。 */
export const OneBotSetGroupLeaveParamsSchema = z.object({
  group_id: OneBotIdSchema,
  is_dismiss: z.boolean().optional()
})
export type OneBotSetGroupLeaveParams = z.infer<typeof OneBotSetGroupLeaveParamsSchema>

/** 设置群组专属头衔。 */
export const OneBotSetGroupSpecialTitleParamsSchema = z.object({
  group_id: OneBotIdSchema,
  user_id: OneBotIdSchema,
  special_title: z.string().optional(),
  duration: z.number().int().optional()
})
export type OneBotSetGroupSpecialTitleParams = z.infer<typeof OneBotSetGroupSpecialTitleParamsSchema>

/** 处理加好友请求。 */
export const OneBotSetFriendAddRequestParamsSchema = z.object({
  flag: z.string(),
  approve: z.boolean().optional(),
  remark: z.string().optional()
})
export type OneBotSetFriendAddRequestParams = z.infer<typeof OneBotSetFriendAddRequestParamsSchema>

/** 处理加群请求／邀请。 */
export const OneBotSetGroupAddRequestParamsSchema = z
  .object({
    flag: z.string(),
    sub_type: z.enum(["add", "invite"]).optional(),
    type: z.enum(["add", "invite"]).optional(),
    approve: z.boolean().optional(),
    reason: z.string().optional()
  })
  .refine((params) => {
    return params.sub_type !== undefined || params.type !== undefined
  }, "sub_type 或 type 必须提供其一")
export type OneBotSetGroupAddRequestParams = z.infer<typeof OneBotSetGroupAddRequestParamsSchema>

/** 获取陌生人信息。 */
export const OneBotGetStrangerInfoParamsSchema = z.object({
  user_id: OneBotIdSchema,
  no_cache: z.boolean().optional()
})
export type OneBotGetStrangerInfoParams = z.infer<typeof OneBotGetStrangerInfoParamsSchema>

/** 获取群信息。 */
export const OneBotGetGroupInfoParamsSchema = z.object({
  group_id: OneBotIdSchema,
  no_cache: z.boolean().optional()
})
export type OneBotGetGroupInfoParams = z.infer<typeof OneBotGetGroupInfoParamsSchema>

/** 获取群成员信息。 */
export const OneBotGetGroupMemberInfoParamsSchema = z.object({
  group_id: OneBotIdSchema,
  user_id: OneBotIdSchema,
  no_cache: z.boolean().optional()
})
export type OneBotGetGroupMemberInfoParams = z.infer<typeof OneBotGetGroupMemberInfoParamsSchema>

/** 获取群成员列表。 */
export const OneBotGetGroupMemberListParamsSchema = z.object({ group_id: OneBotIdSchema })
export type OneBotGetGroupMemberListParams = z.infer<typeof OneBotGetGroupMemberListParamsSchema>

/** 获取群荣誉信息。 */
export const OneBotGetGroupHonorInfoParamsSchema = z.object({
  group_id: OneBotIdSchema,
  type: z.enum(["talkative", "performer", "legend", "strong_newbie", "emotion", "all"])
})
export type OneBotGetGroupHonorInfoParams = z.infer<typeof OneBotGetGroupHonorInfoParamsSchema>

/** 获取 Cookies。 */
export const OneBotGetCookiesParamsSchema = z.object({ domain: z.string().optional() })
export type OneBotGetCookiesParams = z.infer<typeof OneBotGetCookiesParamsSchema>

/** 获取 QQ 相关接口凭证。 */
export const OneBotGetCredentialsParamsSchema = z.object({ domain: z.string().optional() })
export type OneBotGetCredentialsParams = z.infer<typeof OneBotGetCredentialsParamsSchema>

/** 获取语音。 */
export const OneBotGetRecordParamsSchema = z.object({
  file: z.string(),
  out_format: z.enum(["mp3", "amr", "wma", "m4a", "spx", "ogg", "wav", "flac"])
})
export type OneBotGetRecordParams = z.infer<typeof OneBotGetRecordParamsSchema>

/** 获取图片。 */
export const OneBotGetImageParamsSchema = z.object({ file: z.string() })
export type OneBotGetImageParams = z.infer<typeof OneBotGetImageParamsSchema>

/** 重启 OneBot 实现。 */
export const OneBotSetRestartParamsSchema = z.object({ delay: z.number().int().optional() })
export type OneBotSetRestartParams = z.infer<typeof OneBotSetRestartParamsSchema>

/** 对事件执行快速操作。 */
export const OneBotHandleQuickOperationParamsSchema = z.object({
  context: z.record(z.string(), z.unknown()),
  operation: OneBotQuickOperationSchema
})
export type OneBotHandleQuickOperationParams = z.infer<typeof OneBotHandleQuickOperationParamsSchema>

/** 消息 ID。 */
export const OneBotMessageIdResponseSchema = z.object({ message_id: OneBotIdSchema })
export type OneBotMessageIdResponse = z.infer<typeof OneBotMessageIdResponseSchema>

/** 获取消息。 */
export const OneBotGetMsgResponseSchema = z.object({
  time: z.number().int(),
  message_type: z.enum(["private", "group"]),
  message_id: OneBotIdSchema,
  real_id: OneBotIdSchema,
  sender: OneBotGroupSenderSchema,
  message: OneBotMessageSchema
})
export type OneBotGetMsgResponse = z.infer<typeof OneBotGetMsgResponseSchema>

/** 获取合并转发消息。 */
export const OneBotGetForwardMsgResponseSchema = z.object({ message: z.array(OneBotNodeSegmentSchema) })
export type OneBotGetForwardMsgResponse = z.infer<typeof OneBotGetForwardMsgResponseSchema>

/** 获取登录号信息。 */
export const OneBotLoginInfoResponseSchema = z.object({
  user_id: OneBotIdSchema,
  nickname: z.string()
})
export type OneBotLoginInfoResponse = z.infer<typeof OneBotLoginInfoResponseSchema>

/** 获取陌生人信息。 */
export const OneBotStrangerInfoResponseSchema = z.object({
  user_id: OneBotIdSchema,
  nickname: z.string(),
  sex: OneBotSexSchema,
  age: z.number().int()
})
export type OneBotStrangerInfoResponse = z.infer<typeof OneBotStrangerInfoResponseSchema>

/** 好友信息。 */
export const OneBotFriendInfoSchema = z.object({
  user_id: OneBotIdSchema,
  nickname: z.string(),
  remark: z.string()
})
export type OneBotFriendInfo = z.infer<typeof OneBotFriendInfoSchema>

/** 获取好友列表。 */
export const OneBotFriendListResponseSchema = z.array(OneBotFriendInfoSchema)
export type OneBotFriendListResponse = z.infer<typeof OneBotFriendListResponseSchema>

/** 群信息。 */
export const OneBotGroupInfoSchema = z.object({
  group_id: OneBotIdSchema,
  group_name: z.string(),
  member_count: z.number().int(),
  max_member_count: z.number().int()
})
export type OneBotGroupInfo = z.infer<typeof OneBotGroupInfoSchema>

/** 获取群列表。 */
export const OneBotGroupListResponseSchema = z.array(OneBotGroupInfoSchema)
export type OneBotGroupListResponse = z.infer<typeof OneBotGroupListResponseSchema>

/** 群成员信息。 */
export const OneBotGroupMemberInfoSchema = z.object({
  group_id: OneBotIdSchema,
  user_id: OneBotIdSchema,
  nickname: z.string(),
  card: z.string(),
  sex: OneBotSexSchema,
  age: z.number().int(),
  // 获取列表时，某些字段可能无法获得，例如 area、title 等。
  area: z.string().optional(),
  join_time: z.number().int(),
  last_sent_time: z.number().int(),
  level: z.string(),
  role: z.enum(["owner", "admin", "member"]),
  unfriendly: z.boolean().optional(),
  title: z.string().optional(),
  title_expire_time: z.number().int().optional(),
  card_changeable: z.boolean().optional()
})
export type OneBotGroupMemberInfo = z.infer<typeof OneBotGroupMemberInfoSchema>

/** 获取群成员列表。 */
export const OneBotGroupMemberListResponseSchema = z.array(OneBotGroupMemberInfoSchema)
export type OneBotGroupMemberListResponse = z.infer<typeof OneBotGroupMemberListResponseSchema>

/** 当前龙王。 */
export const OneBotCurrentTalkativeSchema = z.object({
  user_id: OneBotIdSchema,
  nickname: z.string(),
  avatar: z.string(),
  day_count: z.number().int()
})
export type OneBotCurrentTalkative = z.infer<typeof OneBotCurrentTalkativeSchema>

/** 群荣誉成员。 */
export const OneBotHonorMemberSchema = z.object({
  user_id: OneBotIdSchema,
  nickname: z.string(),
  avatar: z.string(),
  description: z.string()
})
export type OneBotHonorMember = z.infer<typeof OneBotHonorMemberSchema>

/** 获取群荣誉信息。 */
export const OneBotGroupHonorInfoResponseSchema = z.object({
  group_id: OneBotIdSchema,
  current_talkative: OneBotCurrentTalkativeSchema.optional(),
  talkative_list: z.array(OneBotHonorMemberSchema).optional(),
  performer_list: z.array(OneBotHonorMemberSchema).optional(),
  legend_list: z.array(OneBotHonorMemberSchema).optional(),
  strong_newbie_list: z.array(OneBotHonorMemberSchema).optional(),
  emotion_list: z.array(OneBotHonorMemberSchema).optional()
})
export type OneBotGroupHonorInfoResponse = z.infer<typeof OneBotGroupHonorInfoResponseSchema>

/** 获取 Cookies。 */
export const OneBotCookiesResponseSchema = z.object({ cookies: z.string() })
export type OneBotCookiesResponse = z.infer<typeof OneBotCookiesResponseSchema>

/** 获取 CSRF Token。 */
export const OneBotCsrfTokenResponseSchema = z.object({ token: z.number().int() })
export type OneBotCsrfTokenResponse = z.infer<typeof OneBotCsrfTokenResponseSchema>

/** 获取 QQ 相关接口凭证。 */
export const OneBotCredentialsResponseSchema = z.object({
  cookies: z.string(),
  csrf_token: z.number().int()
})
export type OneBotCredentialsResponse = z.infer<typeof OneBotCredentialsResponseSchema>

/** 获取语音。 */
export const OneBotRecordResponseSchema = z.object({ file: z.string() })
export type OneBotRecordResponse = z.infer<typeof OneBotRecordResponseSchema>

/** 获取图片。 */
export const OneBotImageResponseSchema = z.object({ file: z.string() })
export type OneBotImageResponse = z.infer<typeof OneBotImageResponseSchema>

/** 检查是否可以发送图片或语音。 */
export const OneBotCanSendResponseSchema = z.object({ yes: z.boolean() })
export type OneBotCanSendResponse = z.infer<typeof OneBotCanSendResponseSchema>

/** 获取版本信息。 */
export const OneBotVersionInfoResponseSchema = z.looseObject({
  app_name: z.string(),
  app_version: z.string(),
  protocol_version: z.string()
})
export type OneBotVersionInfoResponse = z.infer<typeof OneBotVersionInfoResponseSchema>

const OneBotEmptyParamsSchema = z.object({}).default({})

/**
 * 所有 API 都可以通过给 action 附加后缀 `_async` 来进行异步调用，
 * 或附加 `_rate_limited` 来进行限速调用。
 */
export const OneBotActionSuffixSchema = z.enum(["", "_async", "_rate_limited"])
export type OneBotActionSuffix = z.infer<typeof OneBotActionSuffixSchema>

export const OneBotActionSchema = z.discriminatedUnion("action", [
  // 发送私聊消息。
  z.object({ action: z.literal("send_private_msg"), params: OneBotSendPrivateMsgParamsSchema }),
  // 发送群消息。
  z.object({ action: z.literal("send_group_msg"), params: OneBotSendGroupMsgParamsSchema }),
  // 发送消息。
  z.object({ action: z.literal("send_msg"), params: OneBotSendMsgParamsSchema }),
  // 撤回消息。
  z.object({ action: z.literal("delete_msg"), params: OneBotDeleteMsgParamsSchema }),
  // 获取消息。
  z.object({ action: z.literal("get_msg"), params: OneBotGetMsgParamsSchema }),
  // 获取合并转发消息。
  z.object({ action: z.literal("get_forward_msg"), params: OneBotGetForwardMsgParamsSchema }),
  // 发送好友赞。
  z.object({ action: z.literal("send_like"), params: OneBotSendLikeParamsSchema }),
  // 群组踢人。
  z.object({ action: z.literal("set_group_kick"), params: OneBotSetGroupKickParamsSchema }),
  // 群组单人禁言。
  z.object({ action: z.literal("set_group_ban"), params: OneBotSetGroupBanParamsSchema }),
  // 群组匿名用户禁言。
  z.object({ action: z.literal("set_group_anonymous_ban"), params: OneBotSetGroupAnonymousBanParamsSchema }),
  // 群组全员禁言。
  z.object({ action: z.literal("set_group_whole_ban"), params: OneBotSetGroupWholeBanParamsSchema }),
  // 群组设置管理员。
  z.object({ action: z.literal("set_group_admin"), params: OneBotSetGroupAdminParamsSchema }),
  // 群组匿名。
  z.object({ action: z.literal("set_group_anonymous"), params: OneBotSetGroupAnonymousParamsSchema }),
  // 设置群名片（群备注）。
  z.object({ action: z.literal("set_group_card"), params: OneBotSetGroupCardParamsSchema }),
  // 设置群名。
  z.object({ action: z.literal("set_group_name"), params: OneBotSetGroupNameParamsSchema }),
  // 退出群组。
  z.object({ action: z.literal("set_group_leave"), params: OneBotSetGroupLeaveParamsSchema }),
  // 设置群组专属头衔。
  z.object({ action: z.literal("set_group_special_title"), params: OneBotSetGroupSpecialTitleParamsSchema }),
  // 处理加好友请求。
  z.object({ action: z.literal("set_friend_add_request"), params: OneBotSetFriendAddRequestParamsSchema }),
  // 处理加群请求／邀请。
  z.object({ action: z.literal("set_group_add_request"), params: OneBotSetGroupAddRequestParamsSchema }),
  // 获取登录号信息。
  z.object({ action: z.literal("get_login_info"), params: OneBotEmptyParamsSchema }),
  // 获取陌生人信息。
  z.object({ action: z.literal("get_stranger_info"), params: OneBotGetStrangerInfoParamsSchema }),
  // 获取好友列表。
  z.object({ action: z.literal("get_friend_list"), params: OneBotEmptyParamsSchema }),
  // 获取群信息。
  z.object({ action: z.literal("get_group_info"), params: OneBotGetGroupInfoParamsSchema }),
  // 获取群列表。
  z.object({ action: z.literal("get_group_list"), params: OneBotEmptyParamsSchema }),
  // 获取群成员信息。
  z.object({ action: z.literal("get_group_member_info"), params: OneBotGetGroupMemberInfoParamsSchema }),
  // 获取群成员列表。
  z.object({ action: z.literal("get_group_member_list"), params: OneBotGetGroupMemberListParamsSchema }),
  // 获取群荣誉信息。
  z.object({ action: z.literal("get_group_honor_info"), params: OneBotGetGroupHonorInfoParamsSchema }),
  // 获取 Cookies。
  z.object({ action: z.literal("get_cookies"), params: OneBotGetCookiesParamsSchema }),
  // 获取 CSRF Token。
  z.object({ action: z.literal("get_csrf_token"), params: OneBotEmptyParamsSchema }),
  // 获取 QQ 相关接口凭证。
  z.object({ action: z.literal("get_credentials"), params: OneBotGetCredentialsParamsSchema }),
  // 获取语音。
  z.object({ action: z.literal("get_record"), params: OneBotGetRecordParamsSchema }),
  // 获取图片。
  z.object({ action: z.literal("get_image"), params: OneBotGetImageParamsSchema }),
  // 检查是否可以发送图片。
  z.object({ action: z.literal("can_send_image"), params: OneBotEmptyParamsSchema }),
  // 检查是否可以发送语音。
  z.object({ action: z.literal("can_send_record"), params: OneBotEmptyParamsSchema }),
  // 获取运行状态。
  z.object({ action: z.literal("get_status"), params: OneBotEmptyParamsSchema }),
  // 获取版本信息。
  z.object({ action: z.literal("get_version_info"), params: OneBotEmptyParamsSchema }),
  // 重启 OneBot 实现。
  z.object({ action: z.literal("set_restart"), params: OneBotSetRestartParamsSchema }),
  // 清理缓存。
  z.object({ action: z.literal("clean_cache"), params: OneBotEmptyParamsSchema }),
  // 对事件执行快速操作。
  z.object({ action: z.literal(".handle_quick_operation"), params: OneBotHandleQuickOperationParamsSchema })
])
export type OneBotAction = z.infer<typeof OneBotActionSchema>
export type OneBotActionName = OneBotAction["action"]

export const OneBotStatusResponseSchema = OneBotStatusSchema
export type OneBotStatusResponse = z.infer<typeof OneBotStatusResponseSchema>
