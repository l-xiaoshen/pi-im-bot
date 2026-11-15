import type { Configuration } from '@pi-im-bot/config/load'
import type { PluginOperationEntry } from './registry'
/** Only the reviewed native GSVI projection may derive an async deadline from its bound service. */
export function serviceOperationBudget(config: Configuration, entry: PluginOperationEntry) {
  const alias = entry.operation.serviceTimeout
  if (!alias) {
    return undefined
  }
  if (
    entry.bundle.manifest.configurationProjection !== 'gsvi@1' ||
    entry.operation.execution !== 'background' ||
    !entry.instance.grants.includes('service:' + alias)
  ) {
    throw new Error('操作未获受管GSVI服务期限授权')
  }
  const service = config.resources.config.services.find(
    (value) => value.id === entry.instance.services[alias]
  )
  if (!service?.enabled) {
    throw new Error('操作期限所用服务已停用或未绑定')
  }
  return service.timeoutMs
}
