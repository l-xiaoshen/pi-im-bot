import type { Configuration } from '@pi-im-bot/config/load'
import type { Settings } from '@pi-im-bot/settings/schema'
import { namedService, serviceRevision } from '@pi-im-bot/integrations/resources'
export function validateComfyDelivery(
  original: Configuration,
  current: Configuration,
  settings: Settings,
  capability: string
) {
  const entry = original.resources.pluginRegistry(settings).operations.get(capability)
  if (!entry) {
    return
  }
  const aliases = entry.bundle.manifest.connections.filter((connection) => {
    return connection.service === 'comfy@1' && entry.operation.grants.includes('service:' + connection.alias)
  })
  if (!aliases.length) {
    return
  }
  const live = current.resources.config.plugins.find((instance) => {
    return instance.id === entry.instance.id
  })
  if (!live?.enabled) {
    throw new Error('Comfy插件已停用')
  }
  for (const grant of entry.operation.grants) {
    if (!entry.instance.grants.includes(grant) || !live.grants.includes(grant)) {
      throw new Error('Comfy任务所需grant已撤销')
    }
  }
  for (const connection of aliases) {
    const id = entry.instance.services[connection.alias]
    const before = namedService(original, id)
    const now = namedService(current, id)
    if (
      live.services[connection.alias] !== id ||
      !before?.enabled ||
      !now?.enabled ||
      serviceRevision(before) !== serviceRevision(now)
    ) {
      throw new Error('Comfy原服务绑定或执行政策已撤销')
    }
  }
}
