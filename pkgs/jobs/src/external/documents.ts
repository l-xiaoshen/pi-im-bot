import { defineDoc, defineDocFamily } from "@earendil-works/pi-durable"
import { z } from "zod"
import { McpSessionSnapshotSchema, McpRemoteTaskSchema } from "@pi-im-bot/resources/mcp/task-schema"

export const ExternalExecutionSchema = z.object({
  serverId: z.string(),
  session: McpSessionSnapshotSchema.optional(),
  remote: McpRemoteTaskSchema.optional(),
  submittedAt: z.number().optional(),
  expiresAt: z.number().optional(),
  failures: z.number().int().nonnegative().default(0),
  cancelDispatched: z.boolean().default(false),
  sessionRedactions: z.array(z.string()).max(64).default([])
})
export type ExternalExecution = z.infer<typeof ExternalExecutionSchema>

// Contains transport session IDs. Never serialize these documents through public Job APIs.
export const ExternalExecutions = defineDocFamily<{ value: ExternalExecution | null }, null>({
  kind: "bot.external-execution",
  version: 1,
  scope: "session",
  family: true,
  initial: () => ({ value: null }),
  checkpointWhen: () => false
})
export const ExternalSlots = defineDoc<{ owners: Record<string, { jobId: string; serverId: string }> }>({
  kind: "bot.external-slots",
  version: 1,
  scope: "session",
  initial: () => ({ owners: {} }),
  checkpointWhen: () => false
})
export function externalKey(jobId: string, revision: number) {
  return `${jobId}:${revision}`
}
