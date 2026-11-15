namespace OneBot;

// ---------------------------------------------------------------------------
// API 参数
// ---------------------------------------------------------------------------

model SendPrivateMsgParams {
  /** 对方 QQ 号。 */
  user_id: Id;
  /** 要发送的内容。 */
  message: MessageInput;
  /** 消息内容是否作为纯文本发送（即不解析 CQ 码），只在 `message` 字段是字符串时有效。 */
  auto_escape?: boolean;
}

model SendGroupMsgParams {
  /** 群号。 */
  group_id: Id;
  /** 要发送的内容。 */
  message: MessageInput;
  /** 消息内容是否作为纯文本发送（即不解析 CQ 码），只在 `message` 字段是字符串时有效。 */
  auto_escape?: boolean;
}

model SendMsgParams {
  /** 消息类型，支持 `private`、`group`，分别对应私聊、群组，如不传入，则根据传入的 `*_id` 参数判断。 */
  message_type?: "private" | "group";
  /** 对方 QQ 号（消息类型为 `private` 时需要）。 */
  user_id?: Id;
  /** 群号（消息类型为 `group` 时需要）。 */
  group_id?: Id;
  /** 要发送的内容。 */
  message: MessageInput;
  /** 消息内容是否作为纯文本发送（即不解析 CQ 码），只在 `message` 字段是字符串时有效。 */
  auto_escape?: boolean;
}

model DeleteMsgParams {
  /** 消息 ID。 */
  message_id: MessageId;
}

model GetMsgParams {
  /** 消息 ID。 */
  message_id: MessageId;
}

model GetForwardMsgParams {
  /** 合并转发 ID。 */
  id: string;
}

model SendLikeParams {
  /** 对方 QQ 号。 */
  user_id: Id;
  /** 赞的次数，每个好友每天最多 10 次。 */
  times?: int32;
}

model SetGroupKickParams {
  /** 群号。 */
  group_id: Id;
  /** 要踢的 QQ 号。 */
  user_id: Id;
  /** 拒绝此人的加群请求。 */
  reject_add_request?: boolean;
}

model SetGroupBanParams {
  /** 群号。 */
  group_id: Id;
  /** 要禁言的 QQ 号。 */
  user_id: Id;
  /** 禁言时长，单位秒，0 表示取消禁言。 */
  duration?: int64;
}

model SetGroupAnonymousBanParams {
  /** 群号。 */
  group_id: Id;
  /** 可选，要禁言的匿名用户对象（群消息上报的 `anonymous` 字段）。 */
  anonymous?: Anonymous;
  /** 可选，要禁言的匿名用户的 flag（需从群消息上报的数据中获得）。 */
  anonymous_flag?: string;
  /** `anonymous_flag` 的别名。 */
  flag?: string;
  /** 禁言时长，单位秒，无法取消匿名用户禁言。 */
  duration?: int64;
}

model SetGroupWholeBanParams {
  /** 群号。 */
  group_id: Id;
  /** 是否禁言。 */
  enable?: boolean;
}

model SetGroupAdminParams {
  /** 群号。 */
  group_id: Id;
  /** 要设置管理员的 QQ 号。 */
  user_id: Id;
  /** true 为设置，false 为取消。 */
  enable?: boolean;
}

model SetGroupAnonymousParams {
  /** 群号。 */
  group_id: Id;
  /** 是否允许匿名聊天。 */
  enable?: boolean;
}

model SetGroupCardParams {
  /** 群号。 */
  group_id: Id;
  /** 要设置的 QQ 号。 */
  user_id: Id;
  /** 群名片内容，不填或空字符串表示删除群名片。 */
  card?: string;
}

model SetGroupNameParams {
  /** 群号。 */
  group_id: Id;
  /** 新群名。 */
  group_name: string;
}

model SetGroupLeaveParams {
  /** 群号。 */
  group_id: Id;
  /** 是否解散，如果登录号是群主，则仅在此项为 true 时能够解散。 */
  is_dismiss?: boolean;
}

model SetGroupSpecialTitleParams {
  /** 群号。 */
  group_id: Id;
  /** 要设置的 QQ 号。 */
  user_id: Id;
  /** 专属头衔，不填或空字符串表示删除专属头衔。 */
  special_title?: string;
  /** 专属头衔有效期，单位秒，-1 表示永久。 */
  duration?: int64;
}

