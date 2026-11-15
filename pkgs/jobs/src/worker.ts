import { mergeExternalOutcome } from './external/outcome'
import { z } from 'zod'
import { BACKGROUND_CONTEXT, type Context } from '@earendil-works/chord/context'
import type { JobService } from './service'
import type { ActiveJobTask, JobTaskRuntime } from './task'
import { jobTerminal, type Job, type JobRevision } from './schema'
import { JobFacts } from './documents'
import { createToolkit } from '@pi-im-bot/agent/toolkit'
import { projectHistory } from '@pi-im-bot/messages/projection'
import { freezeSnapshot } from '@pi-im-bot/runtime/snapshot'
import { revision as settingsRevision } from '@pi-im-bot/settings/resolve'
import { captureAuthority } from '@pi-im-bot/permissions/authorize'
import type { PreparedRunInput, Trace } from '@pi-im-bot/contracts/run'
import { ArtifactStore } from '@pi-im-bot/artifacts/store'
import { DeliveryUncertain, DeliveryCancelled } from '@pi-im-bot/runtime/delivery'
import { releaseExternal } from './external/state'
import { externalKey } from './external/documents'
import { cancelExternal } from './external/cancel'
import { releaseSchedule } from '@pi-im-bot/scheduler/occurrences'
import { DeliveryDeferred } from '@pi-im-bot/contracts/rendering'
import { finishPresentation, suppressPresentation, presentationDelivery } from './presentation'

const ChildForbidden = new Set([
  'delegate_task',
  'job_update',
  'chat_send',
  'chat_present',
  'schedule_create',
  'schedule_delete',
  'command:new',
  'command:stop'
])
const ArtifactDetailsSchema = z.object({
  summary: z.string().optional(),
  artifactId: z.string().optional(),
  artifactIds: z.array(z.string()).optional()
})

export class JobWorker {
  constructor(private readonly service: JobService) {}

  async invocation(job: Job, value: JobRevision, nativeTaskId: number) {
    const coordinator = this.service.coordinator
    const config = await coordinator.loadConfigurationSnapshot(value.configSnapshot)
    const room = { ...coordinator.requireRoom(job.roomId), mode: value.mode }
    coordinator.checkContext(job.roomId, value.mode, value.context)
    const scheduledEntry = Boolean(value.schedule?.entry)
    const shared = Boolean(value.presentation) || (scheduledEntry && value.schedule?.isolated === false)
    let conversationId = value.childConversationId
    let sessionKey = value.childConversationId
    let workspaceScope = `job:${job.id}:revision:${value.revision}`
    if (shared) {
      conversationId = value.context.rootConversationId
      sessionKey = value.context.sessionKey
      workspaceScope = room.id
    } else {
      coordinator.conversations.ensureChild(
        room,
        value.childConversationId,
        value.title,
        value.context.rootConversationId
      )
      if (scheduledEntry) {
        workspaceScope = 'schedule:' + value.schedule!.id
      }
    }
    const effective = structuredClone(value.context.effective)
    if (!scheduledEntry) {
      effective.settings.behavior.allowProactive = false
      effective.sources['behavior.allowProactive'] = '后台任务'
    }
    effective.settings.behavior.timeoutMs = Math.min(
      3600000,
      Math.max(1000, value.deadlineAt - value.createdAt)
    )
    effective.sources['behavior.timeoutMs'] = '后台任务'
    effective.revision = settingsRevision({ settings: effective.settings, persona: effective.persona })
    const ceiling = value.context.authority.capabilities.filter((id) => {
      return scheduledEntry || !ChildForbidden.has(id)
    })
    const authority = captureAuthority(
      effective,
      value.context.authority.identities,
      ceiling,
      config.resources.capabilityIds(effective.settings)
    )
    const context = {
      ...value.context,
      effective,
      authority,
      conversationId,
      sessionKey,
      workspaceScope,
      jobId: job.id,
      jobRevision: value.revision,
      nativeOwnerTask: nativeTaskId
    }
    let text = value.title
    if (value.spec.kind === 'agent') {
      text = value.spec.prompt
    }
    const actor = authority.identities[0]
    let source: PreparedRunInput['source'] = 'job'
    let scheduled: PreparedRunInput['scheduled']
    if (scheduledEntry) {
      source = 'schedule'
      scheduled = {
        id: value.schedule!.id,
        name: value.title,
        at: value.schedule!.scheduledAt,
        timezone: value.schedule!.timezone
      }
    }
    const input: PreparedRunInput = freezeSnapshot({
      roomId: job.roomId,
      text,
      actorId: actor.actorId,
      actorName: actor.actorName,
      source,
      scheduled,
      receivedAt: value.createdAt,
      identities: authority.identities,
      inheritedAuthority: authority,
      conversationId,
      context
    })
    return { config, room, input }
  }

