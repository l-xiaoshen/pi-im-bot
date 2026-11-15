namespace OneBot;

/** 私聊消息发送人信息。 */
model PrivateSender {
  /** 发送者 QQ 号。 */
  user_id?: Id;
  /** 昵称。 */
  nickname?: string;
  /** 性别，`male` 或 `female` 或 `unknown`。 */
  sex?: Sex;
  /** 年龄。 */
  age?: int32;
}

/** 群消息发送人信息。 */
model GroupSender extends PrivateSender {
  /** 群名片／备注。 */
  card?: string;
  /** 地区。 */
  area?: string;
  /** 成员等级。 */
  level?: string;
  /** 角色，`owner` 或 `admin` 或 `member`。 */
  role?: Role;
  /** 专属头衔。 */
  title?: string;
}

/** 匿名信息。 */
model Anonymous {
  /** 匿名用户 ID。 */
  id: Id;
  /** 匿名用户名称。 */
  name: string;
  /** 匿名用户 flag，在调用禁言 API 时需要传入。 */
  flag: string;
}

/** OneBot 运行状态。 */
model Status {
  /** 当前 QQ 在线，`null` 表示无法查询到在线状态。 */
  online: boolean | null;
  /** 状态符合预期，意味着各模块正常运行、功能正常，且 QQ 在线。 */
  good: boolean;
  ...Record<unknown>;
}

/**
 * 事件基类。每个事件都有 `time`、`self_id` 和 `post_type` 字段。
 */
@discriminator("post_type")
model EventBase {
  /** 事件发生的时间戳。 */
  time: Timestamp;
  /** 收到事件的机器人 QQ 号。 */
  self_id: Id;
  /** 事件类型。 */
  post_type: string;
}

/** 消息事件基类。 */
@discriminator("message_type")
model MessageEventBase extends EventBase {
  post_type: "message";
  /** 消息类型。 */
  message_type: string;
  /** 消息 ID。 */
  message_id: MessageId;
  /** 发送者 QQ 号。 */
  user_id: Id;
  /** 消息内容。 */
  message: Message;
  /** 原始消息内容。 */
  raw_message: string;
  /** 字体。 */
  font: int32;
}

/** 私聊消息事件。 */
model PrivateMessageEvent extends MessageEventBase {
  message_type: "private";
  /** 消息子类型，如果是好友则是 `friend`，如果是群临时会话则是 `group`。 */
  sub_type: "friend" | "group" | "other";
  /** 发送人信息。 */
  sender: PrivateSender;
}

/** 群消息事件。 */
model GroupMessageEvent extends MessageEventBase {
  message_type: "group";
  /** 消息子类型，正常消息是 `normal`，匿名消息是 `anonymous`，系统提示是 `notice`。 */
  sub_type: "normal" | "anonymous" | "notice";
  /** 群号。 */
  group_id: Id;
  /** 匿名信息，如果不是匿名消息则为 `null`。 */
  anonymous: Anonymous | null;
  /** 发送人信息。 */
  sender: GroupSender;
}

/** 消息事件。 */
union MessageEvent {
  private: PrivateMessageEvent,
  group: GroupMessageEvent,
}

/** 通知事件基类。 */
@discriminator("notice_type")
model NoticeEventBase extends EventBase {
  post_type: "notice";
  /** 通知类型。 */
  notice_type: string;
}

/** 群文件上传。 */
model GroupUploadNoticeEvent extends NoticeEventBase {
  notice_type: "group_upload";
  /** 群号。 */
  group_id: Id;
  /** 发送者 QQ 号。 */
  user_id: Id;
  /** 文件信息。 */
  file: FileInfo;
}

/** 文件信息。 */
model FileInfo {
  /** 文件 ID。 */
  id: string;
  /** 文件名。 */
  name: string;
  /** 文件大小（字节数）。 */
  size: int64;
  /** busid（目前不清楚有什么作用）。 */
  busid: int64;
}

