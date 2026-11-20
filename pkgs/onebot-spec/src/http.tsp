import "@typespec/http";

using TypeSpec.Http;

namespace OneBot;

/** HTTP API 通用错误响应。 */
alias HttpErrors = UnauthorizedResponse | ForbiddenResponse | NotFoundResponse;

/** HTTP POST API 错误响应。 */
alias HttpPostErrors = HttpErrors | UnsupportedMediaTypeResponse | BadRequestResponse;

/**
 * OneBot HTTP API 的显式动作路由。
 *
 * 每个标准动作都有独立的 `/:action` 路径，便于生成类型安全的 SDK。
 * 标准之外的动作仍可通过 `/{action}` 通用路由调用。
 */
@tag("API")
interface HttpActions {
  /** 发送私聊消息。 */
  @route("/send_private_msg")
  @post
  sendPrivateMsg(@body params: SendPrivateMsgParams): ApiResponse<MessageIdResponse> | HttpPostErrors;

  /** 发送群消息。 */
  @route("/send_group_msg")
  @post
  sendGroupMsg(@body params: SendGroupMsgParams): ApiResponse<MessageIdResponse> | HttpPostErrors;

  /** 发送消息。 */
  @route("/send_msg")
  @post
  sendMsg(@body params: SendMsgParams): ApiResponse<MessageIdResponse> | HttpPostErrors;

  /** 撤回消息。 */
  @route("/delete_msg")
  @post
  deleteMsg(@body params: DeleteMsgParams): ApiResponse<null> | HttpPostErrors;

  /** 获取消息。 */
  @route("/get_msg")
  @post
  getMsg(@body params: GetMsgParams): ApiResponse<GetMsgResponse> | HttpPostErrors;

  /** 获取合并转发消息。 */
  @route("/get_forward_msg")
  @post
  getForwardMsg(@body params: GetForwardMsgParams): ApiResponse<GetForwardMsgResponse> | HttpPostErrors;

  /** 发送好友赞。 */
  @route("/send_like")
  @post
  sendLike(@body params: SendLikeParams): ApiResponse<null> | HttpPostErrors;

  /** 群组踢人。 */
  @route("/set_group_kick")
  @post
  setGroupKick(@body params: SetGroupKickParams): ApiResponse<null> | HttpPostErrors;

  /** 群组单人禁言。 */
  @route("/set_group_ban")
  @post
  setGroupBan(@body params: SetGroupBanParams): ApiResponse<null> | HttpPostErrors;

  /** 群组匿名用户禁言。 */
  @route("/set_group_anonymous_ban")
  @post
  setGroupAnonymousBan(@body params: SetGroupAnonymousBanParams): ApiResponse<null> | HttpPostErrors;

  /** 群组全员禁言。 */
  @route("/set_group_whole_ban")
  @post
  setGroupWholeBan(@body params: SetGroupWholeBanParams): ApiResponse<null> | HttpPostErrors;

  /** 群组设置管理员。 */
  @route("/set_group_admin")
  @post
  setGroupAdmin(@body params: SetGroupAdminParams): ApiResponse<null> | HttpPostErrors;

  /** 群组匿名。 */
  @route("/set_group_anonymous")
  @post
  setGroupAnonymous(@body params: SetGroupAnonymousParams): ApiResponse<null> | HttpPostErrors;

  /** 设置群名片（群备注）。 */
  @route("/set_group_card")
  @post
  setGroupCard(@body params: SetGroupCardParams): ApiResponse<null> | HttpPostErrors;

  /** 设置群名。 */
  @route("/set_group_name")
  @post
  setGroupName(@body params: SetGroupNameParams): ApiResponse<null> | HttpPostErrors;

  /** 退出群组。 */
  @route("/set_group_leave")
  @post
  setGroupLeave(@body params: SetGroupLeaveParams): ApiResponse<null> | HttpPostErrors;

  /** 设置群组专属头衔。 */
  @route("/set_group_special_title")
  @post
  setGroupSpecialTitle(@body params: SetGroupSpecialTitleParams): ApiResponse<null> | HttpPostErrors;

