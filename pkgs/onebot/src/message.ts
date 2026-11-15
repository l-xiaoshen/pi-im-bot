import { z } from "zod"
import { OneBotSegmentSchema, type OneBotSegment } from "./segment"

/**
 * A message in the array format. The explicit schema type breaks the recursive
 * type inference between messages and custom forward nodes, whose content is
 * itself a message.
 */
export type OneBotMessage = string | OneBotSegment[]
export const OneBotMessageSchema: z.ZodType<OneBotMessage> = z.union([
  z.string(),
  z.array(z.lazy(() => OneBotSegmentSchema))
])

/**
 * Message values accepted by API parameters and quick operations: a CQ code
 * string, a single segment, or an array of segments.
 */
export const OneBotMessageInputSchema = z.union([
  z.string(),
  z.lazy(() => OneBotSegmentSchema),
  z.array(z.lazy(() => OneBotSegmentSchema))
])
export type OneBotMessageInput = z.infer<typeof OneBotMessageInputSchema>

export const OneBotMessageFormatSchema = z.enum(["string", "array"])
export type OneBotMessageFormat = z.infer<typeof OneBotMessageFormatSchema>
