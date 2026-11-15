import { z } from 'zod'
import { ExecutionConfigSchema } from '@pi-im-bot/execution/config'
import { OneBotConfigSchema } from '@pi-im-bot/channels/onebot/config'
import { PluginRuntimeSchema } from '@pi-im-bot/plugins/runtime/config'
import { ArtifactLimitsSchema } from '@pi-im-bot/artifacts/limits'

export const BotConfigSchema = z.object({
  server: z
    .object({
      host: z.string().default('0.0.0.0'),
      port: z.number().int().min(1).max(65535).default(19335)
    })
    .prefault({}),
  agent: z
    .object({
      maxConcurrentRuns: z.number().int().min(1).max(16).default(2),
      maxQueuedRuns: z.number().int().min(1).max(500).default(50),
      maxOutstandingJobs: z.number().int().min(1).max(1000).default(128),
      maxModelCalls: z.number().int().min(1).max(100).default(20),
      timeoutMs: z.number().int().min(1000).default(600000),
      systemPrompt: z
        .string()
        .default(
          '你是通过即时通讯协助用户工作的智能助手。善用工具完成任务，保持简洁，准确区分工具事实与推测。'
        ),
      execution: ExecutionConfigSchema
    })
    .prefault({}),
  onebot: OneBotConfigSchema,
  plugins: PluginRuntimeSchema,
  artifacts: ArtifactLimitsSchema
})
export type BotConfig = z.infer<typeof BotConfigSchema>
