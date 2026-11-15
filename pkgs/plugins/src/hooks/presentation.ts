import { namedService, serviceRevision } from '@pi-im-bot/integrations/resources'
import { ArtifactStore } from '@pi-im-bot/artifacts/store'
import type { DeliveryPresentation } from '@pi-im-bot/contracts/presentation'
import { revision } from '@pi-im-bot/settings/resolve'
import type { PluginInvocation } from '../invocation'
import type { PluginService } from '../service'
import { pluginHookId, pluginOperationId } from '../identity'
import { type DeliveryPhase } from './points'
import { visibilityNode, textNode, presentationNode } from './points'
import { transformPluginPoint, type PluginHookTrace } from './transform'
import { decidePluginPoint, type HookDispatch } from './dispatch'
import { gsviExecutionRevision } from '@pi-im-bot/integrations/gsvi/identity'
import { inlinePresentation } from './inline-render'

export function pluginPresentation(
  service: PluginService | undefined,
  invocation: PluginInvocation,
  id: string,
  phase: DeliveryPhase,
  signal: AbortSignal,
  report: (trace: PluginHookTrace) => void,
  producer:
    | 'agent-final'
    | 'scheduled-agent'
    | 'background-agent'
    | 'agent-tool'
    | 'plugin'
    | 'control'
    | 'unknown' = 'unknown',
  deferred = false,
  inlineDeadlineAt = Date.now() + 10000
): DeliveryPresentation | undefined {
  if (!service?.available()) {
    return undefined
  }
  const registry = invocation.config.resources.pluginRegistry(invocation.input.context.effective.settings)
  const context = invocation.input.context
  const selector = {
    channel: invocation.room.address.channel,
    origin: invocation.origin ?? invocation.input.source,
    phase
  }
  const used = new Set<string>()
  function plan(point: string) {
    return registry.plan(point, selector).filter((entry) => {
      return context.authority.capabilities.includes(pluginHookId(entry.instanceId, entry.hook.id))
    })
  }
  const visibility = plan(visibilityNode.id)
  const textHandlers = plan(textNode.id)
  const renderers = plan(presentationNode.id)
  const dispatch: HookDispatch = {
    signal,
    report(trace) {
      if (trace.outcome === 'applied') {
        const [instance, handler] = trace.handler.split('/')
        used.add(pluginHookId(instance, handler))
      }
      report(trace)
    },
    async invoke(entry, value, _revision, signal) {
      const capability = pluginHookId(entry.instanceId, entry.hook.id)
      if (!context.authority.capabilities.includes(capability)) {
        throw new Error('处理器未获本次调用授权')
      }
      let input = value
      if (entry.hook.point === presentationNode.id && entry.hook.inspectCapabilities.length > 0) {
        const capabilities = [
          ...new Set(
            entry.hook.inspectCapabilities.map((id) => {
              return id.replace('plugin:self/', 'plugin:' + entry.instanceId + '/')
            })
          )
        ].filter((id) => {
          if (!context.authority.capabilities.includes(id)) {
            return false
          }
          try {
            invocation.services.authorize(id)
            return true
          } catch {
            return false
          }
        })
        input = { ...visibilityNode.input.parse(value), capabilities }
      }
      const result = await service.hook(invocation, registry, entry, input, id + ':' + entry.key, signal)
      return result
    }
  }
  const presentation: DeliveryPresentation = {
    key: revision({
      settings: context.effective.revision,
      resources: context.capabilityRevisions,
      authority: context.authority,
      selector
    }),
    validate(handlers) {
      signal.throwIfAborted()
      for (const capability of handlers) {
        invocation.services.authorize(capability)
      }
    },
    async prepare(text, artifactIds, mixed) {
      signal.throwIfAborted()
      if (visibility.length + textHandlers.length + renderers.length === 0) {
        return { allow: true, text, artifactIds, handlers: [] }
      }
      const deadline = {
        ...dispatch,
        signal: AbortSignal.any([
          signal,
          AbortSignal.timeout(invocation.config.bot.plugins.maxPresentationMs)
        ])
      }
      let content = 'plain'
      if (mixed || artifactIds.length > 0) {
        content = 'mixed'
      }
      const view = visibilityNode.input.parse({
        id,
        roomId: invocation.room.id,
        address: invocation.room.address,
        conversationId: context.conversationId,
        ...selector,
        producer,
        deferred,
        content,
        capabilities: [],
        text,
        artifactIds
      })
      const policy = await decidePluginPoint(visibility, view, visibilityNode.output, deadline, (output) => {
        return !output.allow
      })
      if (policy) {
        return {
          allow: false,
          reason: policy.output.reason ?? '交付被可见性策略隐藏',
          text,
          artifactIds,
          handlers: [...used]
        }
      }
      const transformed = await transformPluginPoint({
        registry,
        point: textNode.id,
        selector,
        handlers: textHandlers,
        value: view,
        schema: textNode.input,
        ...deadline
      })
      const choice = await decidePluginPoint(
        renderers,
        transformed,
        presentationNode.output,
        deadline,
        (value) => {
          return value !== null
        }
      )
      let result = { text: transformed.text, artifactIds: transformed.artifactIds }
      if (choice?.output) {
        if ('render' in choice.output) {
          if (!deferred && producer !== 'agent-tool') {
            return { allow: true, ...result, handlers: [...used] }
          }
          const instanceId = choice.handler.split('/')[0]
          const capability = pluginOperationId(instanceId, choice.output.render.operation)
          const entry = service.operation(invocation, capability)
          if (entry.operation.execution !== 'background' || entry.operation.data !== 'none') {
            throw new Error('异步呈现必须引用本实例无私有数据的后台操作')
          }
          invocation.services.authorize(capability)
          for (const action of entry.operation.actions) {
            invocation.services.authorize(action)
          }
          const services: Record<string, { id: string; revision: string }> = {}
          for (const grant of entry.operation.grants) {
            if (!entry.instance.grants.includes(grant)) {
              return { allow: true, ...result, handlers: [...used] }
            }
            if (grant.startsWith('service:')) {
              const alias = grant.slice(8)
              const serviceId = entry.instance.services[alias]
              const resource = namedService(invocation.config, serviceId)
              if (!resource?.enabled) {
                return { allow: true, ...result, handlers: [...used] }
              }
              services[alias] = { id: serviceId, revision: serviceRevision(resource) }
            }
          }
          const required = [...entry.operation.actions]
          const actions: string[] = required
          if (producer === 'agent-tool') {
            actions.push('chat_send')
            if (deferred) {
              actions.push('chat_present')
            }
          }
          return {
            allow: true,
            ...result,
            handlers: [...used],
            render: {
              capability,
              arguments: choice.output.render.arguments,
              access: {
                capabilities: actions,
                mediaIds: [],
                plugin: {
                  instanceId: instanceId,
                  grants: entry.operation.grants,
                  services
                }
              }
            }
          }
        }
        result = choice.output
      }
      const artifacts = new ArtifactStore(invocation.config.dataDir, invocation.room.id)
      for (const artifact of result.artifactIds) {
        await artifacts.metadata(artifact)
      }
      signal.throwIfAborted()
      return { allow: true, ...result, handlers: [...used] }
    }
  }
  if (!deferred && producer === 'agent-tool') {
    presentation.validateInline = (outbound) => {
      signal.throwIfAborted()
      if (!outbound.render) {
        throw new Error('短时呈现计划不可读取')
      }
      service.validateInlinePresentation(invocation, outbound.render)
    }
    presentation.inline = async (outbound) => {
      if (!outbound.render) {
        throw new Error('短时呈现缺少已保存的计划')
      }
      return inlinePresentation(
        service,
        invocation,
        outbound.render,
        id + ':inline-render',
        signal,
        inlineDeadlineAt
      )
    }
  }
  return presentation
}
