import { z } from "zod"
import { ExecutionContextSchema } from "@pi-im-bot/contracts/run"
import { RunInputSchema } from "@pi-im-bot/contracts/run-input"
import { PluginOriginSchema } from "../rpc/protocol"

export const ObservationSchema = z.object({
  id: z.string(),
  roomId: z.string(),
  createdAt: z.number(),
  deadlineAt: z.number(),
  ready: z.boolean().default(true),
  origin: PluginOriginSchema,
  point: z.string().regex(/^[a-z][a-z0-9_.-]{0,160}@\d+$/u),
  configSnapshot: z.string(),
  mode: z.enum(["demo", "live"]),
  input: RunInputSchema.extend({ context: ExecutionContextSchema }),
  payload: z.record(z.string(), z.json()),
  handlers: z.array(z.string()).max(64)
})
export type Observation = z.infer<typeof ObservationSchema>
export const ObservationStateSchema = z.enum(["queued", "running", "done", "failed", "unknown", "expired", "cancelled"])
export const ObserverRecordSchema = z.object({
  taskId: z.number().int(),
  key: z.string(),
  eventId: z.string(),
  roomId: z.string(),
  handler: z.string(),
  state: ObservationStateSchema,
  at: z.number(),
  dueAt: z.number().optional(),
  error: z.string().optional()
})
export type ObserverRecord = z.infer<typeof ObserverRecordSchema>
export const ObserverStatusSchema = z.object({
  enabled: z.boolean(),
  outbox: z.number(),
  dropped: z.number(),
  lastError: z.string().optional(),
  active: z.array(ObserverRecordSchema),
  recent: z.array(ObserverRecordSchema)
})
