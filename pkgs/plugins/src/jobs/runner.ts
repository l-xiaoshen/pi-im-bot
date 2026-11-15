import { BACKGROUND_CONTEXT, type Context } from '@earendil-works/chord/context'
import type { JobService } from '@pi-im-bot/jobs/service'
import type { ActiveJobTask, JobTaskRuntime, JobTaskInput } from '@pi-im-bot/jobs/task'
import type { JobRevision } from '@pi-im-bot/jobs/schema'
import { jobSummary, jobTerminal } from '@pi-im-bot/jobs/schema'
import { claimExternal, finishExternal, releaseExternal } from '@pi-im-bot/jobs/external/state'
import type { ExternalCancellation } from '@pi-im-bot/jobs/external/cancel'
import { externalKey } from '@pi-im-bot/jobs/external/documents'
import { PluginExecutions, PluginExecutionSchema } from './documents'
import {
  pluginJobContext,
  savePluginExecution,
  pluginJobError,
  type CreateJobInvocation,
  type PluginJobContext
} from './context'
import { pluginJobOutcome } from './outcome'
import type { PluginOperationOutcome } from '../rpc/protocol'
import { PluginInvocationError } from '../rpc/peer'
import { mergeExternalOutcome } from '@pi-im-bot/jobs/external/outcome'
import { deadlineScope } from '@pi-im-bot/support/deadline'

export class PluginJobRunner {
  constructor(
    private readonly service: JobService,
    private readonly create: CreateJobInvocation
  ) {}

  supports(value: JobRevision) {
    return value.spec.kind === 'tool' && value.spec.capability.startsWith('plugin:')
  }

  private load(input: JobTaskInput, retained = false) {
    return pluginJobContext(this.service, this.create, input, retained)
  }

  async start(task: ActiveJobTask, runtime: JobTaskRuntime, context: Context) {
    const value = await this.load(task.input)
    const deadline = deadlineScope(runtime.signal, value.value.deadlineAt)
    const signal = deadline.signal
    let dispatched = false
    try {
      value.invocation.services.authorize(value.entry.capabilityId)
      for (const action of value.entry.operation.actions) {
        value.invocation.services.authorize(action)
      }
      value.plugins.validateDelivery(
        value.invocation.config,
        value.invocation.input.context.effective.settings,
        value.entry.capabilityId
      )
      if (
        !(await claimExternal(
          this.service,
          task,
          'plugin:' + value.entry.instance.id,
          value.plugins.manager.config.maxOutstandingJobs,
          context
        ))
      ) {
        await runtime.commit(async (tx) => {
          await this.service.repository.change(tx, value.job.id, value.value.revision, (current) => {
            current.state = 'queued'
            current.external = { status: 'waiting_capacity', attempts: 0, hasReceipt: false }
          })
          return undefined
        }, context)
        this.service.changed(await this.service.repository.get(value.job.id))
        await runtime.sleepUntil(
          Math.min(Date.now() + 1000, value.value.deadlineAt),
          { phase: 'work' },
          context
        )
        return
      }
      await runtime.commit(async (tx) => {
        await savePluginExecution(tx, value.key, value.execution)
        await this.service.repository.change(tx, value.job.id, value.value.revision, (current) => {
          current.state = 'waiting_external'
          current.external = { status: 'submitting', attempts: 0, hasReceipt: false }
        })
        return { status: 'running', checkpoint: { phase: 'dispatching' } }
      }, context)
      dispatched = true
      const outcome = await value.plugins.execute(
        value.invocation,
        value.entry.capabilityId,
        value.spec.arguments,
        value.key,
        signal
      )
      await this.remember(task, runtime, context, value, outcome)
    } catch (error) {
      if (runtime.signal.aborted) {
        throw error
      }
      if (dispatched && value.entry.operation.recover && (await this.recover(task, runtime, context))) {
        return
      }
      let state: 'failed' | 'outcome_unknown' = 'failed'
      if (dispatched && !(error instanceof PluginInvocationError && error.failure.code === 'validation')) {
        state = 'outcome_unknown'
      }
      await finishExternal(this.service, task, runtime, context, {
        state,
        error: pluginJobError(error, value.execution)
      })
    } finally {
      deadline.close()
    }
  }

