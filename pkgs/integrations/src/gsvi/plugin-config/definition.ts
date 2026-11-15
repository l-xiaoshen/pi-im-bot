import type { PluginPackage } from "@pi-im-bot/plugins/config"
import type { ConfigDefinition, ConfigValues } from "@pi-im-bot/plugins/configuration/schema"
export const gsviCoreFields = [
  "api_base",
  "api_key",
  "request_headers",
  "download_headers",
  "timeout_ms",
  "refresh_voices"
] as const
export function usesGsviConfiguration(bundle: PluginPackage) {
  return bundle.manifest.configurationProjection === "gsvi@1"
}
export function gsviWorkerDefinition(bundle: PluginPackage): ConfigDefinition | undefined {
  if (!usesGsviConfiguration(bundle)) {
    return bundle.configuration
  }
  return Object.fromEntries(
    Object.entries(bundle.configuration ?? {}).filter(([key]) => {
      return !gsviCoreFields.some((field) => field === key)
    })
  )
}
export function gsviBusinessValues(bundle: PluginPackage, values: ConfigValues) {
  if (!usesGsviConfiguration(bundle)) {
    return values
  }
  return Object.fromEntries(
    Object.entries(values).filter(([key]) => {
      return !gsviCoreFields.some((field) => field === key)
    })
  )
}
