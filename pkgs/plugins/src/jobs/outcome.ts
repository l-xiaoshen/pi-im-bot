import { ArtifactStore } from '@pi-im-bot/artifacts/store'
import type { ExternalOutcome } from '@pi-im-bot/jobs/external/state'
import type { PluginOperationOutcome } from '../rpc/protocol'
import { projectPluginResult } from '../result'
import { pluginJobError, type PluginJobContext } from './context'

export async function pluginJobOutcome(
  context: PluginJobContext,
  outcome: PluginOperationOutcome
): Promise<ExternalOutcome> {
  if (outcome.status === 'done') {
    const artifacts = new ArtifactStore(
      context.invocation.config.dataDir,
      context.job.roomId,
      `job:${context.job.id}:${context.value.revision}`
    )
    const result = await projectPluginResult(outcome.result, context.entry.capabilityId, artifacts)
    let state: ExternalOutcome['state'] = 'succeeded'
    if (result.businessStatus === 'failed') {
      state = 'failed'
    }
    if (result.businessStatus === 'unknown') {
      state = 'outcome_unknown'
    }
    if (result.factsComplete === false) {
      state = 'outcome_unknown'
    }
    return { state, result }
  }
  if (outcome.status === 'cancelled') {
    return { state: 'cancelled', error: pluginJobError(outcome.message ?? '插件确认取消', context.execution) }
  }
  if (outcome.status === 'failed') {
    return { state: 'failed', error: pluginJobError(outcome.error, context.execution) }
  }
  return { state: 'outcome_unknown', error: '已停止等待，插件操作仍未确认结束' }
}
