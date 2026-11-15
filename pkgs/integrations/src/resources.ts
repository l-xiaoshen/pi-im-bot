import type { Configuration } from "@pi-im-bot/config/load"
import { gsviExecutionRevision } from "./gsvi/identity"
import { comfyRevision, type ComfyService } from "./comfy/resources"
import type { GsviService } from "./gsvi/schema"
export function namedService(config: Configuration, id: string) {
  return (
    config.resources.config.services.find((entry) => {
      return entry.id === id
    }) ??
    config.resources.config.comfyServices.find((entry) => {
      return entry.id === id
    })
  )
}
export function serviceRevision(service: GsviService | ComfyService) {
  if (service.kind === "comfy") {
    return comfyRevision(service)
  }
  return gsviExecutionRevision(service)
}
