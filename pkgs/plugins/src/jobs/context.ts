import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import type { JobService } from '@pi-im-bot/jobs/service'
import type { JobTaskInput } from '@pi-im-bot/jobs/task'
import type { JobWorker } from '@pi-im-bot/jobs/worker'
import { externalKey } from '@pi-im-bot/jobs/external/documents'
import { PluginExecutions, PluginExecutionSchema, type PluginExecution } from './documents'
import { projectHistory } from '@pi-im-bot/messages/projection'
import type { PluginInvocation } from '../invocation'
import type { Tx } from '@earendil-works/pi-durable'

export type CreateJobInvocation = JobWorker['invocation']

export async function pluginJobContext(
  service: JobService,
  create: CreateJobInvocation,
  input: JobTaskInput,
  retained = false
) {
  const job = await service.repository.get(input.jobId)
  const value = job.revisions[String(input.revision)]
  if (!value || value.spec.kind !== 'tool' || !value.spec.capability.startsWith('plugin:')) {
    throw new Error('此任务不属于插件操作')
  }
  const plugins = service.coordinator.plugins
  if (!plugins) {
    throw new Error('插件运行时未启用')
  }
  if (!value.nativeTaskId) {
    throw new Error('插件任务缺少持久任务标识')
  }
  const prepared = await create(job, value, value.nativeTaskId)
  const invocation: PluginInvocation = {
    ...prepared,
    deadlineAt: value.deadlineAt,
    services: {
      media: service.coordinator.pluginMedia(prepared.room),
      authorize(capability) {
        if (value.presentation) {
          const outbound = service.coordinator.store.getOutbound(value.presentation.outboundId)
          if (!outbound || outbound.cancelRequested || outbound.state !== 'rendering') {
            throw new Error('呈现计划已停止或不在执行阶段')
          }
          service.coordinator.validateRender(outbound)
          for (const handler of outbound.presentationHandlers) {
            service.coordinator.authorizeRetainedContext(
              job.roomId,
              value.mode,
              prepared.input.context,
              handler
            )
          }
        }
        if (retained) {
          return service.coordinator.authorizeRetainedContext(
            job.roomId,
            value.mode,
            prepared.input.context,
            capability
          )
        }
        service.coordinator.authorizeContext(job.roomId, value.mode, prepared.input.context, capability)
      },
      history(limit) {
        return projectHistory(
          service.coordinator.store.listMessages(job.roomId, limit),
          prepared.input.context.effective.settings
        )
      },
      async send() {
        throw new Error('后台插件不直接发送群消息，由 Job 统一交付')
      }
    }
  }
  const entry = plugins.operation(invocation, value.spec.capability)
  const key = externalKey(job.id, value.revision)
  const stored = await service.runtime.native.snapshot(PluginExecutions, key, BACKGROUND_CONTEXT)
  let execution: PluginExecution = {
    instanceId: entry.instance.id,
    generation: entry.bundle.revision,
    failures: 0,
    cancelDispatched: false
  }
  if (stored?.value) {
    execution = PluginExecutionSchema.parse(stored.value)
  }
  if (execution.instanceId !== entry.instance.id || execution.generation !== entry.bundle.revision) {
    throw new Error('插件任务回执与固定代码版本不匹配')
  }
  return { job, value, spec: value.spec, plugins, invocation, entry, key, execution }
}
export type PluginJobContext = Awaited<ReturnType<typeof pluginJobContext>>

export async function savePluginExecution(tx: Tx, key: string, execution: PluginExecution) {
  const document = await tx.doc(PluginExecutions, key, null)
  document.value = PluginExecutionSchema.parse(execution)
}

export function pluginJobError(error: unknown, execution: PluginExecution) {
  let message = String(error)
  function redact(value: unknown) {
    if (typeof value === 'string' && value) {
      message = message.replaceAll(value, '[task-handle]')
    } else if (Array.isArray(value)) {
      for (const item of value) {
        redact(item)
      }
    } else if (value !== null && typeof value === 'object') {
      for (const item of Object.values(value)) {
        redact(item)
      }
    }
  }
  redact(execution.handle)
  return message.slice(0, 2000)
}
