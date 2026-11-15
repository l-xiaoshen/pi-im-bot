import { PluginStateStore } from '@pi-im-bot/plugins/state/store'
import { ComfyBroker } from '@pi-im-bot/integrations/comfy/broker'
import { BACKGROUND_CONTEXT, awaitWithContext, withAbortSignal } from '@earendil-works/chord/context'
import { defineExtension, type TaskId } from '@earendil-works/pi-durable'
import type { Configuration } from '@pi-im-bot/config/load'
import type { Room } from '@pi-im-bot/contracts/message'
import type { PreparedRunInput } from '@pi-im-bot/contracts/run'
import type { Coordinator } from '@pi-im-bot/runtime/coordinator'
import type { DurableAgentRuntime } from '@pi-im-bot/agent/durable/runtime'
import { Jobs, JobFacts } from './documents'
import { JobRequests, JobAdmissions, initializeJobIndex } from './index'
import { JobRepository } from './repository'
import { createJobTask } from './task'
import { JobWorker } from './worker'
import {
  JobRevisionSchema,
  JobSchema,
  jobSummary,
  jobTerminal,
  type JobSpec,
  type Job,
  type JobSummary
} from './schema'
import type { JobToolServices } from './tools'
import { ExternalJobRunner } from './external/runner'
import { ScheduleOccurrences, admitSchedule } from '@pi-im-bot/scheduler/occurrences'
import type { ScheduleOrigin } from '@pi-im-bot/scheduler/origin'
import type { Schedule } from '@pi-im-bot/scheduler/definition'
import { reconcileExternal } from './external/reconcile'
import { PluginJobRunner } from '@pi-im-bot/plugins/jobs/runner'
import type { Outbound } from '@pi-im-bot/contracts/delivery'
import {
  RenderAdmissionRejected,
  RenderRejectionSchema,
  type RenderRejection
} from '@pi-im-bot/contracts/rendering'
import { serviceOperationBudget } from '@pi-im-bot/plugins/operation-budget'
import type { PluginOperationEntry } from '@pi-im-bot/plugins/registry'

interface AdmissionOptions {
  operationOwned?: boolean
  presentation?: { outboundId: string; parentJobId?: string; parentJobRevision?: number }
  schedule?: ScheduleOrigin
}

export interface JobInvocation {
  config: Configuration
  room: Room
  input: PreparedRunInput
  runId: string
  authorize(capability: string): void
}

export class JobService {
  readonly repository: JobRepository
  readonly task: ReturnType<typeof createJobTask>
  readonly external: ExternalJobRunner
  readonly plugins: PluginJobRunner
  private readonly reconciliation = new Map<string, Promise<JobSummary>>()

  constructor(
    readonly runtime: DurableAgentRuntime,
    readonly coordinator: Coordinator
  ) {
    this.repository = new JobRepository(runtime)
    if (coordinator.plugins) {
      coordinator.plugins.managed = {
        state: new PluginStateStore(runtime),
        comfy: new ComfyBroker(runtime, this.repository)
      }
    }
    this.external = new ExternalJobRunner(this)
    const worker = new JobWorker(this)
    this.plugins = new PluginJobRunner(this, worker.invocation.bind(worker))
    this.task = createJobTask({
      work: worker.work.bind(worker),
      unknown: worker.unknown.bind(worker),
      poll: async (task, runtime, context) => {
        const job = await this.repository.get(task.input.jobId)
        const value = job.revisions[String(task.input.revision)]
        if (value && this.plugins.supports(value)) {
          await this.plugins.poll(task, runtime, context)
        } else {
          await this.external.poll(task, runtime, context)
        }
      },
      report: worker.report.bind(worker),
      abort: worker.abort.bind(worker)
    })
    runtime.registry.install(defineExtension({ name: 'bot-jobs', tasks: [this.task] }))
  }

