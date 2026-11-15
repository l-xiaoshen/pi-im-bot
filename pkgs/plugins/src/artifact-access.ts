import { namedService, serviceRevision } from "@pi-im-bot/integrations/resources"
import type { ArtifactAccess } from "@pi-im-bot/artifacts/access"
import type { Configuration } from "@pi-im-bot/config/load"
import { gsviExecutionRevision } from "@pi-im-bot/integrations/gsvi/identity"

/** Persistent dependencies survive Worker completion and Job recovery. */
export function assertArtifactAccess(
  config: Configuration,
  access: ArtifactAccess,
  requireMedia: (id: string) => unknown
) {
  for (const id of access.mediaIds) {
    requireMedia(id)
  }
}

/** New delivery still belongs to its in-flight producer; archived reads only retain source constraints. */
export function assertArtifactDeliveryAccess(
  config: Configuration,
  access: ArtifactAccess,
  requireMedia: (id: string) => unknown
) {
  assertArtifactAccess(config, access, requireMedia)
  const owner = access.plugin
  if (!owner) {
    return
  }
  const instance = config.resources.config.plugins.find((entry) => {
    return entry.id === owner.instanceId
  })
  if (
    !instance?.enabled ||
    owner.grants.some((grant) => {
      return !instance.grants.includes(grant)
    })
  ) {
    throw new Error("产物所需插件授权已撤销")
  }
  for (const [alias, binding] of Object.entries(owner.services)) {
    const current = namedService(config, binding.id)
    if (instance.services[alias] !== binding.id || !current?.enabled || serviceRevision(current) !== binding.revision) {
      throw new Error("产物所需语音服务已变更")
    }
  }
}