  /** 处理加好友请求。 */
  @route("/set_friend_add_request")
  @post
  setFriendAddRequest(@body params: SetFriendAddRequestParams): ApiResponse<null> | HttpPostErrors;

  /** 处理加群请求／邀请。 */
  @route("/set_group_add_request")
  @post
  setGroupAddRequest(@body params: SetGroupAddRequestParams): ApiResponse<null> | HttpPostErrors;

  /** 获取登录号信息。 */
  @route("/get_login_info")
  @post
  getLoginInfo(): ApiResponse<LoginInfoResponse> | HttpPostErrors;

  /** 获取陌生人信息。 */
  @route("/get_stranger_info")
  @post
  getStrangerInfo(@body params: GetStrangerInfoParams): ApiResponse<StrangerInfoResponse> | HttpPostErrors;

  /** 获取好友列表。 */
  @route("/get_friend_list")
  @post
  getFriendList(): ApiResponse<FriendListResponse> | HttpPostErrors;

  /** 获取群信息。 */
  @route("/get_group_info")
  @post
  getGroupInfo(@body params: GetGroupInfoParams): ApiResponse<GroupInfo> | HttpPostErrors;

  /** 获取群列表。 */
  @route("/get_group_list")
  @post
  getGroupList(): ApiResponse<GroupListResponse> | HttpPostErrors;

  /** 获取群成员信息。 */
  @route("/get_group_member_info")
  @post
  getGroupMemberInfo(@body params: GetGroupMemberInfoParams): ApiResponse<GroupMemberInfo> | HttpPostErrors;

  /** 获取群成员列表。 */
  @route("/get_group_member_list")
  @post
  getGroupMemberList(@body params: GetGroupMemberListParams): ApiResponse<GroupMemberListResponse> | HttpPostErrors;

  /** 获取群荣誉信息。 */
  @route("/get_group_honor_info")
  @post
  getGroupHonorInfo(@body params: GetGroupHonorInfoParams): ApiResponse<GroupHonorInfoResponse> | HttpPostErrors;

  /** 获取 Cookies。 */
  @route("/get_cookies")
  @post
  getCookies(@body params?: GetCookiesParams): ApiResponse<CookiesResponse> | HttpPostErrors;

  /** 获取 CSRF Token。 */
  @route("/get_csrf_token")
  @post
  getCsrfToken(): ApiResponse<CsrfTokenResponse> | HttpPostErrors;

  /** 获取 QQ 相关接口凭证。 */
  @route("/get_credentials")
  @post
  getCredentials(@body params?: GetCredentialsParams): ApiResponse<CredentialsResponse> | HttpPostErrors;

  /** 获取语音。 */
  @route("/get_record")
  @post
  getRecord(@body params: GetRecordParams): ApiResponse<RecordResponse> | HttpPostErrors;

  /** 获取图片。 */
  @route("/get_image")
  @post
  getImage(@body params: GetImageParams): ApiResponse<ImageResponse> | HttpPostErrors;

  /** 检查是否可以发送图片。 */
  @route("/can_send_image")
  @post
  canSendImage(): ApiResponse<CanSendResponse> | HttpPostErrors;

  /** 检查是否可以发送语音。 */
  @route("/can_send_record")
  @post
  canSendRecord(): ApiResponse<CanSendResponse> | HttpPostErrors;

  /** 获取运行状态。 */
  @route("/get_status")
  @post
  getStatus(): ApiResponse<Status> | HttpPostErrors;

  /** 获取版本信息。 */
  @route("/get_version_info")
  @post
  getVersionInfo(): ApiResponse<VersionInfoResponse> | HttpPostErrors;

  /** 重启 OneBot 实现。 */
  @route("/set_restart")
  @post
  setRestart(@body params?: SetRestartParams): ApiResponse<null> | HttpPostErrors;

  /** 清理缓存。 */
  @route("/clean_cache")
  @post
  cleanCache(): ApiResponse<null> | HttpPostErrors;

  /** 对事件执行快速操作。 */
  @route("/.handle_quick_operation")
  @post
  handleQuickOperation(@body params: HandleQuickOperationParams): ApiResponse<null> | HttpPostErrors;
}
