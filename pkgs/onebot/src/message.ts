import { z } from "zod"
import { OneBotSegmentSchema, type OneBotSegment } from "./segment"

/**
 * 消息，支持字符串格式（CQ 码）和消息段数组格式。
 *
 * 显式的 schema 类型用于打破消息与合并转发自定义节点之间的递归类型推断，
 * 因为自定义节点的 `content` 本身也是消息。
 */
export type OneBotMessage = string | OneBotSegment[]
export const OneBotMessageSchema: z.ZodType<OneBotMessage> = z.union([
  z.string(),
  z.array(z.lazy(() => OneBotSegmentSchema))
])

/**
 * API 参数和快速操作中接受的消息类型：字符串、单个消息段或消息段数组。
 */
export const OneBotMessageInputSchema = z.union([
  z.string(),
  z.lazy(() => OneBotSegmentSchema),
  z.array(z.lazy(() => OneBotSegmentSchema))
])
export type OneBotMessageInput = z.infer<typeof OneBotMessageInputSchema>

/** 事件数据中的消息格式。 */
export const OneBotMessageFormatSchema = z.enum(["string", "array"])
export type OneBotMessageFormat = z.infer<typeof OneBotMessageFormatSchema>
