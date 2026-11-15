import { BACKGROUND_CONTEXT, type Context } from '@earendil-works/chord/context'
import type { Tx } from '@earendil-works/pi-durable'
import type { JobService } from '../service'
import type { ActiveJobTask, JobTaskRuntime } from '../task'
import {
  ExternalExecutions,
  ExternalSlots,
  ExternalExecutionSchema,
  externalKey,
  type ExternalExecution
} from './documents'
import type { JobRevision } from '../schema'
import { mergeExternalOutcome } from './outcome'

export async function saveExternal(tx: Tx, key: string, value: ExternalExecution) {
  const document = await tx.doc(ExternalExecutions, key, null)
  document.value = ExternalExecutionSchema.parse(JSON.parse(JSON.stringify(value)))
}
export async function releaseExternal(tx: Tx, key: string) {
  const slots = await tx.doc(ExternalSlots)
  delete slots.owners[key]
}

export async function claimExternal(
  service: JobService,
  task: ActiveJobTask,
  serverId: string,
  maximum: number,
  context: Context
) {
  const key = externalKey(task.input.jobId, task.input.revision)
  return service.runtime.native.commit(async (tx) => {
    const slots = await tx.doc(ExternalSlots)
    if (slots.owners[key]) {
      return true
    }
    const count = Object.values(slots.owners).filter((owner) => {
      return owner.serverId === serverId
    }).length
    if (count >= maximum) {
      return false
    }
    slots.owners[key] = { jobId: task.input.jobId, serverId }
    return true
  }, context)
}

export interface ExternalOutcome {
  state: 'succeeded' | 'failed' | 'cancelled' | 'outcome_unknown'
  result?: JobRevision['result']
  error?: string
}

export async function finishExternal(
  service: JobService,
  task: ActiveJobTask,
  runtime: JobTaskRuntime,
  context: Context,
  outcome: ExternalOutcome
) {
  await runtime.commit(async (tx) => {
    await service.repository.change(tx, task.input.jobId, task.input.revision, (value) => {
      outcome = mergeExternalOutcome(value.result, outcome)
      value.state = outcome.state
      value.result = outcome.result
      value.error = outcome.error
      if (outcome.state === 'failed' && !value.error) {
        value.error = outcome.result?.summary ?? '远端操作失败'
      }
      value.finishedAt = Date.now()
      if (value.external) {
        value.external.nextPollAt = undefined
        value.external.status = outcome.state
        value.external.message = undefined
      }
    })
    await releaseExternal(tx, externalKey(task.input.jobId, task.input.revision))
    return { status: 'running', checkpoint: { phase: 'report' } }
  }, context)
  service.changed(await service.repository.get(task.input.jobId))
}
