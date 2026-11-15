import type { Configuration } from '@pi-im-bot/config/load'
import type { Room } from '@pi-im-bot/contracts/message'
import type { PreparedRunInput } from '@pi-im-bot/contracts/run'
import type { HostToolServices } from '@pi-im-bot/agent/host-tools'
import type { PluginOperationEntry, PluginBinding } from './registry'
import { pluginOperationId, pluginToolName } from './identity'
import { revision } from '@pi-im-bot/settings/resolve'
import { PluginInvocationViewSchema, type PluginInvocationView } from './rpc/protocol'
import { mergeConfig, validateConfig } from './configuration/values'
import {
  gsviWorkerDefinition,
  gsviBusinessValues
} from '@pi-im-bot/integrations/gsvi/plugin-config/definition'

export interface PluginInvocation {
  deadlineAt?: number
  readOnly?: boolean
  origin?: PluginInvocationView['origin']
  config: Configuration
  room: Room
  input: PreparedRunInput
  services: Pick<
    HostToolServices,
    'authorize' | 'history' | 'send' | 'assertActive' | 'recall' | 'mediaSources'
  > & {
    media?: {
      content: NonNullable<HostToolServices['media']>['content']
      require(id: string): unknown
    }
  }
}

export function pluginOperations(config: Configuration, input: PreparedRunInput): PluginOperationEntry[] {
  return config.resources.plugins(input.context.effective.settings).flatMap((binding) => {
    return binding.bundle.manifest.operations.map((operation) => {
      return {
        ...binding,
        operation,
        capabilityId: pluginOperationId(binding.instance.id, operation.id),
        modelName: pluginToolName(binding.instance.id, operation.id)
      }
    })
  })
}

export function pluginInvocationView(
  invocation: PluginInvocation,
  binding: PluginBinding,
  input: unknown,
  grants: string[],
  timeoutMs: number,
  callId: string
) {
  const context = invocation.input.context
  const settings = mergeConfig(
    binding.instance.settings,
    context.effective.settings.extensions.settings[binding.instance.id] ?? {},
    binding.bundle.configuration
  )
  if (binding.bundle.configuration) {
    validateConfig(gsviWorkerDefinition(binding.bundle) ?? {}, gsviBusinessValues(binding.bundle, settings))
  }
  return PluginInvocationViewSchema.parse({
    id: crypto.randomUUID(),
    parentId: callId,
    instanceId: binding.instance.id,
    generation: binding.bundle.revision,
    scope: { id: invocation.room.id, address: invocation.room.address },
    conversationId: context.conversationId,
    conversationEpoch: context.conversationEpoch,
    origin: invocation.origin ?? invocation.input.source,
    actors: context.authority.identities.map((identity) => {
      return { id: identity.actorId, name: identity.actorName, origin: identity.origin, role: identity.role }
    }),
    settings: gsviBusinessValues(binding.bundle, settings),
    inputRevision: revision(input),
    grants,
    deadlineAt: Date.now() + timeoutMs
  })
}