model SetFriendAddRequestParams {
  /** 加好友请求的 flag（需从上报的数据中获得）。 */
  flag: string;
  /** 是否同意请求。 */
  approve?: boolean;
  /** 添加后的好友备注（仅在同意时有效）。 */
  remark?: string;
}

model SetGroupAddRequestParams {
  /** 加群请求的 flag（需从上报的数据中获得）。 */
  flag: string;
  /** `add` 或 `invite`，请求类型（需要和上报消息中的 `sub_type` 字段相符）。 */
  sub_type?: "add" | "invite";
  /** `sub_type` 的别名。 */
  type?: "add" | "invite";
  /** 是否同意请求／邀请。 */
  approve?: boolean;
  /** 拒绝理由（仅在拒绝时有效）。 */
  reason?: string;
}

model GetStrangerInfoParams {
  /** QQ 号。 */
  user_id: Id;
  /** 是否不使用缓存（使用缓存可能更新不及时，但响应更快）。 */
  no_cache?: boolean;
}

model GetGroupInfoParams {
  /** 群号。 */
  group_id: Id;
  /** 是否不使用缓存（使用缓存可能更新不及时，但响应更快）。 */
  no_cache?: boolean;
}

model GetGroupMemberInfoParams {
  /** 群号。 */
  group_id: Id;
  /** QQ 号。 */
  user_id: Id;
  /** 是否不使用缓存（使用缓存可能更新不及时，但响应更快）。 */
  no_cache?: boolean;
}

model GetGroupMemberListParams {
  /** 群号。 */
  group_id: Id;
}

model GetGroupHonorInfoParams {
  /** 群号。 */
  group_id: Id;
  /** 要获取的群荣誉类型，可传入 `talkative`、`performer`、`legend`、`strong_newbie`、`emotion` 以分别获取单个类型的群荣誉数据，或传入 `all` 获取所有数据。 */
  type: "talkative" | "performer" | "legend" | "strong_newbie" | "emotion" | "all";
}

model GetCookiesParams {
  /** 需要获取 cookies 的域名。 */
  domain?: string;
}

model GetCredentialsParams {
  /** 需要获取 cookies 的域名。 */
  domain?: string;
}

model GetRecordParams {
  /** 收到的语音文件名（消息段的 `file` 参数），如 `0B38145AA44505000B38145AA4450500.silk`。 */
  file: string;
  /** 要转换到的格式，目前支持 `mp3`、`amr`、`wma`、`m4a`、`spx`、`ogg`、`wav`、`flac`。 */
  out_format: "mp3" | "amr" | "wma" | "m4a" | "spx" | "ogg" | "wav" | "flac";
}

model GetImageParams {
  /** 收到的图片文件名（消息段的 `file` 参数），如 `6B4DE3DFD1BD271E3297859D41C530F5.jpg`。 */
  file: string;
}

model SetRestartParams {
  /** 要延迟的毫秒数，如果默认情况下无法重启，可以尝试设置延迟为 2000 左右。 */
  delay?: int64;
}

model HandleQuickOperationParams {
  /** 事件数据对象，可做精简，如去掉 `message` 等无用字段。 */
  context: Record<unknown>;
  /** 快速操作对象，例如 `{"ban": true, "reply": "请不要说脏话"}`。 */
  operation: QuickOperation;
}

// ---------------------------------------------------------------------------
// API 响应数据
// ---------------------------------------------------------------------------

/** 消息 ID。 */
model MessageIdResponse {
  /** 消息 ID。 */
  message_id: MessageId;
}

/** 获取消息。 */
model GetMsgResponse {
  /** 发送时间。 */
  time: int32;
  /** 消息类型，同消息事件。 */
  message_type: "private" | "group";
  /** 消息 ID。 */
  message_id: MessageId;
  /** 消息真实 ID。 */
  real_id: MessageId;
  /** 发送人信息，同消息事件。 */
  sender: GroupSender;
  /** 消息内容。 */
  message: Message;
}

/** 获取合并转发消息。 */
model GetForwardMsgResponse {
  /** 消息内容，使用消息的数组格式表示，数组中的消息段全部为 `node` 消息段。 */
  message: NodeSegment[];
}

/** 获取登录号信息。 */
model LoginInfoResponse {
  /** QQ 号。 */
  user_id: Id;
  /** QQ 昵称。 */
  nickname: string;
}