  forInvocation(invocation: JobInvocation): JobToolServices {
    const roomId = invocation.room.id
    return {
      operation: (title, capability, args, callId) => {
        return this.admit(
          invocation,
          title,
          { kind: 'tool', capability, arguments: args },
          callId,
          undefined,
          { operationOwned: true }
        )
      },
      start: (title, spec, callId, messageIds) => {
        return this.start(invocation, title, spec, callId, messageIds)
      },
      list: () => {
        return this.repository.list(roomId)
      },
      status: async (id) => {
        return jobSummary(await this.repository.get(id, roomId))
      },
      cancel: async (id) => {
        const job = await this.repository.get(id, roomId)
        this.checkChildControl(invocation, job)
        return this.cancel(job.id, roomId)
      },
      update: (id, revision, instruction, callId) => {
        return this.update(invocation, id, revision, instruction, callId)
      },
      wait: async (id, signal) => {
        if (!invocation.input.context.jobId) {
          throw new Error('主对话不等待后台任务；请先回复群聊，完成后会自动交付')
        }
        for (;;) {
          signal?.throwIfAborted()
          const job = await this.repository.get(id, roomId)
          this.checkChildControl(invocation, job)
          const summary = jobSummary(job)
          if (jobTerminal(summary.state)) {
            return summary
          }
          const delay = new Promise<void>((resolve) => {
            setTimeout(resolve, 100)
          })
          if (signal) {
            await awaitWithContext(delay, withAbortSignal(signal, BACKGROUND_CONTEXT))
          } else {
            await delay
          }
        }
      }
    }
  }

  private checkChildControl(invocation: JobInvocation, job: Job) {
    const parentId = invocation.input.context.jobId
    if (parentId && job.revisions[String(job.currentRevision)].parentJobId !== parentId) {
      throw new Error('后台 Agent 只能操作自己创建的子任务')
    }
  }

  async start(
    invocation: JobInvocation,
    title: string,
    spec: JobSpec,
    callId: string,
    sourceMessageIds?: string[]
  ): Promise<JobSummary> {
    return this.admit(invocation, title, spec, callId, sourceMessageIds)
  }

  async present(outbound: Outbound) {
    const admission = outbound.renderAdmission
    const plan = outbound.render
    if (!admission || !plan) {
      throw new Error('呈现缺少固定接纳快照')
    }
    this.coordinator.validateRender(outbound)
    const config = await this.coordinator.loadConfigurationSnapshot(admission.configSnapshot)
    const room = { ...this.coordinator.requireRoom(outbound.roomId), mode: admission.mode }
    const input = admission.input
    const authorize = (capability: string) => {
      this.coordinator.authorizeRetainedContext(room.id, room.mode, input.context, capability)
    }
    for (const handler of outbound.presentationHandlers) {
      authorize(handler)
    }
    const job = await this.admit(
      { config, room, input, runId: outbound.runId ?? outbound.id, authorize },
      '回复呈现',
      { kind: 'tool', capability: plan.capability, arguments: plan.arguments },
      outbound.id + ':render',
      undefined,
      {
        operationOwned: true,
        presentation: {
          outboundId: outbound.id,
          parentJobId: input.context.jobId,
          parentJobRevision: input.context.jobRevision
        }
      }
    )
    return job.id
  }

  async recordPresentationDelivery(
    job: Job,
    value: Job['revisions'][string],
    delivery: JobSummary['delivery']
  ) {
    if (!value.presentation) {
      return
    }
    const outbound = this.coordinator.store.getOutbound(value.presentation.outboundId)
    const run = outbound?.runId && this.coordinator.store.getRun(outbound.runId)
    let state: 'sent' | 'unknown' | 'partial' | 'suppressed' = 'suppressed'
    if (delivery === 'sent' || delivery === 'unknown' || delivery === 'partial') {
      state = delivery
    }
    if (run) {
      run.presentation = { state, jobId: job.id }
      this.coordinator.store.saveRun(run)
      this.coordinator.events.emit({ type: 'run', run })
    }
    const parentId = value.presentation.parentJobId
    const parentRevision = value.presentation.parentJobRevision
    if (parentId && parentRevision) {
      await this.runtime.native.commit(async (tx) => {
        await this.repository.change(tx, parentId, parentRevision, (parent) => {
          parent.delivery = delivery
        })
      }, BACKGROUND_CONTEXT)
      this.changed(await this.repository.get(parentId))
    }
  }

