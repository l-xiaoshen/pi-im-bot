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

export const OneBotSendPrivateMsgParamsSchema = z.object({
  user_id: OneBotIdSchema,
  message: OneBotMessageInputSchema,
  auto_escape: z.boolean().optional()
})
export type OneBotSendPrivateMsgParams = z.infer<typeof OneBotSendPrivateMsgParamsSchema>

export const OneBotSendGroupMsgParamsSchema = z.object({
  group_id: OneBotIdSchema,
  message: OneBotMessageInputSchema,
  auto_escape: z.boolean().optional()
})
export type OneBotSendGroupMsgParams = z.infer<typeof OneBotSendGroupMsgParamsSchema>

export const OneBotSendMsgParamsSchema = z.object({
  message_type: z.enum(["private", "group"]).optional(),
  user_id: OneBotIdSchema.optional(),
  group_id: OneBotIdSchema.optional(),
  message: OneBotMessageInputSchema,
  auto_escape: z.boolean().optional()
})
export type OneBotSendMsgParams = z.infer<typeof OneBotSendMsgParamsSchema>

export const OneBotDeleteMsgParamsSchema = z.object({ message_id: OneBotIdSchema })
export type OneBotDeleteMsgParams = z.infer<typeof OneBotDeleteMsgParamsSchema>

export const OneBotGetMsgParamsSchema = z.object({ message_id: OneBotIdSchema })
export type OneBotGetMsgParams = z.infer<typeof OneBotGetMsgParamsSchema>

export const OneBotGetForwardMsgParamsSchema = z.object({ id: z.string() })
export type OneBotGetForwardMsgParams = z.infer<typeof OneBotGetForwardMsgParamsSchema>

export const OneBotSendLikeParamsSchema = z.object({
  user_id: OneBotIdSchema,
  times: z.number().int().optional()
})
export type OneBotSendLikeParams = z.infer<typeof OneBotSendLikeParamsSchema>

export const OneBotSetGroupKickParamsSchema = z.object({
  group_id: OneBotIdSchema,
  user_id: OneBotIdSchema,
  reject_add_request: z.boolean().optional()
})
export type OneBotSetGroupKickParams = z.infer<typeof OneBotSetGroupKickParamsSchema>

export const OneBotSetGroupBanParamsSchema = z.object({
  group_id: OneBotIdSchema,
  user_id: OneBotIdSchema,
  duration: z.number().int().optional()
})
export type OneBotSetGroupBanParams = z.infer<typeof OneBotSetGroupBanParamsSchema>

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

export const OneBotSetGroupWholeBanParamsSchema = z.object({
  group_id: OneBotIdSchema,
  enable: z.boolean().optional()
})
export type OneBotSetGroupWholeBanParams = z.infer<typeof OneBotSetGroupWholeBanParamsSchema>

export const OneBotSetGroupAdminParamsSchema = z.object({
  group_id: OneBotIdSchema,
  user_id: OneBotIdSchema,
  enable: z.boolean().optional()
})
export type OneBotSetGroupAdminParams = z.infer<typeof OneBotSetGroupAdminParamsSchema>

export const OneBotSetGroupAnonymousParamsSchema = z.object({
  group_id: OneBotIdSchema,
  enable: z.boolean().optional()
})
export type OneBotSetGroupAnonymousParams = z.infer<typeof OneBotSetGroupAnonymousParamsSchema>

export const OneBotSetGroupCardParamsSchema = z.object({
  group_id: OneBotIdSchema,
  user_id: OneBotIdSchema,
  card: z.string().optional()
})
export type OneBotSetGroupCardParams = z.infer<typeof OneBotSetGroupCardParamsSchema>

export const OneBotSetGroupNameParamsSchema = z.object({
  group_id: OneBotIdSchema,
  group_name: z.string()
})
export type OneBotSetGroupNameParams = z.infer<typeof OneBotSetGroupNameParamsSchema>

export const OneBotSetGroupLeaveParamsSchema = z.object({
  group_id: OneBotIdSchema,
  is_dismiss: z.boolean().optional()
})
export type OneBotSetGroupLeaveParams = z.infer<typeof OneBotSetGroupLeaveParamsSchema>

