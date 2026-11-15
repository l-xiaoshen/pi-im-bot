import { z } from 'zod'
import { ChatMessageSchema, RoomSchema } from './message'
import { RunSchema, TraceSchema } from './run'
import { ScheduleSchema } from '@pi-im-bot/scheduler/definition'
import { ExecutionStatusSchema } from '@pi-im-bot/execution/config'
import { OneBotStatusSchema, OneBotPublicSettingsSchema } from '@pi-im-bot/channels/onebot/status'
import { ConversationSchema } from '@pi-im-bot/conversations/schema'
import { EffectiveSettingsSchema, FrameworkConfigSchema } from '@pi-im-bot/settings/schema'
import { OutboundSchema } from './delivery'
import { JobSummarySchema } from '@pi-im-bot/jobs/schema'

export const FrameworkEditorSchema = z.object({
  version: z.string(),
  config: FrameworkConfigSchema,
  capabilities: z.array(
    z.object({ id: z.string(), name: z.string(), kind: z.enum(['tool', 'command', 'hook', 'action']) })
  )
})
export type FrameworkEditorState = z.infer<typeof FrameworkEditorSchema>

export const ProviderStatusSchema = z.object({
  defaultGroup: z.string(),
  groups: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      ready: z.boolean(),
      cooldownMs: z.number(),
      candidates: z.array(z.object({ provider: z.string(), model: z.string() }))
    })
  ),
  providers: z.array(
    z.object({
      id: z.string(),
      enabled: z.boolean(),
      protocol: z.string(),
      models: z.array(z.string()),
      headerNames: z.array(z.string()),
      bodyFields: z.array(z.string())
    })
  ),
  health: z.record(
    z.string(),
    z.object({ failures: z.number(), retryAt: z.number(), lastError: z.string().optional() })
  )
})
export const SnapshotSchema = z.object({
  version: z.string(),
  execution: ExecutionStatusSchema,
  agentRuntime: z.string(),
  rooms: z.array(RoomSchema),
  runs: z.array(RunSchema),
  schedules: z.array(ScheduleSchema),
  jobs: z.array(JobSummarySchema).default([]),
  providers: ProviderStatusSchema,
  onebot: OneBotStatusSchema,
  onebotSettings: OneBotPublicSettingsSchema,
  configFiles: z.object({ bot: z.string(), providers: z.string(), framework: z.string() })
})
export type Snapshot = z.infer<typeof SnapshotSchema>
export const RoomDetailSchema = z.object({
  room: RoomSchema,
  messages: z.array(ChatMessageSchema),
  runs: z.array(RunSchema),
  traces: z.array(TraceSchema),
  outbound: z.array(OutboundSchema).default([]),
  conversations: z.array(ConversationSchema),
  effective: EffectiveSettingsSchema
})
export type RoomDetail = z.infer<typeof RoomDetailSchema>
