import { z } from 'zod'
import type { PluginBinding } from './registry'
import type { PluginInvocation } from './invocation'
import type { PluginService } from './service'
import { pluginHookId } from './identity'
import { revision } from '@pi-im-bot/settings/resolve'
import { applyHookPatch } from './hooks/patch'
import { collectPluginPoint, decidePluginPoint, type HookDispatch } from './hooks/dispatch'
import { VisibilityDecisionSchema } from './hooks/points'
import type { PluginHostServices } from './rpc/services'

const PointInputSchema = z.object({ value: z.record(z.string(), z.json()) }).strict()
const JsonValueSchema = z.json()
interface PointContribution {
  source: string
  value: z.infer<typeof JsonValueSchema>
}

export function registerPluginPoints(
  host: PluginHostServices,
  grants: readonly string[],
  invoke: (
    grant: string,
    value: z.infer<typeof PointInputSchema>['value'],
    sequence: number,
    signal: AbortSignal
  ) => Promise<unknown>
) {
  let sequence = 0
  for (const grant of new Set(grants)) {
    if (!grant.startsWith('point:')) {
      continue
    }
    host.register(grant, grant, PointInputSchema, async (input, context) => {
      sequence += 1
      return invoke(grant, input.value, sequence, context.signal)
    })
  }
}

export async function executePluginPoint(
  service: PluginService,
  invocation: PluginInvocation,
  caller: PluginBinding,
  name: string,
  value: z.infer<typeof PointInputSchema>['value'],
  callId: string,
  parentSignal: AbortSignal
) {
  if (invocation.readOnly) {
    throw new Error('只读切入点不能再次启动插件流程')
  }
  const registry = invocation.config.resources.pluginRegistry(invocation.input.context.effective.settings)
  const id = registry.pointId(caller.instance, name)
  const point = registry.points.get(id)
  if (
    !point?.owner ||
    !point.definition ||
    point.owner.instance.id !== caller.instance.id ||
    point.owner.bundle.revision !== caller.bundle.revision
  ) {
    throw new Error('插件只能从自己的操作发布自定义切入点；其他插件应调用公开 operation')
  }
  const limits = invocation.config.bot.plugins
  const signal = AbortSignal.any([parentSignal, AbortSignal.timeout(limits.maxPointMs)])
  if (Buffer.byteLength(JSON.stringify(value)) > limits.maxPointBytes) {
    throw new Error('自定义切入点输入超过预算')
  }
  const owner = point.owner
  const definition = point.definition
  const used = new Set<string>()
  function completed<T>(output: T) {
    signal.throwIfAborted()
    for (const capability of used) {
      invocation.services.authorize(capability)
    }
    return output
  }
  await service.validatePoint(invocation, owner, definition.id, value, 'input', signal)
  const selected = registry
    .plan(id, {
      channel: invocation.room.address.channel,
      origin: invocation.origin ?? invocation.input.source
    })
    .filter((entry) => {
      return invocation.input.context.authority.capabilities.includes(
        pluginHookId(entry.instanceId, entry.hook.id)
      )
    })
  if (selected.length > limits.maxPointHandlers) {
    throw new Error('自定义切入点处理器数量超过预算')
  }
  const validate = async (output: unknown) => {
    if (Buffer.byteLength(JSON.stringify(output)) > limits.maxPointBytes) {
      throw new Error('自定义切入点结果超过预算')
    }
    await service.validatePoint(invocation, owner, definition.id, output, 'output', signal)
  }
  const dispatch: HookDispatch = {
    signal,
    report() {},
    async invoke(entry, input, _revision, signal) {
      const output = await service.hook(invocation, registry, entry, input, callId + ':' + entry.key, signal)
      if (point.mode !== 'transform' && point.mode !== 'observe' && output !== null) {
        await validate(output)
      }
      used.add(pluginHookId(entry.instanceId, entry.hook.id))
      return output
    }
  }
  if (point.mode === 'observe') {
    const eventId = service.observePoint?.(invocation, id, callId, value)
    if (!eventId) {
      return { accepted: false }
    }
    return { accepted: true, eventId }
  }
  if (point.mode === 'transform') {
    let output: unknown = structuredClone(value)
    const successful = new Set<string>()
    for (const entry of selected) {
      try {
        signal.throwIfAborted()
        if (
          entry.hook.requires.some((key) => {
            return !successful.has(key)
          })
        ) {
          throw new Error('自定义变换缺少必需处理器')
        }
        const patch = await service.hook(
          invocation,
          registry,
          entry,
          output,
          callId + ':' + entry.key,
          signal
        )
        const next = applyHookPatch(output, patch, entry.hook.writes ?? point.writable)
        await validate(next)
        output = next
        used.add(pluginHookId(entry.instanceId, entry.hook.id))
        successful.add(entry.key)
      } catch (error) {
        signal.throwIfAborted()
        if (entry.hook.onError === 'fail') {
          throw error
        }
      }
    }
    await validate(output)
    return completed(output)
  }
  if (point.mode === 'collect') {
    const results = await collectPluginPoint(
      selected,
      value,
      JsonValueSchema,
      dispatch,
      limits.maxHookConcurrency
    )
    const contributions: PointContribution[] = []
    let omitted = 0
    for (const result of results) {
      const candidate = { source: result.handler, value: result.output }
      if (Buffer.byteLength(JSON.stringify([...contributions, candidate])) > limits.maxPointBytes - 100) {
        omitted += 1
        continue
      }
      contributions.push(candidate)
    }
    return completed({ contributions, omitted })
  }
  if (point.mode === 'policy') {
    const deny = await decidePluginPoint(selected, value, VisibilityDecisionSchema, dispatch, (decision) => {
      return !decision.allow
    })
    if (deny) {
      return completed(deny.output)
    }
    const result = { allow: true }
    await validate(result)
    return completed(result)
  }
  const choice = await decidePluginPoint(selected, value, JsonValueSchema, dispatch, (output) => {
    return output !== null
  })
  if (point.mode === 'exclusive' && !choice) {
    throw new Error('独占切入点没有可用处理器')
  }
  return completed(choice?.output ?? null)
}