  private async admit(
    invocation: JobInvocation,
    title: string,
    spec: JobSpec,
    callId: string,
    sourceMessageIds?: string[],
    options: AdmissionOptions = {}
  ): Promise<JobSummary> {
    if (spec.kind === 'agent' && !invocation.input.context.effective.settings.behavior.agentEnabled) {
      throw new Error('当前聊天范围已关闭 Agent')
    }
    let capability = 'start_job'
    if (spec.kind === 'agent') {
      capability = 'delegate_task'
    }
    if (!options.schedule?.entry && (!options.operationOwned || spec.kind !== 'tool')) {
      invocation.authorize(capability)
    }
    if (spec.kind === 'tool') {
      if (
        spec.capability !== 'bash' &&
        !spec.capability.startsWith('mcp:') &&
        !spec.capability.startsWith('plugin:')
      ) {
        throw new Error('后台操作当前支持沙盒 bash、MCP 和插件；多步任务请使用 delegate_task')
      }
      invocation.authorize(spec.capability)
    }
    let parentId = invocation.input.context.jobId
    if (options.presentation) {
      parentId = undefined
    }
    const allowedSources = new Set(
      invocation.input.identities.flatMap((identity) => {
        return identity.messageIds
      })
    )
    const sources = sourceMessageIds ?? [...allowedSources]
    if (
      sources.some((id) => {
        return !allowedSources.has(id)
      })
    ) {
      throw new Error('任务只能关联当前输入中的消息')
    }
    const nativeConversation = await this.runtime.ensureConversation(
      invocation.config,
      invocation.room,
      invocation.input
    )
    let parentTask: TaskId | undefined
    let schedule = options.schedule
    let detached = false
    let deadlineAt = Date.now() + invocation.input.context.effective.settings.behavior.jobTimeoutMs
    let operation: PluginOperationEntry | undefined
    if (spec.kind === 'tool' && spec.capability.startsWith('plugin:')) {
      operation = this.coordinator.plugins?.operation(
        {
          ...invocation,
          services: {
            authorize: invocation.authorize,
            history() {
              return []
            },
            async send() {
              throw new Error('admission never sends')
            }
          }
        },
        spec.capability
      )
      if (operation) {
        const duration = serviceOperationBudget(invocation.config, operation)
        if (duration !== undefined) {
          deadlineAt = Date.now() + duration
        }
      }
    }
    if (parentId) {
      const parent = await this.repository.get(parentId, invocation.room.id)
      const current = parent.revisions[String(parent.currentRevision)]
      if (spec.kind === 'agent' && !current.schedule?.entry) {
        throw new Error('后台 Agent 不能递归启动 Agent')
      }
      if (
        parent.currentRevision !== invocation.input.context.jobRevision ||
        current.cancelRequested ||
        !current.nativeTaskId
      ) {
        throw new Error('父任务版本已失效')
      }
      parentTask = current.nativeTaskId as TaskId
      deadlineAt = Math.min(deadlineAt, current.deadlineAt)
      if (current.schedule) {
        schedule = { ...current.schedule, entry: false }
        detached = current.schedule.entry && !current.schedule.isolated
      }
    }
    const request = invocation.runId + ':' + callId
    const id = crypto.randomUUID()
    const value = JobRevisionSchema.parse({
      revision: 1,
      title,
      spec,
      requiredActions: [],
      state: 'queued',
      createdAt: Date.now(),
      deadlineAt,
      sourceRunId: invocation.runId,
      sourceMessageIds: sources,
      schedule,
      parentJobId: parentId,
      parentJobRevision: invocation.input.context.jobRevision,
      context: invocation.input.context,
      mode: invocation.room.mode,
      configSnapshot: this.coordinator.snapshotConfiguration(invocation.config),
      presentation: options.presentation,
      childConversationId: 'job:' + id + ':1',
      runId: crypto.randomUUID()
    })
    if (parentId && !detached) {
      value.delivery = 'none'
    }
    if (spec.kind === 'tool' && spec.capability.startsWith('plugin:')) {
      value.requiredActions = operation?.operation.actions ?? []
      for (const action of value.requiredActions) {
        invocation.authorize(action)
      }
    }
    const job: Job = { id, roomId: invocation.room.id, currentRevision: 1, revisions: { '1': value } }
    const acceptedId = await this.runtime.native.commit(async (tx) => {
      const index = await initializeJobIndex(tx)
      if (options.presentation) {
        const outbound = this.coordinator.store.getOutbound(options.presentation.outboundId)
        if (!outbound || outbound.cancelRequested || outbound.state !== 'rendering') {
          throw new Error('待呈现回复已停止，未新建任务')
        }
      }
      const receipt = await tx.doc(JobRequests, request, null)
      const prior = receipt.jobId
      if (prior) {
        return { status: 'accepted' as const, id: prior }
      }
      if (receipt.renderRejection) {
        return {
          status: 'rejected' as const,
          rejection: RenderRejectionSchema.parse(receipt.renderRejection)
        }
      }
      // Rejections are durable decisions under the same request key, with no task or quota charge.
      const reject = (rejection: RenderRejection) => {
        if (!options.presentation) {
          throw new Error(rejection.message)
        }
        const outbound = this.coordinator.store.getOutbound(options.presentation.outboundId)!
        this.coordinator.validateRender(outbound)
        receipt.renderRejection = rejection
        return { status: 'rejected' as const, rejection }
      }
      if (options.presentation && (this.coordinator.plugins?.manager.config.maxWorkers ?? 0) < 2) {
        return reject({
          code: 'worker_capacity',
          message: '自动呈现需要至少 2 个业务 Worker；当前容量保留文字与控制可用性'
        })
      }
      if (schedule) {
        const current = this.coordinator.store.listSchedules().find((entry) => {
          return entry.id === schedule.id
        })
        if (
          !current ||
          current.executionEpoch !== schedule.epoch ||
          (schedule.entry && schedule.occurrence.startsWith('cron:') && !current.enabled)
        ) {
          throw new Error('此计划触发已失效或被停止')
        }
        await admitSchedule(tx, schedule, id)
      }
      const admissions = await tx.doc(JobAdmissions, invocation.runId, null)
      const count = admissions.count
      if (count >= invocation.input.context.effective.settings.behavior.maxJobsPerRun) {
        return reject({ code: 'run_capacity', message: '本轮后台任务数量已达上限' })
      }
      const outstanding = Object.values(index.jobs).filter((job) => {
        return !jobTerminal(job.state) || job.delivery === 'pending'
      })
      if (outstanding.length >= invocation.config.bot.agent.maxOutstandingJobs) {
        return reject({
          code: 'global_capacity',
          message: '全局未收尾后台任务数量已达上限，请先完成或停止部分任务'
        })
      }
      if (
        outstanding.filter((job) => {
          return job.roomId === invocation.room.id
        }).length >= invocation.input.context.effective.settings.behavior.maxOutstandingJobs
      ) {
        return reject({
          code: 'scope_capacity',
          message: '此会话未收尾后台任务数量已达上限，请先完成或停止部分任务'
        })
      }
      const taskOptions = {
        conversationId: nativeConversation,
        ownership: { kind: 'conversation' as const },
        background: true
      }
      if (!options.schedule?.entry && (!options.operationOwned || spec.kind !== 'tool')) {
        invocation.authorize(capability)
      }
      if (spec.kind === 'tool') {
        invocation.authorize(spec.capability)
      }
      let taskId: TaskId
      if (parentTask && !detached) {
        const parent = await tx.task(parentTask)
        if (!parent) {
          throw new Error('父任务不存在')
        }
        taskId = await tx.createTask(
          this.task,
          { jobId: id, revision: 1 },
          { conversationId: parent.conversationId, ownership: { kind: 'task', taskId: parentTask } }
        )
      } else {
        taskId = await tx.createTask(this.task, { jobId: id, revision: 1 }, taskOptions)
      }
      value.nativeTaskId = taskId
      await this.repository.save(tx, job)
      receipt.jobId = id
      admissions.count = count + 1
      return { status: 'accepted' as const, id }
    }, BACKGROUND_CONTEXT)
    if (acceptedId.status === 'rejected') {
      throw new RenderAdmissionRejected(acceptedId.rejection)
    }
    const accepted = await this.repository.get(acceptedId.id, invocation.room.id)
    this.changed(accepted)
    return jobSummary(accepted)
  }