export const OneBotSetGroupSpecialTitleParamsSchema = z.object({
  group_id: OneBotIdSchema,
  user_id: OneBotIdSchema,
  special_title: z.string().optional(),
  duration: z.number().int().optional()
})
export type OneBotSetGroupSpecialTitleParams = z.infer<typeof OneBotSetGroupSpecialTitleParamsSchema>

export const OneBotSetFriendAddRequestParamsSchema = z.object({
  flag: z.string(),
  approve: z.boolean().optional(),
  remark: z.string().optional()
})
export type OneBotSetFriendAddRequestParams = z.infer<typeof OneBotSetFriendAddRequestParamsSchema>

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

export const OneBotGetStrangerInfoParamsSchema = z.object({
  user_id: OneBotIdSchema,
  no_cache: z.boolean().optional()
})
export type OneBotGetStrangerInfoParams = z.infer<typeof OneBotGetStrangerInfoParamsSchema>

export const OneBotGetGroupInfoParamsSchema = z.object({
  group_id: OneBotIdSchema,
  no_cache: z.boolean().optional()
})
export type OneBotGetGroupInfoParams = z.infer<typeof OneBotGetGroupInfoParamsSchema>

export const OneBotGetGroupMemberInfoParamsSchema = z.object({
  group_id: OneBotIdSchema,
  user_id: OneBotIdSchema,
  no_cache: z.boolean().optional()
})
export type OneBotGetGroupMemberInfoParams = z.infer<typeof OneBotGetGroupMemberInfoParamsSchema>

export const OneBotGetGroupMemberListParamsSchema = z.object({ group_id: OneBotIdSchema })
export type OneBotGetGroupMemberListParams = z.infer<typeof OneBotGetGroupMemberListParamsSchema>

export const OneBotGetGroupHonorInfoParamsSchema = z.object({
  group_id: OneBotIdSchema,
  type: z.enum(["talkative", "performer", "legend", "strong_newbie", "emotion", "all"])
})
export type OneBotGetGroupHonorInfoParams = z.infer<typeof OneBotGetGroupHonorInfoParamsSchema>

export const OneBotGetCookiesParamsSchema = z.object({ domain: z.string().optional() })
export type OneBotGetCookiesParams = z.infer<typeof OneBotGetCookiesParamsSchema>

export const OneBotGetCredentialsParamsSchema = z.object({ domain: z.string().optional() })
export type OneBotGetCredentialsParams = z.infer<typeof OneBotGetCredentialsParamsSchema>

export const OneBotGetRecordParamsSchema = z.object({
  file: z.string(),
  out_format: z.enum(["mp3", "amr", "wma", "m4a", "spx", "ogg", "wav", "flac"])
})
export type OneBotGetRecordParams = z.infer<typeof OneBotGetRecordParamsSchema>

export const OneBotGetImageParamsSchema = z.object({ file: z.string() })
export type OneBotGetImageParams = z.infer<typeof OneBotGetImageParamsSchema>

export const OneBotSetRestartParamsSchema = z.object({ delay: z.number().int().optional() })
export type OneBotSetRestartParams = z.infer<typeof OneBotSetRestartParamsSchema>

export const OneBotHandleQuickOperationParamsSchema = z.object({
  context: z.record(z.string(), z.unknown()),
  operation: OneBotQuickOperationSchema
})
export type OneBotHandleQuickOperationParams = z.infer<typeof OneBotHandleQuickOperationParamsSchema>

export const OneBotMessageIdResponseSchema = z.object({ message_id: OneBotIdSchema })
export type OneBotMessageIdResponse = z.infer<typeof OneBotMessageIdResponseSchema>

export const OneBotGetMsgResponseSchema = z.object({
  time: z.number().int(),
  message_type: z.enum(["private", "group"]),
  message_id: OneBotIdSchema,
  real_id: OneBotIdSchema,
  sender: OneBotGroupSenderSchema,
  message: OneBotMessageSchema
})
export type OneBotGetMsgResponse = z.infer<typeof OneBotGetMsgResponseSchema>

export const OneBotGetForwardMsgResponseSchema = z.object({ message: z.array(OneBotNodeSegmentSchema) })
export type OneBotGetForwardMsgResponse = z.infer<typeof OneBotGetForwardMsgResponseSchema>

export const OneBotLoginInfoResponseSchema = z.object({
  user_id: OneBotIdSchema,
  nickname: z.string()
})
export type OneBotLoginInfoResponse = z.infer<typeof OneBotLoginInfoResponseSchema>