  async work(task: ActiveJobTask, runtime: JobTaskRuntime, context: Context) {
    const { jobId, revision } = task.input
    const repository = this.service.repository
    const job = await repository.get(jobId)
    const value = job.revisions[String(revision)]
    if (!value) {
      return this.finish(task, runtime, context)
    }
    if (job.currentRevision !== revision || value.cancelRequested) {
      return this.abort(task, runtime, context)
    }
    let operationStarted = false
    try {
      if (Date.now() >= value.deadlineAt) {
        throw new Error('后台任务已超过执行期限')
      }
      await runtime.commit(async (tx) => {
        await repository.change(tx, jobId, revision, (value) => {
          value.state = 'running'
          value.startedAt ??= Date.now()
        })
        return undefined
      }, context)
      this.service.changed(await repository.get(jobId))
      const invocation = await this.invocation(job, value, task.id)
      if (this.service.plugins.supports(value)) {
        await this.service.plugins.start(task, runtime, context)
        return
      }
      if (this.service.external.supports(invocation.config, value)) {
        await this.service.external.start(task, runtime, context)
        return
      }
      let summary = ''
      let artifactIds: string[] = []
      let error: string | undefined
      if (value.spec.kind === 'agent') {
        if (!value.runId) {
          throw new Error('后台 Agent 缺少执行标识')
        }
        const coordinator = this.service.coordinator
        coordinator.enqueuePinned(
          value.runId,
          invocation.config,
          invocation.room,
          invocation.input,
          value.configSnapshot,
          value.deadlineAt
        )
        const result = await coordinator.waitRun(value.runId, runtime.signal)
        if (result.status !== 'completed') {
          error = result.error ?? result.status
        }
        summary = result.rawReply ?? ''
        const artifacts = await new ArtifactStore(invocation.config.dataDir, job.roomId).owned(
          `job:${jobId}:${revision}`
        )
        artifactIds = artifacts.map((artifact) => {
          return artifact.id
        })
      } else {
        await runtime.commit(async (tx) => {
          await repository.change(tx, jobId, revision, (value) => {
            value.state = 'waiting_external'
          })
          return { status: 'running', checkpoint: { phase: 'dispatching' } }
        }, context)
        this.service.changed(await repository.get(jobId))
        const controller = new AbortController()
        const timeout = setTimeout(
          () => {
            controller.abort(new Error('后台操作超过期限'))
          },
          Math.max(0, value.deadlineAt - Date.now())
        )
        const signal = AbortSignal.any([runtime.signal, controller.signal])
        const coordinator = this.service.coordinator
        const trace = (event: Omit<Trace, 'id' | 'at' | 'roomId' | 'runId'>) => {
          const item: Trace = {
            ...event,
            id: crypto.randomUUID(),
            at: Date.now(),
            roomId: job.roomId,
            runId: 'job:' + jobId + ':' + revision
          }
          coordinator.store.saveTrace(item)
          coordinator.events.emit({ type: 'trace', trace: item })
        }
        const toolkit = createToolkit(
          invocation.config,
          invocation.room,
          invocation.input,
          signal,
          {
            plugins: coordinator.plugins,
            history(limit) {
              return projectHistory(
                coordinator.store.listMessages(job.roomId, limit),
                invocation.input.context.effective.settings
              )
            },
            async send() {
              throw new Error('后台操作不直接发送群消息')
            },
            authorize(capability) {
              signal.throwIfAborted()
              coordinator.authorizeContext(job.roomId, value.mode, invocation.input.context, capability)
            }
          },
          { trace, provider() {}, preview() {}, tool() {} }
        )
        try {
          const capability = value.spec.capability
          const tool = toolkit.tools.find((tool) => {
            return toolkit.capabilityFor(tool.name) === capability
          })
          if (!tool) {
            throw new Error('后台操作能力未装载或已停用')
          }
          coordinator.authorizeContext(job.roomId, value.mode, invocation.input.context, capability)
          trace({ kind: 'tool', title: '后台调用 ' + tool.name, detail: '' })
          operationStarted = true
          const result = await tool.execute(
            `job:${jobId}:${revision}`,
            value.spec.arguments,
            signal,
            undefined
          )
          signal.throwIfAborted()
          summary = result.content
            .filter((part) => {
              return part.type === 'text'
            })
            .map((part) => {
              return part.text
            })
            .join('\n')
          const details = ArtifactDetailsSchema.safeParse(result.details)
          if (details.success) {
            summary = details.data.summary ?? summary
            artifactIds = details.data.artifactIds ?? []
            if (details.data.artifactId) {
              artifactIds.push(details.data.artifactId)
            }
          }
          const artifacts = new ArtifactStore(invocation.config.dataDir, job.roomId)
          if (summary.length > 12000) {
            const artifact = await artifacts.save(value.title + '.txt', 'text/plain', 'job:' + jobId, summary)
            artifactIds.push(artifact.id)
            summary = summary.slice(0, 12000)
          }
          if (result.isError) {
            error = summary || '外部操作失败'
          }
        } finally {
          clearTimeout(timeout)
          await toolkit.close()
        }
      }
      await runtime.commit(async (tx) => {
        await repository.change(tx, jobId, revision, (value) => {
          value.result = { summary, artifactIds: [...new Set(artifactIds)] }
          value.finishedAt = Date.now()
          value.state = 'succeeded'
          if (error) {
            value.state = 'failed'
            value.error = error
          }
        })
        return { status: 'running', checkpoint: { phase: 'report' } }
      }, context)
      this.service.changed(await repository.get(jobId))
    } catch (error) {
      if (runtime.signal.aborted) {
        throw error
      }
      await runtime.commit(async (tx) => {
        await repository.change(tx, jobId, revision, (value) => {
          value.state = 'failed'
          if (operationStarted) {
            value.state = 'outcome_unknown'
          }
          value.error = String(error).slice(0, 2000)
          value.finishedAt = Date.now()
        })
        return { status: 'running', checkpoint: { phase: 'report' } }
      }, context)
      this.service.changed(await repository.get(jobId))
    }
  }

