import { z } from 'zod'

export const ScheduleOriginSchema = z.object({
  id: z.string(),
  occurrence: z.string(),
  scheduledAt: z.number(),
  isolated: z.boolean(),
  entry: z.boolean(),
  epoch: z.number().int().nonnegative().default(0),
  timezone: z.string().default('Asia/Shanghai')
})
export type ScheduleOrigin = z.infer<typeof ScheduleOriginSchema>