export const OneBotStrangerInfoResponseSchema = z.object({
  user_id: OneBotIdSchema,
  nickname: z.string(),
  sex: OneBotSexSchema,
  age: z.number().int()
})
export type OneBotStrangerInfoResponse = z.infer<typeof OneBotStrangerInfoResponseSchema>

export const OneBotFriendInfoSchema = z.object({
  user_id: OneBotIdSchema,
  nickname: z.string(),
  remark: z.string()
})
export type OneBotFriendInfo = z.infer<typeof OneBotFriendInfoSchema>

export const OneBotFriendListResponseSchema = z.array(OneBotFriendInfoSchema)
export type OneBotFriendListResponse = z.infer<typeof OneBotFriendListResponseSchema>

export const OneBotGroupInfoSchema = z.object({
  group_id: OneBotIdSchema,
  group_name: z.string(),
  member_count: z.number().int(),
  max_member_count: z.number().int()
})
export type OneBotGroupInfo = z.infer<typeof OneBotGroupInfoSchema>

export const OneBotGroupListResponseSchema = z.array(OneBotGroupInfoSchema)
export type OneBotGroupListResponse = z.infer<typeof OneBotGroupListResponseSchema>

export const OneBotGroupMemberInfoSchema = z.object({
  group_id: OneBotIdSchema,
  user_id: OneBotIdSchema,
  nickname: z.string(),
  card: z.string(),
  sex: OneBotSexSchema,
  age: z.number().int(),
  // The spec notes that some of these fields may be unavailable when the
  // member is obtained from the list API rather than the single-member API.
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

export const OneBotGroupMemberListResponseSchema = z.array(OneBotGroupMemberInfoSchema)
export type OneBotGroupMemberListResponse = z.infer<typeof OneBotGroupMemberListResponseSchema>

export const OneBotCurrentTalkativeSchema = z.object({
  user_id: OneBotIdSchema,
  nickname: z.string(),
  avatar: z.string(),
  day_count: z.number().int()
})
export type OneBotCurrentTalkative = z.infer<typeof OneBotCurrentTalkativeSchema>

export const OneBotHonorMemberSchema = z.object({
  user_id: OneBotIdSchema,
  nickname: z.string(),
  avatar: z.string(),
  description: z.string()
})
export type OneBotHonorMember = z.infer<typeof OneBotHonorMemberSchema>

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

export const OneBotCookiesResponseSchema = z.object({ cookies: z.string() })
export type OneBotCookiesResponse = z.infer<typeof OneBotCookiesResponseSchema>

export const OneBotCsrfTokenResponseSchema = z.object({ token: z.number().int() })
export type OneBotCsrfTokenResponse = z.infer<typeof OneBotCsrfTokenResponseSchema>

export const OneBotCredentialsResponseSchema = z.object({
  cookies: z.string(),
  csrf_token: z.number().int()
})
export type OneBotCredentialsResponse = z.infer<typeof OneBotCredentialsResponseSchema>

export const OneBotRecordResponseSchema = z.object({ file: z.string() })
export type OneBotRecordResponse = z.infer<typeof OneBotRecordResponseSchema>

export const OneBotImageResponseSchema = z.object({ file: z.string() })
export type OneBotImageResponse = z.infer<typeof OneBotImageResponseSchema>

export const OneBotCanSendResponseSchema = z.object({ yes: z.boolean() })
export type OneBotCanSendResponse = z.infer<typeof OneBotCanSendResponseSchema>

export const OneBotVersionInfoResponseSchema = z.looseObject({
  app_name: z.string(),
  app_version: z.string(),
  protocol_version: z.string()
})
export type OneBotVersionInfoResponse = z.infer<typeof OneBotVersionInfoResponseSchema>

const OneBotEmptyParamsSchema = z.object({}).default({})

/**
 * Every action can be called asynchronously or rate-limited by appending one
 * of these suffixes to its name.
 */
export const OneBotActionSuffixSchema = z.enum(["", "_async", "_rate_limited"])
export type OneBotActionSuffix = z.infer<typeof OneBotActionSuffixSchema>

export const OneBotActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("send_private_msg"), params: OneBotSendPrivateMsgParamsSchema }),
  z.object({ action: z.literal("send_group_msg"), params: OneBotSendGroupMsgParamsSchema }),
  z.object({ action: z.literal("send_msg"), params: OneBotSendMsgParamsSchema }),
  z.object({ action: z.literal("delete_msg"), params: OneBotDeleteMsgParamsSchema }),
  z.object({ action: z.literal("get_msg"), params: OneBotGetMsgParamsSchema }),
  z.object({ action: z.literal("get_forward_msg"), params: OneBotGetForwardMsgParamsSchema }),
  z.object({ action: z.literal("send_like"), params: OneBotSendLikeParamsSchema }),
  z.object({ action: z.literal("set_group_kick"), params: OneBotSetGroupKickParamsSchema }),
  z.object({ action: z.literal("set_group_ban"), params: OneBotSetGroupBanParamsSchema }),
  z.object({ action: z.literal("set_group_anonymous_ban"), params: OneBotSetGroupAnonymousBanParamsSchema }),
  z.object({ action: z.literal("set_group_whole_ban"), params: OneBotSetGroupWholeBanParamsSchema }),
  z.object({ action: z.literal("set_group_admin"), params: OneBotSetGroupAdminParamsSchema }),
  z.object({ action: z.literal("set_group_anonymous"), params: OneBotSetGroupAnonymousParamsSchema }),
  z.object({ action: z.literal("set_group_card"), params: OneBotSetGroupCardParamsSchema }),
  z.object({ action: z.literal("set_group_name"), params: OneBotSetGroupNameParamsSchema }),
  z.object({ action: z.literal("set_group_leave"), params: OneBotSetGroupLeaveParamsSchema }),
  z.object({ action: z.literal("set_group_special_title"), params: OneBotSetGroupSpecialTitleParamsSchema }),
  z.object({ action: z.literal("set_friend_add_request"), params: OneBotSetFriendAddRequestParamsSchema }),
  z.object({ action: z.literal("set_group_add_request"), params: OneBotSetGroupAddRequestParamsSchema }),
  z.object({ action: z.literal("get_login_info"), params: OneBotEmptyParamsSchema }),
  z.object({ action: z.literal("get_stranger_info"), params: OneBotGetStrangerInfoParamsSchema }),
  z.object({ action: z.literal("get_friend_list"), params: OneBotEmptyParamsSchema }),
  z.object({ action: z.literal("get_group_info"), params: OneBotGetGroupInfoParamsSchema }),
  z.object({ action: z.literal("get_group_list"), params: OneBotEmptyParamsSchema }),
  z.object({ action: z.literal("get_group_member_info"), params: OneBotGetGroupMemberInfoParamsSchema }),
  z.object({ action: z.literal("get_group_member_list"), params: OneBotGetGroupMemberListParamsSchema }),
  z.object({ action: z.literal("get_group_honor_info"), params: OneBotGetGroupHonorInfoParamsSchema }),
  z.object({ action: z.literal("get_cookies"), params: OneBotGetCookiesParamsSchema }),
  z.object({ action: z.literal("get_csrf_token"), params: OneBotEmptyParamsSchema }),
  z.object({ action: z.literal("get_credentials"), params: OneBotGetCredentialsParamsSchema }),
  z.object({ action: z.literal("get_record"), params: OneBotGetRecordParamsSchema }),
  z.object({ action: z.literal("get_image"), params: OneBotGetImageParamsSchema }),
  z.object({ action: z.literal("can_send_image"), params: OneBotEmptyParamsSchema }),
  z.object({ action: z.literal("can_send_record"), params: OneBotEmptyParamsSchema }),
  z.object({ action: z.literal("get_status"), params: OneBotEmptyParamsSchema }),
  z.object({ action: z.literal("get_version_info"), params: OneBotEmptyParamsSchema }),
  z.object({ action: z.literal("set_restart"), params: OneBotSetRestartParamsSchema }),
  z.object({ action: z.literal("clean_cache"), params: OneBotEmptyParamsSchema }),
  z.object({ action: z.literal(".handle_quick_operation"), params: OneBotHandleQuickOperationParamsSchema })
])
export type OneBotAction = z.infer<typeof OneBotActionSchema>
export type OneBotActionName = OneBotAction["action"]

export const OneBotStatusResponseSchema = OneBotStatusSchema
export type OneBotStatusResponse = z.infer<typeof OneBotStatusResponseSchema>
