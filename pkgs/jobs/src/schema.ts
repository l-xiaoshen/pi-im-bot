import { MessageFormatSchema, BusinessStatusSchema, BusinessItemSchema } from "@pi-im-bot/contracts/message-format"
import { z } from "zod"
import { ExecutionContextSchema } from "@pi-im-bot/contracts/run"
import { ScheduleOriginSchema } from "@pi-im-bot/scheduler/origin"
import { ExternalStatusSchema } from "./external/status"

export const JobSpecSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("agent"), prompt: z.string().min(1).max(20000) }),
  z.object({
    kind: z.literal("tool"),
    capability: z.string().min(1),
    arguments: z.record(z.string(), z.json())
  })
])
export type JobSpec = z.infer<typeof JobSpecSchema>
export const JobStateSchema = z.enum([
  "queued",
  "running",
  "waiting_external",
  "waiting_input",
  "succeeded",
  "failed",
  "cancel_requested",
  "cancelled",
  "outcome_unknown"
])
export const JobResultSchema = z.object({
  summary: z.string(),
  artifactIds: z.array(z.string()).default([]),
  format: MessageFormatSchema.optional(),
  itemized: z.boolean().optional(),
  businessStatus: BusinessStatusSchema.optional(),
  factsComplete: z.boolean().optional(),
  items: z.array(BusinessItemSchema).max(16).optional()
})
export const JobRevisionSchema = z.object({
  revision: z.number().int().positive(),
  title: z.string().min(1).max(100),
  spec: JobSpecSchema,
  state: JobStateSchema,
  createdAt: z.number(),
  startedAt: z.number().optional(),
  finishedAt: z.number().optional(),
  deadlineAt: z.number(),
  sourceRunId: z.string(),
  sourceMessageIds: z.array(z.string()),
  parentJobId: z.string().optional(),
  parentJobRevision: z.number().int().optional(),
  context: ExecutionContextSchema,
  configSnapshot: z.string(),
  requiredActions: z.array(z.string()).default([]),
  presentation: z
    .object({
      outboundId: z.string(),
      parentJobId: z.string().optional(),
      parentJobRevision: z.number().optional()
    })
    .optional(),
  schedule: ScheduleOriginSchema.optional(),
  mode: z.enum(["demo", "live"]),
  nativeTaskId: z.number().int().positive().optional(),
  childConversationId: z.string(),
  runId: z.string().optional(),
  delivery: z.enum(["pending", "accepted", "sent", "unknown", "suppressed", "none", "partial"]).default("pending"),
  cancelRequested: z.boolean().default(false),
  result: JobResultSchema.optional(),
  deliveryError: z.string().optional(),
  error: z.string().optional(),
  external: ExternalStatusSchema.optional()
})
export type JobRevision = z.infer<typeof JobRevisionSchema>
export const JobSchema = z.object({
  id: z.uuid(),
  roomId: z.string(),
  currentRevision: z.number().int().positive(),
  revisions: z.record(z.string(), JobRevisionSchema)
})
export type Job = z.infer<typeof JobSchema>
export const JobSummarySchema = z.object({
  kind: z.enum(["agent", "tool"]).optional(),
  id: z.string(),
  roomId: z.string(),
  title: z.string(),
  revision: z.number().int(),
  state: JobStateSchema,
  createdAt: z.number(),
  updatedAt: z.number(),
  parentJobId: z.string().optional(),
  runId: z.string().optional(),
  delivery: JobRevisionSchema.shape.delivery,
  schedule: ScheduleOriginSchema.optional(),
  deliveryError: z.string().optional(),
  result: JobResultSchema.optional(),
  error: z.string().optional(),
  external: JobRevisionSchema.shape.external
})
export type JobSummary = z.infer<typeof JobSummarySchema>

export function jobSummary(job: Job): JobSummary {
  const current = job.revisions[String(job.currentRevision)]
  return {
    kind: current.spec.kind,
    id: job.id,
    roomId: job.roomId,
    title: current.title,
    revision: current.revision,
    state: current.state,
    createdAt: current.createdAt,
    updatedAt: current.finishedAt ?? current.startedAt ?? current.createdAt,
    parentJobId: current.parentJobId,
    runId: current.runId,
    delivery: current.delivery,
    schedule: current.schedule,
    deliveryError: current.deliveryError,
    result: current.result,
    error: current.error,
    external: current.external
  }
}

export function jobTerminal(state: JobSummary["state"]) {
  return ["succeeded", "failed", "cancelled", "outcome_unknown"].includes(state)
}