  private async remember(
    task: ActiveJobTask,
    runtime: JobTaskRuntime,
    context: Context,
    value: PluginJobContext,
    outcome: PluginOperationOutcome
  ) {
    if (outcome.status !== 'pending') {
      await finishExternal(this.service, task, runtime, context, await pluginJobOutcome(value, outcome))
      return
    }
    if (!value.entry.operation.poll) {
      throw new Error('插件返回了等待句柄但没有声明 poll；未重新提交')
    }
    value.execution.handle = outcome.handle
    value.execution.failures = 0
    const nextPollAt = Math.min(Date.now() + outcome.pollAfterMs, value.value.deadlineAt)
    await runtime.commit(async (tx) => {
      await savePluginExecution(tx, value.key, value.execution)
      await this.service.repository.change(tx, value.job.id, value.value.revision, (current) => {
        current.state = 'waiting_external'
        current.external = {
          status: 'working',
          hasReceipt: true,
          attempts: (current.external?.attempts ?? 0) + 1,
          nextPollAt
        }
      })
      return { status: 'running', checkpoint: { phase: 'poll' } }
    }, context)
    this.service.changed(await this.service.repository.get(value.job.id))
    await runtime.sleepUntil(nextPollAt, { phase: 'poll' }, context)
  }

  async recover(task: ActiveJobTask, runtime: JobTaskRuntime, context: Context) {
    let value: PluginJobContext
    try {
      value = await this.load(task.input, true)
    } catch {
      return false
    }
    if (!value.entry.operation.recover) {
      return false
    }
    try {
      const outcome = await value.plugins.execute(
        value.invocation,
        value.entry.capabilityId,
        { input: value.spec.arguments, handle: value.execution.handle ?? null },
        value.key + ':recover',
        runtime.signal,
        'recover'
      )
      await this.remember(task, runtime, context, value, outcome)
    } catch (error) {
      await finishExternal(this.service, task, runtime, context, {
        state: 'outcome_unknown',
        error: pluginJobError(error, value.execution)
      })
    }
    return true
  }

  async poll(task: ActiveJobTask, runtime: JobTaskRuntime, context: Context) {
    let value: PluginJobContext | undefined
    let authorized = false
    let deadline: ReturnType<typeof deadlineScope> | undefined
    try {
      value = await this.load(task.input, true)
      if (!value.plugins.available()) {
        throw new Error('插件执行后端已关闭')
      }
      value.invocation.services.authorize(value.entry.capabilityId)
      for (const action of value.entry.operation.actions) {
        value.invocation.services.authorize(action)
      }
      value.plugins.validateDelivery(
        value.invocation.config,
        value.invocation.input.context.effective.settings,
        value.entry.capabilityId
      )
      authorized = true
      if (value.execution.handle === undefined) {
        if (value.entry.operation.recover && (await this.recover(task, runtime, context))) {
          return
        }
        throw new Error('插件任务句柄缺失，未重新提交')
      }
      if (Date.now() >= value.value.deadlineAt) {
        const cancelled = await this.cancel(task.input, context)
        await finishExternal(
          this.service,
          task,
          runtime,
          context,
          cancelled?.outcome ?? { state: 'outcome_unknown', error: '插件等待期限已到，结果未确认' }
        )
        return
      }
      deadline = deadlineScope(runtime.signal, value.value.deadlineAt)
      const outcome = await value.plugins.execute(
        value.invocation,
        value.entry.capabilityId,
        { handle: value.execution.handle },
        value.key + ':poll',
        deadline.signal,
        'poll'
      )
      await this.remember(task, runtime, context, value, outcome)
    } catch (error) {
      if (runtime.signal.aborted) {
        throw error
      }
      if (value) {
        value.execution.failures += 1
      }
      if (
        value &&
        authorized &&
        value.execution.handle !== undefined &&
        value.execution.failures < value.plugins.manager.config.maxPollFailures &&
        Date.now() < value.value.deadlineAt
      ) {
        const nextPollAt = Math.min(Date.now() + 1000 * 2 ** value.execution.failures, value.value.deadlineAt)
        await runtime.commit(async (tx) => {
          await savePluginExecution(tx, value!.key, value!.execution)
          await this.service.repository.change(tx, task.input.jobId, task.input.revision, (current) => {
            current.external = {
              status: 'retrying_poll',
              hasReceipt: true,
              attempts: (current.external?.attempts ?? 0) + 1,
              nextPollAt
            }
          })
          return undefined
        }, context)
        await runtime.sleepUntil(nextPollAt, { phase: 'poll' }, context)
        return
      }
      if (!authorized) {
        await runtime.commit(async (tx) => {
          await this.service.repository.change(tx, task.input.jobId, task.input.revision, (current) => {
            current.cancelRequested = true
          })
          return undefined
        }, context)
      }
      let message = '插件任务无法继续查询，结果未确认'
      if (value) {
        message = pluginJobError(error, value.execution)
      }
      await finishExternal(this.service, task, runtime, context, { state: 'outcome_unknown', error: message })
    } finally {
      deadline?.close()
    }
  }

