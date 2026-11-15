namespace OneBot;

/** 事件发生的时间戳，单位为秒。 */
scalar Timestamp extends int64;

/** OneBot 11 标识符（QQ 号、群号等 int64 标识）。 */
scalar Id extends int64;

/** 消息 ID。 */
scalar MessageId extends int32;

/** 性别。 */
enum Sex {
  male,
  female,
  "unknown",
}

/** 群成员角色。 */
enum Role {
  owner,
  admin,
  member,
}

/**
 * 值为 `0` 或 `1` 的参数，也可以使用 `no` 和 `yes`、`false` 和 `true`。
 */
union Flag {
  "0",
  "1",
  "no",
  "yes",
  "false",
  "true",
}

/** 空对象，用于没有参数的消息段和 API。 */
model Empty {}