  async startSchedule(schedule: Schedule, occurrence: string, scheduledAt: number) {
    const request = `schedule:${schedule.id}:${occurrence}:tick`
    await this.repository.initialize()
    const receipt = await this.runtime.native.snapshot(JobRequests, request, BACKGROUND_CONTEXT)
    const prior = receipt?.jobId
    if (prior) {
      return jobSummary(await this.repository.get(prior, schedule.roomId))
    }
    const invocation = this.coordinator.scheduleInvocation(schedule, occurrence)
    return this.admit(invocation, schedule.name, { kind: 'agent', prompt: schedule.prompt }, 'tick', [], {
      schedule: {
        id: schedule.id,
        occurrence,
        scheduledAt,
        isolated: schedule.isolated,
        entry: true,
        epoch: schedule.executionEpoch,
        timezone: schedule.timezone
      }
    })
  }

  async cancelSchedule(id: string) {
    const state = await this.runtime.native.snapshot(ScheduleOccurrences, BACKGROUND_CONTEXT)
    for (const jobId of state?.active[id] ?? []) {
      const job = await this.repository.get(jobId)
      await this.cancel(jobId, job.roomId)
    }
  }
  reconcile(id: string, roomId: string, cancel: boolean) {
    const previous = this.reconciliation.get(id) ?? Promise.resolve()
    const result = previous
      .catch(() => {})
      .then(async () => {
        const job = await this.repository.get(id, roomId)
        if (this.plugins.supports(job.revisions[String(job.currentRevision)])) {
          return this.plugins.reconcile(roomId, id, cancel)
        }
        return reconcileExternal(this, roomId, id, cancel)
      })
    this.reconciliation.set(id, result)
    void result.then(
      () => {
        if (this.reconciliation.get(id) === result) {
          this.reconciliation.delete(id)
        }
      },
      () => {
        if (this.reconciliation.get(id) === result) {
          this.reconciliation.delete(id)
        }
      }
    )
    return result
  }

