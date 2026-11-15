import { z } from "zod"

export const OneBotEchoSchema = z.union([z.string(), z.number()])
export type OneBotEcho = z.infer<typeof OneBotEchoSchema>

/**
 * Envelope used by HTTP and WebSocket API calls. Use `OneBotActionSchema` from
 * `./api` when the action and its parameters should be validated together.
 */
export const OneBotApiRequestSchema = z.object({
  action: z.string().min(1),
  params: z.record(z.string(), z.unknown()).default({}),
  echo: OneBotEchoSchema.optional()
})
export type OneBotApiRequest = z.infer<typeof OneBotApiRequestSchema>

export const OneBotResponseStatusSchema = z.enum(["ok", "failed", "async"])
export type OneBotResponseStatus = z.infer<typeof OneBotResponseStatusSchema>

export const OneBotApiResponseSchema = z.object({
  status: OneBotResponseStatusSchema,
  retcode: z.number().int(),
  data: z.unknown().optional(),
  message: z.string().optional(),
  wording: z.string().optional(),
  echo: OneBotEchoSchema.optional()
})
export type OneBotApiResponse = z.infer<typeof OneBotApiResponseSchema>
