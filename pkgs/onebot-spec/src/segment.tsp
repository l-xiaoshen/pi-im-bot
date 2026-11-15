namespace OneBot;

/**
 * 消息段基类，OneBot 11 数组格式中的基本单位。
 *
 * `type` 字段对应 CQ 码中的「功能名」，`data` 字段对应 CQ 码的参数。
 * 消息段参数值在标准中均为字符串，以便与 CQ 码相互转换。
 */
@discriminator("type")
model MessageSegmentBase {
  /** 消息段类型。 */
  type: string;
  /** 消息段参数。 */
  data: unknown;
}

/** 纯文本。 */
model TextSegment extends MessageSegmentBase {
  type: "text";
  data: TextSegmentData;
}

model TextSegmentData {
  /** 纯文本内容。 */
  text: string;
}

/** QQ 表情。 */
model FaceSegment extends MessageSegmentBase {
  type: "face";
  data: FaceSegmentData;
}

model FaceSegmentData {
  /** QQ 表情 ID。 */
  id: string;
}

/** 图片。 */
model ImageSegment extends MessageSegmentBase {
  type: "image";
  data: ImageSegmentData;
}

model ImageSegmentData {
  /** 图片文件名。 */
  file: string;
  /** 图片类型，`flash` 表示闪照，无此参数表示普通图片。 */
  type?: "flash";
  /** 图片 URL。 */
  url?: string;
  /** 只在通过网络 URL 发送时有效，表示是否使用已缓存的文件，默认 `1`。 */
  cache?: Flag;
  /** 只在通过网络 URL 发送时有效，表示是否通过代理下载文件，默认 `1`。 */
  proxy?: Flag;
  /** 只在通过网络 URL 发送时有效，单位秒，表示下载网络文件的超时时间，默认不超时。 */
  timeout?: string;
}

/** 语音。 */
model RecordSegment extends MessageSegmentBase {
  type: "record";
  data: RecordSegmentData;
}

model RecordSegmentData {
  /** 语音文件名。 */
  file: string;
  /** 发送时可选，默认 `0`，设置为 `1` 表示变声。 */
  magic?: Flag;
  /** 语音 URL。 */
  url?: string;
  /** 只在通过网络 URL 发送时有效，表示是否使用已缓存的文件，默认 `1`。 */
  cache?: Flag;
  /** 只在通过网络 URL 发送时有效，表示是否通过代理下载文件，默认 `1`。 */
  proxy?: Flag;
  /** 只在通过网络 URL 发送时有效，单位秒，表示下载网络文件的超时时间，默认不超时。 */
  timeout?: string;
}

/** 短视频。 */
model VideoSegment extends MessageSegmentBase {
  type: "video";
  data: VideoSegmentData;
}

model VideoSegmentData {
  /** 视频文件名。 */
  file: string;
  /** 视频 URL。 */
  url?: string;
  /** 只在通过网络 URL 发送时有效，表示是否使用已缓存的文件，默认 `1`。 */
  cache?: Flag;
  /** 只在通过网络 URL 发送时有效，表示是否通过代理下载文件，默认 `1`。 */
  proxy?: Flag;
  /** 只在通过网络 URL 发送时有效，单位秒，表示下载网络文件的超时时间，默认不超时。 */
  timeout?: string;
}

/** @某人。 */
model AtSegment extends MessageSegmentBase {
  type: "at";
  data: AtSegmentData;
}

model AtSegmentData {
  /** `@` 的 QQ 号，`all` 表示全体成员。 */
  qq: string;
}

/** 猜拳魔法表情。 */
model RpsSegment extends MessageSegmentBase {
  type: "rps";
  data: Empty | null;
}

/** 掷骰子魔法表情。 */
model DiceSegment extends MessageSegmentBase {
  type: "dice";
  data: Empty | null;
}

/** 窗口抖动（戳一戳）。 */
model ShakeSegment extends MessageSegmentBase {
  type: "shake";
  data: Empty | null;
}

/** 戳一戳。 */
model PokeSegment extends MessageSegmentBase {
  type: "poke";
  data: PokeSegmentData;
}

model PokeSegmentData {
  /** 类型。 */
  type: string;
  /** ID。 */
  id: string;
  /** 表情名。 */
  name?: string;
}

