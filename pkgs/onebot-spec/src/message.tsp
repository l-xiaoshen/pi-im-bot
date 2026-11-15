namespace OneBot;

/**
 * 消息，支持字符串格式（CQ 码）和消息段数组格式。
 */
union Message {
  string,
  MessageSegment[],
}

/**
 * API 参数和快速操作中接受的消息类型：字符串、单个消息段或消息段数组。
 */
union MessageInput {
  string,
  MessageSegment,
  MessageSegment[],
}

/** 事件数据中的消息格式。 */
enum MessageFormat {
  "string",
  "array",
}