  async cancel(id: string, roomId: string, expectedRevision?: number) {
    const job = await this.repository.get(id, roomId)
    if (expectedRevision !== undefined && job.currentRevision !== expectedRevision) {
      return jobSummary(job)
    }
    const current = job.revisions[String(job.currentRevision)]
    if (current.delivery === 'accepted') {
      for (const child of await this.repository.list(roomId)) {
        const rendering = await this.repository.get(child.id, roomId)
        const presentation = rendering.revisions[String(rendering.currentRevision)].presentation
        if (presentation?.parentJobId === id && presentation.parentJobRevision === current.revision) {
          await this.cancel(child.id, roomId, child.revision)
        }
      }
    }
    if (jobTerminal(current.state) && current.delivery !== 'pending') {
      return jobSummary(job)
    }
    await this.runtime.native.commit(async (tx) => {
      await this.repository.change(tx, id, current.revision, (value) => {
        value.cancelRequested = true
        if (!jobTerminal(value.state)) {
          value.state = 'cancel_requested'
        }
      })
    }, BACKGROUND_CONTEXT)
    if (current.runId) {
      this.coordinator.cancelRun(current.runId)
    }
    if (current.nativeTaskId) {
      void this.runtime.native.abortTask(current.nativeTaskId as TaskId, BACKGROUND_CONTEXT).catch(() => {})
    }
    const next = await this.repository.get(id, roomId)
    this.changed(next)
    return jobSummary(next)
  }

