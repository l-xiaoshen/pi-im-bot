import { z } from 'zod'
import type { PluginHostServices } from './rpc/services'
import { PluginArgumentsSchema } from './result'

export const PluginOperationCallSchema = z
  .object({
    arguments: PluginArgumentsSchema,
    phase: z.enum(['execute', 'poll', 'cancel']).default('execute')
  })
  .strict()

export function registerPluginOperations(
  host: PluginHostServices,
  declared: readonly string[],
  invoke: (
    grant: string,
    input: z.infer<typeof PluginOperationCallSchema>,
    signal: AbortSignal
  ) => Promise<unknown>
) {
  for (const grant of new Set(declared)) {
    if (!grant.startsWith('operation:')) {
      continue
    }
    host.register(grant, grant, PluginOperationCallSchema, async (input, context) => {
      return invoke(grant, input, context.signal)
    })
  }
}