/** 获取陌生人信息。 */
model StrangerInfoResponse {
  /** QQ 号。 */
  user_id: Id;
  /** 昵称。 */
  nickname: string;
  /** 性别，`male` 或 `female` 或 `unknown`。 */
  sex: Sex;
  /** 年龄。 */
  age: int32;
}

/** 好友信息。 */
model FriendInfo {
  /** QQ 号。 */
  user_id: Id;
  /** 昵称。 */
  nickname: string;
  /** 备注名。 */
  remark: string;
}

/** 好友列表。 */
model FriendListResponse is FriendInfo[];

/** 群信息。 */
model GroupInfo {
  /** 群号。 */
  group_id: Id;
  /** 群名称。 */
  group_name: string;
  /** 成员数。 */
  member_count: int32;
  /** 最大成员数（群容量）。 */
  max_member_count: int32;
}

/** 群列表。 */
model GroupListResponse is GroupInfo[];

/** 群成员信息。 */
model GroupMemberInfo {
  /** 群号。 */
  group_id: Id;
  /** QQ 号。 */
  user_id: Id;
  /** 昵称。 */
  nickname: string;
  /** 群名片／备注。 */
  card: string;
  /** 性别，`male` 或 `female` 或 `unknown`。 */
  sex: Sex;
  /** 年龄。 */
  age: int32;
  /** 地区。获取列表时可能无法获得。 */
  area?: string;
  /** 加群时间戳。 */
  join_time: int32;
  /** 最后发言时间戳。 */
  last_sent_time: int32;
  /** 成员等级。 */
  level: string;
  /** 角色，`owner` 或 `admin` 或 `member`。 */
  role: Role;
  /** 是否不良记录成员。 */
  unfriendly?: boolean;
  /** 专属头衔。获取列表时可能无法获得。 */
  title?: string;
  /** 专属头衔过期时间戳。 */
  title_expire_time?: int32;
  /** 是否允许修改群名片。 */
  card_changeable?: boolean;
}

/** 群成员列表。 */
model GroupMemberListResponse is GroupMemberInfo[];

/** 当前龙王。 */
model CurrentTalkative {
  /** QQ 号。 */
  user_id: Id;
  /** 昵称。 */
  nickname: string;
  /** 头像 URL。 */
  avatar: string;
  /** 持续天数。 */
  day_count: int32;
}

/** 群荣誉成员。 */
model HonorMember {
  /** QQ 号。 */
  user_id: Id;
  /** 昵称。 */
  nickname: string;
  /** 头像 URL。 */
  avatar: string;
  /** 荣誉描述。 */
  description: string;
}

/** 获取群荣誉信息。 */
model GroupHonorInfoResponse {
  /** 群号。 */
  group_id: Id;
  /** 当前龙王，仅 `type` 为 `talkative` 或 `all` 时有数据。 */
  current_talkative?: CurrentTalkative;
  /** 历史龙王，仅 `type` 为 `talkative` 或 `all` 时有数据。 */
  talkative_list?: HonorMember[];
  /** 群聊之火，仅 `type` 为 `performer` 或 `all` 时有数据。 */
  performer_list?: HonorMember[];
  /** 群聊炽焰，仅 `type` 为 `legend` 或 `all` 时有数据。 */
  legend_list?: HonorMember[];
  /** 冒尖小春笋，仅 `type` 为 `strong_newbie` 或 `all` 时有数据。 */
  strong_newbie_list?: HonorMember[];
  /** 快乐之源，仅 `type` 为 `emotion` 或 `all` 时有数据。 */
  emotion_list?: HonorMember[];
}

/** 获取 Cookies。 */
model CookiesResponse {
  /** Cookies。 */
  cookies: string;
}

/** 获取 CSRF Token。 */
model CsrfTokenResponse {
  /** CSRF Token。 */
  token: int32;
}

/** 获取 QQ 相关接口凭证。 */
model CredentialsResponse {
  /** Cookies。 */
  cookies: string;
  /** CSRF Token。 */
  csrf_token: int32;
}

/** 获取语音。 */
model RecordResponse {
  /** 转换后的语音文件路径，如 `/home/somebody/cqhttp/data/record/0B38145AA44505000B38145AA4450500.mp3`。 */
  file: string;
}

/** 获取图片。 */
model ImageResponse {
  /** 下载后的图片文件路径，如 `/home/somebody/cqhttp/data/image/6B4DE3DFD1BD271E3297859D41C530F5.jpg`。 */
  file: string;
}

