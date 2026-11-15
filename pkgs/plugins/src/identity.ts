import { revision } from "@pi-im-bot/settings/resolve"
import type { PluginInstance } from "./config"

export function pluginSourceRevision(instance: PluginInstance) {
  return revision({ id: instance.id, sourceDir: instance.sourceDir })
}
export function pluginOperationId(instance: string, operation: string) {
  return `plugin:${instance}/${operation}`
}
export function pluginCommandId(instance: string, command: string) {
  return `command:plugin:${instance}/${command}`
}
export function pluginHookId(instance: string, handler: string) {
  return `hook:plugin:${instance}/${handler}`
}
export function pluginToolName(instance: string, operation: string) {
  return (
    ("plugin__" + instance.replaceAll("-", "_") + "__" + operation.replaceAll("-", "_")).slice(0, 52) +
    "_" +
    revision([instance, operation]).slice(0, 10)
  )
}
