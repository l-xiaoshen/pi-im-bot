import { z } from "zod"

/** echo 值。 */
export const OneBotEchoSchema = z.union([z.string(), z.number()])
export type OneBotEcho = z.infer<typeof OneBotEchoSchema>

/**
 * HTTP 和 WebSocket API 调用使用的信封。需要同时校验 action 及其参数时，
 * 请使用 `./api` 中的 `OneBotActionSchema`。
 */
export const OneBotApiRequestSchema = z.object({
  action: z.string().min(1),
  params: z.record(z.string(), z.unknown()).default({}),
  echo: OneBotEchoSchema.optional()
})
export type OneBotApiRequest = z.infer<typeof OneBotApiRequestSchema>

/** API 响应状态。 */
export const OneBotResponseStatusSchema = z.enum(["ok", "failed", "async"])
export type OneBotResponseStatus = z.infer<typeof OneBotResponseStatusSchema>

/** API 响应信封。 */
export const OneBotApiResponseSchema = z.object({
  status: OneBotResponseStatusSchema,
  retcode: z.number().int(),
  data: z.unknown().optional(),
  message: z.string().optional(),
  wording: z.string().optional(),
  echo: OneBotEchoSchema.optional()
})
export type OneBotApiResponse = z.infer<typeof OneBotApiResponseSchema>
