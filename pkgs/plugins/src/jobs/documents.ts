import { defineDocFamily } from '@earendil-works/pi-durable'
import { z } from 'zod'

export const PluginExecutionSchema = z.object({
  instanceId: z.string(),
  generation: z.string(),
  handle: z.json().optional(),
  failures: z.number().int().nonnegative().default(0),
  cancelDispatched: z.boolean().default(false)
})
export type PluginExecution = z.infer<typeof PluginExecutionSchema>
// Opaque service handles may carry credentials. Only the receipt flag is public.
export const PluginExecutions = defineDocFamily<{ value: PluginExecution | null }, null>({
  kind: 'bot.plugin-execution',
  version: 1,
  scope: 'session',
  family: true,
  initial: () => ({ value: null }),
  checkpointWhen: () => false
})