/** 群管理员变动。 */
model GroupAdminNoticeEvent extends NoticeEventBase {
  notice_type: "group_admin";
  /** 事件子类型，分别表示设置和取消管理员。 */
  sub_type: "set" | "unset";
  /** 群号。 */
  group_id: Id;
  /** 管理员 QQ 号。 */
  user_id: Id;
}

/** 群成员减少。 */
model GroupDecreaseNoticeEvent extends NoticeEventBase {
  notice_type: "group_decrease";
  /** 事件子类型，分别表示主动退群、成员被踢、登录号被踢。 */
  sub_type: "leave" | "kick" | "kick_me";
  /** 群号。 */
  group_id: Id;
  /** 操作者 QQ 号（如果是主动退群，则和 `user_id` 相同）。 */
  operator_id: Id;
  /** 离开者 QQ 号。 */
  user_id: Id;
}

/** 群成员增加。 */
model GroupIncreaseNoticeEvent extends NoticeEventBase {
  notice_type: "group_increase";
  /** 事件子类型，分别表示管理员已同意入群、管理员邀请入群。 */
  sub_type: "approve" | "invite";
  /** 群号。 */
  group_id: Id;
  /** 操作者 QQ 号。 */
  operator_id: Id;
  /** 加入者 QQ 号。 */
  user_id: Id;
}

/** 群禁言。 */
model GroupBanNoticeEvent extends NoticeEventBase {
  notice_type: "group_ban";
  /** 事件子类型，分别表示禁言、解除禁言。 */
  sub_type: "ban" | "lift_ban";
  /** 群号。 */
  group_id: Id;
  /** 操作者 QQ 号。 */
  operator_id: Id;
  /** 被禁言 QQ 号。 */
  user_id: Id;
  /** 禁言时长，单位秒。 */
  duration: int64;
}

/** 好友添加。 */
model FriendAddNoticeEvent extends NoticeEventBase {
  notice_type: "friend_add";
  /** 新添加好友 QQ 号。 */
  user_id: Id;
}

/** 群消息撤回。 */
model GroupRecallNoticeEvent extends NoticeEventBase {
  notice_type: "group_recall";
  /** 群号。 */
  group_id: Id;
  /** 消息发送者 QQ 号。 */
  user_id: Id;
  /** 操作者 QQ 号。 */
  operator_id: Id;
  /** 被撤回的消息 ID。 */
  message_id: int64;
}

/** 好友消息撤回。 */
model FriendRecallNoticeEvent extends NoticeEventBase {
  notice_type: "friend_recall";
  /** 好友 QQ 号。 */
  user_id: Id;
  /** 被撤回的消息 ID。 */
  message_id: int64;
}

/** `notify` 通知事件基类。 */
@discriminator("sub_type")
model NotifyNoticeEventBase extends NoticeEventBase {
  notice_type: "notify";
  /** 提示类型。 */
  sub_type: string;
}

/** 群内戳一戳。 */
model PokeNoticeEvent extends NotifyNoticeEventBase {
  sub_type: "poke";
  /** 群号。 */
  group_id: Id;
  /** 发送者 QQ 号。 */
  user_id: Id;
  /** 被戳者 QQ 号。 */
  target_id: Id;
}

/** 群红包运气王。 */
model LuckyKingNoticeEvent extends NotifyNoticeEventBase {
  sub_type: "lucky_king";
  /** 群号。 */
  group_id: Id;
  /** 红包发送者 QQ 号。 */
  user_id: Id;
  /** 运气王 QQ 号。 */
  target_id: Id;
}

/** 群成员荣誉变更。 */
model HonorNoticeEvent extends NotifyNoticeEventBase {
  sub_type: "honor";
  /** 群号。 */
  group_id: Id;
  /** 成员 QQ 号。 */
  user_id: Id;
  /** 荣誉类型，分别表示龙王、群聊之火、快乐源泉。 */
  honor_type: "talkative" | "performer" | "emotion";
}

/** `notify` 通知事件。 */
union NotifyNoticeEvent {
  poke: PokeNoticeEvent,
  lucky_king: LuckyKingNoticeEvent,
  honor: HonorNoticeEvent,
}