/** 检查是否可以发送图片或语音。 */
model CanSendResponse {
  /** 是或否。 */
  yes: boolean;
}

/** 获取版本信息。 */
model VersionInfoResponse {
  /** 应用标识，如 `mirai-native`。 */
  app_name: string;
  /** 应用版本，如 `1.2.3`。 */
  app_version: string;
  /** OneBot 标准版本，如 `v11`。 */
  protocol_version: string;
  ...Record<unknown>;
}

// ---------------------------------------------------------------------------
// API 动作
// ---------------------------------------------------------------------------

/**
 * API 动作基类。`action` 字段标识操作，`params` 字段包含其参数。
 */
@discriminator("action")
model ActionBase {
  /** 动作名称，可附加 `_async` 或 `_rate_limited` 后缀。 */
  action: string;
  /** 动作参数。 */
  params?: unknown;
}

/** 发送私聊消息。 */
model SendPrivateMsgAction extends ActionBase {
  action: "send_private_msg";
  params: SendPrivateMsgParams;
}

/** 发送群消息。 */
model SendGroupMsgAction extends ActionBase {
  action: "send_group_msg";
  params: SendGroupMsgParams;
}

/** 发送消息。 */
model SendMsgAction extends ActionBase {
  action: "send_msg";
  params: SendMsgParams;
}

/** 撤回消息。 */
model DeleteMsgAction extends ActionBase {
  action: "delete_msg";
  params: DeleteMsgParams;
}

/** 获取消息。 */
model GetMsgAction extends ActionBase {
  action: "get_msg";
  params: GetMsgParams;
}

/** 获取合并转发消息。 */
model GetForwardMsgAction extends ActionBase {
  action: "get_forward_msg";
  params: GetForwardMsgParams;
}

/** 发送好友赞。 */
model SendLikeAction extends ActionBase {
  action: "send_like";
  params: SendLikeParams;
}

/** 群组踢人。 */
model SetGroupKickAction extends ActionBase {
  action: "set_group_kick";
  params: SetGroupKickParams;
}

/** 群组单人禁言。 */
model SetGroupBanAction extends ActionBase {
  action: "set_group_ban";
  params: SetGroupBanParams;
}

/** 群组匿名用户禁言。 */
model SetGroupAnonymousBanAction extends ActionBase {
  action: "set_group_anonymous_ban";
  params: SetGroupAnonymousBanParams;
}

/** 群组全员禁言。 */
model SetGroupWholeBanAction extends ActionBase {
  action: "set_group_whole_ban";
  params: SetGroupWholeBanParams;
}

/** 群组设置管理员。 */
model SetGroupAdminAction extends ActionBase {
  action: "set_group_admin";
  params: SetGroupAdminParams;
}

/** 群组匿名。 */
model SetGroupAnonymousAction extends ActionBase {
  action: "set_group_anonymous";
  params: SetGroupAnonymousParams;
}

/** 设置群名片（群备注）。 */
model SetGroupCardAction extends ActionBase {
  action: "set_group_card";
  params: SetGroupCardParams;
}

/** 设置群名。 */
model SetGroupNameAction extends ActionBase {
  action: "set_group_name";
  params: SetGroupNameParams;
}

/** 退出群组。 */
model SetGroupLeaveAction extends ActionBase {
  action: "set_group_leave";
  params: SetGroupLeaveParams;
}

/** 设置群组专属头衔。 */
model SetGroupSpecialTitleAction extends ActionBase {
  action: "set_group_special_title";
  params: SetGroupSpecialTitleParams;
}

/** 处理加好友请求。 */
model SetFriendAddRequestAction extends ActionBase {
  action: "set_friend_add_request";
  params: SetFriendAddRequestParams;
}

/** 处理加群请求／邀请。 */
model SetGroupAddRequestAction extends ActionBase {
  action: "set_group_add_request";
  params: SetGroupAddRequestParams;
}

/** 获取登录号信息。 */
model GetLoginInfoAction extends ActionBase {
  action: "get_login_info";
  params?: Empty;
}

/** 获取陌生人信息。 */
model GetStrangerInfoAction extends ActionBase {
  action: "get_stranger_info";
  params: GetStrangerInfoParams;
}

/** 获取好友列表。 */
model GetFriendListAction extends ActionBase {
  action: "get_friend_list";
  params?: Empty;
}

/** 获取群信息。 */
model GetGroupInfoAction extends ActionBase {
  action: "get_group_info";
  params: GetGroupInfoParams;
}

