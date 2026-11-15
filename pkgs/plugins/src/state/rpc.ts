import { z } from 'zod'
import type { PluginHostServices } from '../rpc/services'
import type { PluginInvocation } from '../invocation'
import type { PluginBinding } from '../registry'
import type { PluginManagedServices } from '../managed'
import { StateKeySchema, StateCompareSchema } from './store'
export function registerPluginState(
  host: PluginHostServices,
  invocation: PluginInvocation,
  binding: PluginBinding,
  managed: PluginManagedServices | undefined,
  authorizeGrant: (grant: string) => void
) {
  host.register('state.read', 'state.read', StateKeySchema, async (input) => {
    if (!managed) {
      throw new Error('受管状态未配置')
    }
    return managed.state.read(binding.instance.id, invocation.room.id, input)
  })
  host.register('state.compare', 'state.write', StateCompareSchema, async (input, context) => {
    if (!managed || invocation.readOnly) {
      throw new Error('此上下文不可修改受管状态')
    }
    const ref = input.comfyReceipt
    let record: Parameters<typeof managed.state.compare>[4]
    if (ref) {
      if (
        input.area !== 'scope' ||
        input.key !== 'comfy.records' ||
        !invocation.input.context.jobId ||
        !invocation.input.context.jobRevision
      ) {
        throw new Error('回执登记必须属于本Job的comfy.records范围状态')
      }
      authorizeGrant('service:' + ref.alias)
      const owner = {
        instance: binding.instance.id,
        room: invocation.room.id,
        job: invocation.input.context.jobId,
        revision: invocation.input.context.jobRevision
      }
      record = (tx) => {
        return managed.comfy.record(tx, owner, ref.alias, ref.item)
      }
    }
    return managed.state.compare(
      binding.instance.id,
      invocation.room.id,
      input,
      () => {
        context.signal.throwIfAborted()
        authorizeGrant('state.write')
      },
      record
    )
  })
  host.register(
    'authorization.inspect',
    'authorization.inspect',
    z
      .object({ capabilities: z.array(z.enum(['comfy_manage', 'comfy_generate', 'comfy_catalog'])).max(3) })
      .strict(),
    async (input) => {
      return {
        allowed: input.capabilities.filter((capability) => {
          try {
            invocation.services.authorize(capability)
            return true
          } catch {
            return false
          }
        })
      }
    }
  )
}
