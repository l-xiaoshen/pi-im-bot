import { z } from 'zod'

export const McpTaskCapabilitiesSchema = z.object({
  list: z.object({}).optional(),
  cancel: z.object({}).optional(),
  requests: z.object({ tools: z.object({ call: z.object({}).optional() }).optional() }).optional()
})
export const McpInitializationSchema = z.object({
  protocolVersion: z.string().min(1),
  serverInfo: z.object({ name: z.string(), version: z.string(), title: z.string().optional() }),
  capabilities: z.object({
    tools: z.object({ listChanged: z.boolean().optional() }).optional(),
    tasks: McpTaskCapabilitiesSchema.optional()
  }),
  instructions: z.string().max(100000).optional()
})
export const McpSessionSnapshotSchema = z.object({
  sessionId: z.string().min(1).max(8192).optional(),
  initialization: McpInitializationSchema
})
export type McpSessionSnapshot = z.infer<typeof McpSessionSnapshotSchema>

export const McpRemoteTaskSchema = z.object({
  taskId: z.string().min(1).max(4096),
  status: z.enum(['working', 'input_required', 'completed', 'failed', 'cancelled']),
  statusMessage: z.string().max(20000).optional(),
  createdAt: z.iso.datetime({ offset: true }),
  lastUpdatedAt: z.iso.datetime({ offset: true }),
  ttl: z.number().int().nonnegative().nullable(),
  pollInterval: z.number().int().positive().optional()
})
export type McpRemoteTask = z.infer<typeof McpRemoteTaskSchema>
export const McpTaskPolicySchema = z.object({
  mode: z.enum(['auto', 'off']).default('auto'),
  automatic: z.enum(['required', 'supported']).default('required'),
  pollIntervalMs: z.number().int().min(250).max(300000).default(2000),
  maxPollFailures: z.number().int().min(1).max(20).default(5),
  maxPending: z.number().int().min(1).max(100).default(4)
})