  async unknown(task: ActiveJobTask, runtime: JobTaskRuntime, context: Context) {
    if (await this.service.plugins.recover(task, runtime, context)) {
      return
    }
    await runtime.commit(async (tx) => {
      await releaseExternal(tx, externalKey(task.input.jobId, task.input.revision))
      await this.service.repository.change(tx, task.input.jobId, task.input.revision, (value) => {
        value.state = 'outcome_unknown'
        value.error = '服务在外部操作期间中断，执行结果未知，未自动重试'
        value.finishedAt = Date.now()
      })
      return { status: 'running', checkpoint: { phase: 'report' } }
    }, context)
    this.service.changed(await this.service.repository.get(task.input.jobId))
  }

  async report(task: ActiveJobTask, runtime: JobTaskRuntime, context: Context) {
    const { jobId, revision } = task.input
    const job = await this.service.repository.get(jobId)
    const value = job.revisions[String(revision)]
    if (!value) {
      return this.finish(task, runtime, context)
    }
    if (value.delivery === 'none') {
      return this.finish(task, runtime, context)
    }
    let suppressed = job.currentRevision !== revision || value.cancelRequested
    const originalConfig = await this.service.coordinator.loadConfigurationSnapshot(value.configSnapshot)
    const assertDelivery = () => {
      for (const action of value.requiredActions) {
        this.service.coordinator.authorizeRetainedContext(job.roomId, value.mode, value.context, action)
      }
      this.service.coordinator.checkContext(job.roomId, value.mode, value.context)
      if (value.spec.kind === 'tool') {
        if (value.spec.capability.startsWith('plugin:')) {
          this.service.coordinator.plugins?.validateDelivery(
            originalConfig,
            value.context.effective.settings,
            value.spec.capability
          )
        }
        this.service.coordinator.authorizeRetainedContext(
          job.roomId,
          value.mode,
          value.context,
          value.spec.capability
        )
      }
      if (value.presentation) {
        const outbound = this.service.coordinator.store.getOutbound(value.presentation.outboundId)
        if (!outbound) {
          throw new Error('呈现计划缺失')
        }
        this.service.coordinator.validateRender(outbound)
        for (const handler of outbound?.presentationHandlers ?? []) {
          this.service.coordinator.authorizeRetainedContext(job.roomId, value.mode, value.context, handler)
        }
      }
    }
    try {
      assertDelivery()
    } catch {
      suppressed = true
    }
    if (suppressed) {
      suppressPresentation(this.service, value)
      await this.service.recordPresentationDelivery(job, value, 'suppressed')
      await runtime.commit(async (tx) => {
        await this.service.repository.change(tx, jobId, revision, (value) => {
          value.delivery = 'suppressed'
        })
        await releaseSchedule(tx, value.schedule, jobId)
        return { status: 'terminal', outcome: { status: 'completed', result: { jobId, revision } } }
      }, context)
      this.service.changed(await this.service.repository.get(jobId))
      return
    }
    const parent = this.service.coordinator.store.getRun(value.sourceRunId)
    if (parent && ['batching', 'queued', 'running'].includes(parent.status)) {
      await runtime.sleepUntil(Date.now() + 100, { phase: 'report' }, context)
      return
    }
    if (value.presentation?.parentJobId) {
      const parentJob = await this.service.repository.get(value.presentation.parentJobId)
      const parentValue = parentJob.revisions[String(value.presentation.parentJobRevision)]
      if (parentValue?.delivery === 'pending' && !parentValue.cancelRequested) {
        await runtime.sleepUntil(Date.now() + 100, { phase: 'report' }, context)
        return
      }
    }
    let text = `任务「${value.title}」`
    if (value.state === 'succeeded') {
      text += '完成。\n' + (value.result?.summary ?? '')
    } else {
      text += '未完成：' + (value.error ?? value.state)
      if (value.result?.summary && value.result.summary !== value.error) {
        text += '\n' + value.result.summary
      }
    }
    if (!value.result?.itemized && (value.result?.artifactIds.length ?? 0) > 8) {
      text += '\n更多产物可在 Web 任务页下载。'
    }
    let delivery: JobRevision['delivery'] = 'sent'
    let deliveryError: string | undefined
    const beforePart = async () => {
      runtime.signal.throwIfAborted()
      const latest = await this.service.repository.get(jobId)
      if (latest.currentRevision !== revision || latest.revisions[String(revision)].cancelRequested) {
        throw new Error('本任务版本已停止交付')
      }
      assertDelivery()
    }
    try {
      const invocation = await this.invocation(job, value, task.id)
      if (value.presentation) {
        await finishPresentation(this.service, job, value, beforePart)
      } else {
        let producer: 'plugin' | 'scheduled-agent' | 'background-agent' = 'plugin'
        if (value.spec.kind === 'agent') {
          producer = 'background-agent'
          if (value.schedule?.entry) {
            producer = 'scheduled-agent'
          }
        }
        await this.service.coordinator.delivery.send(
          this.service.coordinator.requireRoom(job.roomId),
          text,
          value.runId,
          'assistant',
          `job:${jobId}:${revision}:result`,
          {
            artifactIds: value.result?.artifactIds,
            format: value.result?.format,
            itemized: value.result?.itemized,
            authorize: (capability) => {
              this.service.coordinator.authorizeRetainedContext(
                job.roomId,
                value.mode,
                value.context,
                capability
              )
            },
            beforePart,
            presentation: this.service.coordinator.presentation(
              invocation.config,
              invocation.room,
              invocation.input,
              `job:${jobId}:${revision}:result`,
              'notification',
              runtime.signal,
              undefined,
              producer,
              value.spec.kind === 'agent'
            )
          }
        )
      }
    } catch (error) {
      deliveryError = this.service.coordinator.publicError(error)
      delivery = 'unknown'
      if (error instanceof DeliveryDeferred) {
        delivery = 'accepted'
      } else {
        if (!(error instanceof DeliveryUncertain)) {
          delivery = 'suppressed'
        }
      }
      if (error instanceof DeliveryCancelled) {
        let id = `job:${jobId}:${revision}:result`
        if (value.presentation) {
          id = value.presentation.outboundId
        }
        const outbound = this.service.coordinator.store.getOutbound(id)
        if (outbound?.platformMessageIds.length) {
          delivery = 'partial'
        }
      }
    }
    if (delivery === 'suppressed') {
      suppressPresentation(this.service, value)
    }
    await this.service.recordPresentationDelivery(job, value, delivery)
    await runtime.commit(async (tx) => {
      await this.service.repository.change(tx, jobId, revision, (value) => {
        value.delivery = delivery
        value.deliveryError = deliveryError
      })
      await releaseSchedule(tx, value.schedule, jobId)
      const facts = await tx.doc(JobFacts, runtime.conversationId)
      facts.results = [
        ...facts.results.filter((fact) => {
          return fact.id !== jobId
        }),
        {
          id: jobId,
          revision,
          title: value.title,
          summary: (value.result?.summary ?? value.error ?? value.state).slice(0, 800),
          delivery,
          artifactIds: value.result?.artifactIds ?? []
        }
      ].slice(-8)
      return { status: 'terminal', outcome: { status: 'completed', result: { jobId, revision } } }
    }, context)
    this.service.changed(await this.service.repository.get(jobId))
  }

