import { z } from 'zod'
import type { ExecutionContext } from '@pi-im-bot/contracts/run'
import type { ArtifactStore } from '@pi-im-bot/artifacts/store'
import { PluginResultSchema, type PluginResult, type PluginOperationOutcome } from './rpc/protocol'

export function completedPluginResult(outcome: PluginOperationOutcome) {
  if (outcome.status === 'failed') {
    throw new Error(outcome.error)
  }
  if (outcome.status === 'cancelled') {
    throw new Error(outcome.message ?? '插件操作已取消')
  }
  if (outcome.status === 'pending') {
    throw new Error('插件返回等待句柄，需要通过后台 Job 执行，未重新提交')
  }
  return outcome.result
}

export async function projectPluginResult(raw: PluginResult, capability: string, artifacts: ArtifactStore) {
  const result = PluginResultSchema.parse(raw)
  const artifactIds = [...new Set(result.artifactIds)]
  for (const id of artifactIds) {
    await artifacts.metadata(id)
  }
  let text = result.text
  if (result.value !== undefined) {
    if (text) {
      text += '\n'
    }
    text += JSON.stringify(result.value)
  }
  if (text.length > 12000) {
    const artifact = await artifacts.save('plugin-result.txt', 'text/plain', capability, text)
    artifactIds.push(artifact.id)
    text = text.slice(0, 12000) + '\n完整结果产物：' + artifact.id
  }
  if (!text && artifactIds.length > 0 && !result.suppressText) {
    text = '已生成产物。'
  }
  const projected: {
    summary: string
    artifactIds: string[]
    format?: PluginResult['format']
    itemized?: boolean
    businessStatus?: PluginResult['businessStatus']
    factsComplete?: boolean
    items?: PluginResult['items']
  } = { summary: text, artifactIds }
  if (result.format !== undefined) {
    projected.format = result.format
  }
  if (result.itemized !== undefined) {
    projected.itemized = result.itemized
  }
  if (result.businessStatus !== undefined) {
    projected.businessStatus = result.businessStatus
  }
  if (result.factsComplete !== undefined) {
    projected.factsComplete = result.factsComplete
  }
  if (result.items !== undefined) {
    projected.items = result.items
  }
  return projected
}

export function pluginArtifactStoreOwner(invocation: Pick<ExecutionContext, 'jobId' | 'jobRevision'>) {
  if (invocation.jobId) {
    return `job:${invocation.jobId}:${invocation.jobRevision}`
  }
  return undefined
}

export const PluginArgumentsSchema = z.record(z.string(), z.json())
