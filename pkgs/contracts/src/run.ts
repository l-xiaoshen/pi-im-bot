import { z } from 'zod'
import { EffectiveSettingsSchema } from '@pi-im-bot/settings/schema'
import { AuthoritySchema } from '@pi-im-bot/permissions/identity'
import { RunInputSchema, RunSourceSchema, type RunInput } from './run-input'
export type { RunInput } from './run-input'

export const ExecutionContextSchema = z.object({
  conversationId: z.string(),
  rootConversationId: z.string(),
  conversationEpoch: z.number(),
  sessionKey: z.string(),
  workspaceScope: z.string().optional(),
  jobId: z.string().optional(),
  jobRevision: z.number().int().positive().optional(),
  nativeOwnerTask: z.number().int().positive().optional(),
  schedule: z.object({ id: z.string(), epoch: z.number().int().nonnegative() }).optional(),
  capabilityRevisions: z.record(z.string(), z.string()).default({}),
  effective: EffectiveSettingsSchema,
  authority: AuthoritySchema
})
export type ExecutionContext = z.infer<typeof ExecutionContextSchema>

export const UsageSchema = z.object({
  input: z.number().default(0),
  output: z.number().default(0),
  cacheRead: z.number().default(0),
  cacheWrite: z.number().default(0)
})
export type Usage = z.infer<typeof UsageSchema>

export const RunSchema = z.object({
  id: z.string(),
  roomId: z.string(),
  source: RunSourceSchema,
  engine: z.enum(['coding', 'durable']).default('coding'),
  input: RunInputSchema.optional(),
  configSnapshot: z.string().optional(),
  mode: z.enum(['demo', 'live']),
  status: z.enum(['batching', 'queued', 'running', 'completed', 'failed', 'cancelled', 'interrupted']),
  providerGroup: z.string(),
  context: ExecutionContextSchema.optional(),
  rawReply: z.string().optional(),
  presentation: z
    .object({
      state: z.enum(['accepted', 'sent', 'unknown', 'partial', 'suppressed']),
      jobId: z.string().optional()
    })
    .optional(),
  createdAt: z.number(),
  startedAt: z.number().optional(),
  deadlineAt: z.number().optional(),
  finishedAt: z.number().optional(),
  error: z.string().optional(),
  modelCalls: z.number().default(0),
  toolCalls: z.number().default(0),
  usage: UsageSchema
})
export type Run = z.infer<typeof RunSchema>

export const TraceSchema = z.object({
  id: z.string(),
  roomId: z.string(),
  runId: z.string(),
  at: z.number(),
  kind: z.enum([
    'queued',
    'started',
    'provider',
    'tool',
    'delivery',
    'compaction',
    'media',
    'plugin',
    'cancelled',
    'error',
    'completed'
  ]),
  title: z.string(),
  detail: z.string().default(''),
  provider: z.string().optional(),
  model: z.string().optional(),
  attempt: z.number().optional(),
  durationMs: z.number().optional(),
  usage: UsageSchema.optional()
})
export type Trace = z.infer<typeof TraceSchema>

export interface PreparedRunInput extends RunInput {
  context: ExecutionContext
}