  async abort(task: ActiveJobTask, runtime: JobTaskRuntime, context: Context) {
    const job = await this.service.repository.get(task.input.jobId)
    const value = job.revisions[String(task.input.revision)]
    if (value?.presentation) {
      suppressPresentation(this.service, value)
      await this.service.recordPresentationDelivery(job, value, presentationDelivery(this.service, value))
    }
    if (value?.runId) {
      this.service.coordinator.cancelRun(value.runId)
    }
    let external: Awaited<ReturnType<typeof cancelExternal>>
    if (value && !['succeeded', 'failed', 'cancelled'].includes(value.state)) {
      if (this.service.plugins.supports(value)) {
        external = await this.service.plugins.cancel(task.input, context)
      } else {
        external = await cancelExternal(this.service, task.input, context)
      }
    }
    let committed = false
    try {
      await runtime.commit(async (tx) => {
        await releaseExternal(tx, externalKey(task.input.jobId, task.input.revision))
        await releaseSchedule(tx, value?.schedule, job.id)
        await this.service.repository.change(tx, task.input.jobId, task.input.revision, (value) => {
          value.cancelRequested = true
          value.delivery = 'suppressed'
          const outbound = this.service.coordinator.store.getOutbound(
            `job:${task.input.jobId}:${task.input.revision}:result`
          )
          if (value.presentation) {
            value.delivery = presentationDelivery(this.service, value)
          }
          if (outbound) {
            value.delivery = 'suppressed'
            if (['sending', 'preparing', 'unknown'].includes(outbound.state)) {
              value.delivery = 'unknown'
            }
            if (outbound.state === 'sent') {
              value.delivery = 'sent'
            }
            if (outbound.state === 'cancelled' && outbound.platformMessageIds.length > 0) {
              value.delivery = 'partial'
            }
          }
          if (!jobTerminal(value.state) || (value.state === 'outcome_unknown' && external)) {
            value.state = 'cancelled'
            if (external) {
              const outcome = mergeExternalOutcome(value.result, external.outcome)
              value.state = outcome.state
              value.result = outcome.result
              value.error = outcome.error
              if (value.external) {
                value.external.status = outcome.state
                value.external.nextPollAt = undefined
                value.external.message = undefined
              }
            } else if (value.spec.kind === 'tool' && task.state.checkpoint.phase === 'dispatching') {
              value.state = 'outcome_unknown'
              value.error = '已停止等待；外部操作是否完成无法确认'
            }
          }
          value.finishedAt ??= Date.now()
        })
        return { status: 'terminal', outcome: { status: 'aborted' } }
      }, context)
      committed = true
    } finally {
      await external?.close(committed)
    }
    this.service.changed(await this.service.repository.get(task.input.jobId))
  }

  private async finish(task: ActiveJobTask, runtime: JobTaskRuntime, context: Context) {
    const job = await this.service.repository.get(task.input.jobId)
    return runtime.commit(async (tx) => {
      await releaseSchedule(tx, job.revisions[String(task.input.revision)]?.schedule, job.id)
      return { status: 'terminal', outcome: { status: 'completed', result: task.input } }
    }, context)
  }
}