  async update(invocation: JobInvocation, id: string, expected: number, instruction: string, callId: string) {
    invocation.authorize('job_update')
    invocation.authorize('delegate_task')
    if (invocation.input.context.jobId) {
      throw new Error('后台 Agent 不能修订其他 Agent 任务')
    }
    await this.repository.initialize()
    const previousReceipt = await this.runtime.native.snapshot(
      JobRequests,
      invocation.runId + ':' + callId,
      BACKGROUND_CONTEXT
    )
    if (previousReceipt?.jobId) {
      if (previousReceipt.jobId !== id) {
        throw new Error('任务修订幂等键与已有操作不匹配')
      }
      return jobSummary(await this.repository.get(id, invocation.room.id))
    }
    const job = await this.repository.get(id, invocation.room.id)
    const previous = job.revisions[String(job.currentRevision)]
    if (previous.spec.kind !== 'agent') {
      throw new Error('已提交的外部操作不能改写；请先核对取消状态，再明确创建新任务')
    }
    if (job.currentRevision !== expected) {
      throw new Error('任务版本已变化，请重新读取状态')
    }
    const nextRevision = expected + 1
    const prompt = previous.spec.prompt + '\n\n当前群成员的新修订：\n' + instruction
    if (prompt.length > 20000) {
      throw new Error('任务说明过长，请精简后重新委派')
    }
    const nativeConversation = await this.runtime.ensureConversation(
      invocation.config,
      invocation.room,
      invocation.input
    )
    const configSnapshot = this.coordinator.snapshotConfiguration(invocation.config)
    await this.runtime.native.commit(async (tx) => {
      const index = await initializeJobIndex(tx)
      const request = invocation.runId + ':' + callId
      const receipt = await tx.doc(JobRequests, request, null)
      if (receipt.jobId) {
        if (receipt.jobId !== id) {
          throw new Error('任务修订幂等键与已有操作不匹配')
        }
        return
      }
      const stored = await tx.doc(Jobs, id, null)
      if (!stored.value || stored.value.currentRevision !== expected) {
        throw new Error('任务版本已变化')
      }
      const current = JobSchema.parse(stored.value)
      if (!index.jobs[id]) {
        const outstanding = Object.values(index.jobs)
        if (
          outstanding.length >= invocation.config.bot.agent.maxOutstandingJobs ||
          outstanding.filter((job) => {
            return job.roomId === invocation.room.id
          }).length >= invocation.input.context.effective.settings.behavior.maxOutstandingJobs
        ) {
          throw new Error('未收尾后台任务数量已达上限，请先完成或停止部分任务')
        }
      }
      current.revisions[String(expected)].cancelRequested = true
      const admissions = await tx.doc(JobAdmissions, invocation.runId, null)
      const count = admissions.count
      if (count >= invocation.input.context.effective.settings.behavior.maxJobsPerRun) {
        throw new Error('本轮后台任务数量已达上限')
      }
      const value = JobRevisionSchema.parse({
        ...current.revisions[String(expected)],
        revision: nextRevision,
        spec: { kind: 'agent', prompt },
        state: 'queued',
        createdAt: Date.now(),
        startedAt: undefined,
        finishedAt: undefined,
        deadlineAt: Date.now() + invocation.input.context.effective.settings.behavior.jobTimeoutMs,
        sourceRunId: invocation.runId,
        sourceMessageIds: invocation.input.identities.flatMap((identity) => {
          return identity.messageIds
        }),
        context: invocation.input.context,
        configSnapshot,
        childConversationId: 'job:' + id + ':' + nextRevision,
        runId: crypto.randomUUID(),
        delivery: 'pending',
        cancelRequested: false,
        result: undefined,
        deliveryError: undefined,
        error: undefined
      })
      value.nativeTaskId = await tx.createTask(
        this.task,
        { jobId: id, revision: nextRevision },
        { conversationId: nativeConversation, ownership: { kind: 'conversation' }, background: true }
      )
      current.currentRevision = nextRevision
      current.revisions[String(nextRevision)] = value
      await this.repository.save(tx, current)
      receipt.jobId = id
      admissions.count = count + 1
    }, BACKGROUND_CONTEXT)
    if (previous.runId) {
      this.coordinator.cancelRun(previous.runId)
    }
    if (previous.nativeTaskId) {
      void this.runtime.native.abortTask(previous.nativeTaskId as TaskId, BACKGROUND_CONTEXT).catch(() => {})
    }
    const updated = await this.repository.get(id, invocation.room.id)
    this.changed(updated)
    return jobSummary(updated)
  }

  async recordReconciledFacts(job: Job) {
    const value = job.revisions[String(job.currentRevision)]
    const config = await this.coordinator.loadConfigurationSnapshot(value.configSnapshot)
    const room = { ...this.coordinator.requireRoom(job.roomId), mode: value.mode }
    const actor = value.context.authority.identities[0]
    const input: PreparedRunInput = {
      roomId: job.roomId,
      text: value.title,
      actorId: actor.actorId,
      actorName: actor.actorName,
      source: 'job',
      receivedAt: value.createdAt,
      identities: value.context.authority.identities,
      context: value.context
    }
    const conversation = await this.runtime.ensureConversation(config, room, input)
    await this.runtime.native.commit(async (tx) => {
      const facts = await tx.doc(JobFacts, conversation)
      facts.results = [
        ...facts.results.filter((fact) => {
          return fact.id !== job.id
        }),
        {
          id: job.id,
          revision: value.revision,
          title: value.title,
          summary: (value.result?.summary ?? value.error ?? value.state).slice(0, 800),
          delivery: value.delivery,
          artifactIds: value.result?.artifactIds ?? []
        }
      ].slice(-8)
    }, BACKGROUND_CONTEXT)
  }
  changed(job: Job) {
    this.coordinator.events.emit({ type: 'job', job: jobSummary(job) })
  }

  async cancelScope(roomId: string) {
    // Queue this read immediately on the mutation line, before later admissions/revisions.
    const jobs = await this.runtime.native.commit(async (tx) => {
      const index = await initializeJobIndex(tx)
      return Object.values(index.jobs)
        .filter((job) => {
          return job.roomId === roomId
        })
        .map((job) => {
          return { id: job.id, revision: job.revision }
        })
    }, BACKGROUND_CONTEXT)
    for (const job of jobs) {
      await this.cancel(job.id, roomId, job.revision)
    }
  }
}