/** 获取群列表。 */
model GetGroupListAction extends ActionBase {
  action: "get_group_list";
  params?: Empty;
}

/** 获取群成员信息。 */
model GetGroupMemberInfoAction extends ActionBase {
  action: "get_group_member_info";
  params: GetGroupMemberInfoParams;
}

/** 获取群成员列表。 */
model GetGroupMemberListAction extends ActionBase {
  action: "get_group_member_list";
  params: GetGroupMemberListParams;
}

/** 获取群荣誉信息。 */
model GetGroupHonorInfoAction extends ActionBase {
  action: "get_group_honor_info";
  params: GetGroupHonorInfoParams;
}

/** 获取 Cookies。 */
model GetCookiesAction extends ActionBase {
  action: "get_cookies";
  params?: GetCookiesParams;
}

/** 获取 CSRF Token。 */
model GetCsrfTokenAction extends ActionBase {
  action: "get_csrf_token";
  params?: Empty;
}

/** 获取 QQ 相关接口凭证。 */
model GetCredentialsAction extends ActionBase {
  action: "get_credentials";
  params?: GetCredentialsParams;
}

/** 获取语音。 */
model GetRecordAction extends ActionBase {
  action: "get_record";
  params: GetRecordParams;
}

/** 获取图片。 */
model GetImageAction extends ActionBase {
  action: "get_image";
  params: GetImageParams;
}

/** 检查是否可以发送图片。 */
model CanSendImageAction extends ActionBase {
  action: "can_send_image";
  params?: Empty;
}

/** 检查是否可以发送语音。 */
model CanSendRecordAction extends ActionBase {
  action: "can_send_record";
  params?: Empty;
}

/** 获取运行状态。 */
model GetStatusAction extends ActionBase {
  action: "get_status";
  params?: Empty;
}

/** 获取版本信息。 */
model GetVersionInfoAction extends ActionBase {
  action: "get_version_info";
  params?: Empty;
}

/** 重启 OneBot 实现。 */
model SetRestartAction extends ActionBase {
  action: "set_restart";
  params?: SetRestartParams;
}

/** 清理缓存。 */
model CleanCacheAction extends ActionBase {
  action: "clean_cache";
  params?: Empty;
}

/** 对事件执行快速操作。 */
model HandleQuickOperationAction extends ActionBase {
  action: ".handle_quick_operation";
  params: HandleQuickOperationParams;
}

/** API 动作。 */
union Action {
  send_private_msg: SendPrivateMsgAction,
  send_group_msg: SendGroupMsgAction,
  send_msg: SendMsgAction,
  delete_msg: DeleteMsgAction,
  get_msg: GetMsgAction,
  get_forward_msg: GetForwardMsgAction,
  send_like: SendLikeAction,
  set_group_kick: SetGroupKickAction,
  set_group_ban: SetGroupBanAction,
  set_group_anonymous_ban: SetGroupAnonymousBanAction,
  set_group_whole_ban: SetGroupWholeBanAction,
  set_group_admin: SetGroupAdminAction,
  set_group_anonymous: SetGroupAnonymousAction,
  set_group_card: SetGroupCardAction,
  set_group_name: SetGroupNameAction,
  set_group_leave: SetGroupLeaveAction,
  set_group_special_title: SetGroupSpecialTitleAction,
  set_friend_add_request: SetFriendAddRequestAction,
  set_group_add_request: SetGroupAddRequestAction,
  get_login_info: GetLoginInfoAction,
  get_stranger_info: GetStrangerInfoAction,
  get_friend_list: GetFriendListAction,
  get_group_info: GetGroupInfoAction,
  get_group_list: GetGroupListAction,
  get_group_member_info: GetGroupMemberInfoAction,
  get_group_member_list: GetGroupMemberListAction,
  get_group_honor_info: GetGroupHonorInfoAction,
  get_cookies: GetCookiesAction,
  get_csrf_token: GetCsrfTokenAction,
  get_credentials: GetCredentialsAction,
  get_record: GetRecordAction,
  get_image: GetImageAction,
  can_send_image: CanSendImageAction,
  can_send_record: CanSendRecordAction,
  get_status: GetStatusAction,
  get_version_info: GetVersionInfoAction,
  set_restart: SetRestartAction,
  clean_cache: CleanCacheAction,
  handle_quick_operation: HandleQuickOperationAction,
}