  async cancel(
    input: JobTaskInput,
    context: Context,
    retry = false
  ): Promise<ExternalCancellation | undefined> {
    const stored = await this.service.runtime.native.snapshot(
      PluginExecutions,
      externalKey(input.jobId, input.revision),
      BACKGROUND_CONTEXT
    )
    if (!stored?.value) {
      return undefined
    }
    let outcome: ExternalCancellation['outcome'] = {
      state: 'outcome_unknown',
      error: '已停止等待，插件取消尚未确认'
    }
    try {
      const value = await this.load(input, true)
      if (value.execution.handle === undefined && value.entry.operation.recover) {
        const result = await value.plugins.execute(
          value.invocation,
          value.entry.capabilityId,
          { input: value.spec.arguments, handle: null, intent: 'cancel' },
          value.key + ':recover-cancel',
          AbortSignal.timeout(10000),
          'recover'
        )
        outcome = await pluginJobOutcome(value, result)
      } else if (value.execution.handle !== undefined) {
        const signal = AbortSignal.any([
          context.abortSignal ?? new AbortController().signal,
          AbortSignal.timeout(10000)
        ])
        let phase: 'poll' | 'cancel' = 'poll'
        if (value.entry.operation.cancel) {
          const dispatch = await this.service.runtime.native.commit(async (tx) => {
            const doc = await tx.doc(PluginExecutions, value.key, null)
            const execution = PluginExecutionSchema.parse(doc.value)
            if (execution.cancelDispatched && !retry) {
              return false
            }
            execution.cancelDispatched = true
            await savePluginExecution(tx, value.key, execution)
            return true
          }, context)
          if (dispatch) {
            phase = 'cancel'
          }
        }
        const result = await value.plugins.execute(
          value.invocation,
          value.entry.capabilityId,
          { handle: value.execution.handle },
          value.key + ':' + phase,
          signal,
          phase
        )
        outcome = await pluginJobOutcome(value, result)
      }
    } catch {
      /* Unknown cancellation never causes a resubmission or a late result. */
    }
    return { outcome, async close() {} }
  }

  async reconcile(roomId: string, jobId: string, cancel: boolean) {
    const job = await this.service.repository.get(jobId, roomId)
    const revision = job.currentRevision
    const value = job.revisions[String(revision)]
    if (!jobTerminal(value.state) || value.delivery === 'pending') {
      throw new Error('任务仍在执行，请先停止或等待收尾')
    }
    if (value.state !== 'outcome_unknown') {
      return jobSummary(job)
    }
    if (!value.external?.hasReceipt) {
      throw new Error('没有插件任务回执，不能核对，也不会重新提交')
    }
    let outcome: ExternalCancellation['outcome']
    if (cancel) {
      outcome = (await this.cancel({ jobId, revision }, BACKGROUND_CONTEXT, true))!.outcome
    } else {
      const current = await this.load({ jobId, revision }, true)
      let argumentsValue: Record<string, unknown> = { handle: current.execution.handle }
      let phase: 'recover' | 'reconcile' = 'reconcile'
      if (current.execution.handle === undefined) {
        argumentsValue = { input: current.spec.arguments, handle: null, intent: 'reconcile' }
        phase = 'recover'
      }
      const result = await current.plugins.execute(
        current.invocation,
        current.entry.capabilityId,
        argumentsValue,
        current.key + ':reconcile',
        AbortSignal.timeout(30000),
        phase
      )
      outcome = await pluginJobOutcome(current, result)
    }
    await this.service.runtime.native.commit(async (tx) => {
      await this.service.repository.change(tx, jobId, revision, (current) => {
        if (current.state !== 'outcome_unknown' || current.delivery === 'pending') {
          throw new Error('任务状态已变化')
        }
        outcome = mergeExternalOutcome(current.result, outcome)
        current.state = outcome.state
        current.result = outcome.result
        current.error = outcome.error
        current.external = {
          status: outcome.state,
          attempts: (current.external?.attempts ?? 0) + 1,
          hasReceipt: true
        }
      })
      await releaseExternal(tx, externalKey(jobId, revision))
    }, BACKGROUND_CONTEXT)
    const updated = await this.service.repository.get(jobId)
    await this.service.recordReconciledFacts(updated)
    this.service.changed(updated)
    return jobSummary(updated)
  }
}