/** 通知事件。 */
union NoticeEvent {
  group_upload: GroupUploadNoticeEvent,
  group_admin: GroupAdminNoticeEvent,
  group_decrease: GroupDecreaseNoticeEvent,
  group_increase: GroupIncreaseNoticeEvent,
  group_ban: GroupBanNoticeEvent,
  friend_add: FriendAddNoticeEvent,
  group_recall: GroupRecallNoticeEvent,
  friend_recall: FriendRecallNoticeEvent,
  notify: NotifyNoticeEvent,
}

/** 请求事件基类。 */
@discriminator("request_type")
model RequestEventBase extends EventBase {
  post_type: "request";
  /** 请求类型。 */
  request_type: string;
}

/** 加好友请求。 */
model FriendRequestEvent extends RequestEventBase {
  request_type: "friend";
  /** 发送请求的 QQ 号。 */
  user_id: Id;
  /** 验证信息。 */
  comment: string;
  /** 请求 flag，在调用处理请求的 API 时需要传入。 */
  flag: string;
}

/** 加群请求／邀请。 */
model GroupRequestEvent extends RequestEventBase {
  request_type: "group";
  /** 请求子类型，分别表示加群请求、邀请登录号入群。 */
  sub_type: "add" | "invite";
  /** 群号。 */
  group_id: Id;
  /** 发送请求的 QQ 号。 */
  user_id: Id;
  /** 验证信息。 */
  comment: string;
  /** 请求 flag，在调用处理请求的 API 时需要传入。 */
  flag: string;
}

/** 请求事件。 */
union RequestEvent {
  friend: FriendRequestEvent,
  group: GroupRequestEvent,
}

/** 元事件基类。 */
@discriminator("meta_event_type")
model MetaEventBase extends EventBase {
  post_type: "meta_event";
  /** 元事件类型。 */
  meta_event_type: string;
}

/** 生命周期元事件。 */
model LifecycleMetaEvent extends MetaEventBase {
  meta_event_type: "lifecycle";
  /** 事件子类型，分别表示 OneBot 启用、停用、WebSocket 连接成功。 */
  sub_type: "enable" | "disable" | "connect";
}

/** 心跳元事件。 */
model HeartbeatMetaEvent extends MetaEventBase {
  meta_event_type: "heartbeat";
  /** 状态信息。 */
  status: Status;
  /** 到下次心跳的间隔，单位毫秒。 */
  interval: int64;
}

/** 元事件。 */
union MetaEvent {
  lifecycle: LifecycleMetaEvent,
  heartbeat: HeartbeatMetaEvent,
}

/** 事件。 */
union Event {
  message: MessageEvent,
  notice: NoticeEvent,
  request: RequestEvent,
  meta_event: MetaEvent,
}

/**
 * 快速操作，可在 HTTP POST 响应中返回，也可通过隐藏 API
 * `.handle_quick_operation` 执行。
 */
model QuickOperation {
  /** 要回复的内容。 */
  reply?: MessageInput;
  /** 消息内容是否作为纯文本发送（即不解析 CQ 码），只在 `reply` 字段是字符串时有效。 */
  auto_escape?: boolean;
  /** 是否要在回复开头 at 发送者（自动添加），发送者是匿名用户时无效。 */
  at_sender?: boolean;
  /** 撤回该条消息。 */
  "delete"?: boolean;
  /** 把发送者踢出群组（需要登录号权限足够），不拒绝此人后续加群请求，发送者是匿名用户时无效。 */
  kick?: boolean;
  /** 把发送者禁言 `ban_duration` 指定时长，对匿名用户也有效。 */
  ban?: boolean;
  /** 禁言时长。 */
  ban_duration?: int64;
  /** 是否同意请求。 */
  approve?: boolean;
  /** 添加后的好友备注（仅在同意时有效）。 */
  remark?: string;
  /** 拒绝理由（仅在拒绝时有效）。 */
  reason?: string;
  ...Record<unknown>;
}