/** 匿名发消息。 */
model AnonymousSegment extends MessageSegmentBase {
  type: "anonymous";
  data: AnonymousSegmentData | null;
}

model AnonymousSegmentData {
  /** 可选，表示无法匿名时是否继续发送。 */
  ignore?: Flag;
}

/** 链接分享。 */
model ShareSegment extends MessageSegmentBase {
  type: "share";
  data: ShareSegmentData;
}

model ShareSegmentData {
  /** URL。 */
  url: string;
  /** 标题。 */
  title: string;
  /** 发送时可选，内容描述。 */
  content?: string;
  /** 发送时可选，图片 URL。 */
  image?: string;
}

/** 推荐好友或推荐群。 */
model ContactSegment extends MessageSegmentBase {
  type: "contact";
  data: ContactSegmentData;
}

model ContactSegmentData {
  /** `qq` 表示推荐好友，`group` 表示推荐群。 */
  type: "qq" | "group";
  /** 被推荐人的 QQ 号或被推荐群的群号。 */
  id: string;
}

/** 位置。 */
model LocationSegment extends MessageSegmentBase {
  type: "location";
  data: LocationSegmentData;
}

model LocationSegmentData {
  /** 纬度。 */
  lat: string;
  /** 经度。 */
  lon: string;
  /** 发送时可选，标题。 */
  title?: string;
  /** 发送时可选，内容描述。 */
  content?: string;
}

/** 音乐分享。 */
model MusicSegment extends MessageSegmentBase {
  type: "music";
  data: MusicSegmentData;
}

union MusicSegmentData {
  platform: MusicPlatformData,
  custom: MusicCustomData,
}

model MusicPlatformData {
  /** 分别表示使用 QQ 音乐、网易云音乐、虾米音乐。 */
  type: "qq" | "163" | "xm";
  /** 歌曲 ID。 */
  id: string;
}

model MusicCustomData {
  /** 表示音乐自定义分享。 */
  type: "custom";
  /** 点击后跳转目标 URL。 */
  url: string;
  /** 音乐 URL。 */
  audio: string;
  /** 标题。 */
  title: string;
  /** 发送时可选，内容描述。 */
  content?: string;
  /** 发送时可选，图片 URL。 */
  image?: string;
}

/** 回复。 */
model ReplySegment extends MessageSegmentBase {
  type: "reply";
  data: ReplySegmentData;
}

model ReplySegmentData {
  /** 回复时引用的消息 ID。 */
  id: string;
}

/** 合并转发。 */
model ForwardSegment extends MessageSegmentBase {
  type: "forward";
  data: ForwardSegmentData;
}

model ForwardSegmentData {
  /** 合并转发 ID，需通过 `get_forward_msg` API 获取具体内容。 */
  id: string;
}

/** 合并转发节点。 */
model NodeSegment extends MessageSegmentBase {
  type: "node";
  data: NodeSegmentData;
}

union NodeSegmentData {
  id: NodeIdData,
  custom: NodeCustomData,
}

model NodeIdData {
  /** 转发的消息 ID。 */
  id: string;
}

model NodeCustomData {
  /** 发送者 QQ 号。 */
  user_id: string;
  /** 发送者昵称。 */
  nickname: string;
  /** 消息内容，支持发送消息时的 `message` 数据类型。 */
  content: Message;
}

/** XML 消息。 */
model XmlSegment extends MessageSegmentBase {
  type: "xml";
  data: XmlSegmentData;
}

model XmlSegmentData {
  /** XML 内容。 */
  data: string;
}

/** JSON 消息。 */
model JsonSegment extends MessageSegmentBase {
  type: "json";
  data: JsonSegmentData;
}

model JsonSegmentData {
  /** JSON 内容。 */
  data: string;
}

/** 消息段。 */
union MessageSegment {
  text: TextSegment,
  face: FaceSegment,
  image: ImageSegment,
  record: RecordSegment,
  video: VideoSegment,
  at: AtSegment,
  rps: RpsSegment,
  dice: DiceSegment,
  shake: ShakeSegment,
  poke: PokeSegment,
  anonymous: AnonymousSegment,
  share: ShareSegment,
  contact: ContactSegment,
  location: LocationSegment,
  music: MusicSegment,
  reply: ReplySegment,
  forward: ForwardSegment,
  node: NodeSegment,
  xml: XmlSegment,
  json: JsonSegment,
}
