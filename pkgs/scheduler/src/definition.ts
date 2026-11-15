import { z } from "zod"
import { AuthoritySchema } from "@pi-im-bot/permissions/identity"

export const ScheduleSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  roomId: z.string(),
  cron: z.string().min(1),
  timezone: z.string().default("Asia/Shanghai"),
  prompt: z.string().min(1),
  enabled: z.boolean().default(true),
  isolated: z.boolean().default(true),
  createdAt: z.number(),
  nextRunAt: z.number().nullable(),
  lastRunAt: z.number().optional(),
  lastJobId: z.string().optional(),
  lastTriggerAt: z.number().optional(),
  lastOutcome: z.enum(["accepted", "skipped", "failed"]).optional(),
  lastError: z.string().optional(),
  revision: z.number().int().positive().default(1),
  executionEpoch: z.number().int().nonnegative().default(0),
  authority: AuthoritySchema.optional()
})
export type Schedule = z.infer<typeof ScheduleSchema>

export const ScheduleInputSchema = ScheduleSchema.pick({
  name: true,
  roomId: true,
  cron: true,
  timezone: true,
  prompt: true,
  enabled: true,
  isolated: true
}).extend({ name: z.string().min(1).max(100), prompt: z.string().min(1).max(20000) })
export type ScheduleInput = z.infer<typeof ScheduleInputSchema>
