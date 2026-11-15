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
/** One-time shape migration at publication, never in the Worker. Scope overrides use the reviewed upgrade script. */
export function migrateGsviFlat(values: ConfigValues): ConfigValues {
  const next = structuredClone(values)
  if (!["voice", "max_chars", "probability"].some((key) => Object.hasOwn(next, key))) {
    return next
  }
  const preset: ConfigValues = {}
  if (next.preset) {
    Object.assign(preset, next.preset)
  }
  for (const key of ["voice", "max_chars", "probability"]) {
    if (!Object.hasOwn(preset, key) && next[key] !== undefined) {
      preset[key] = next[key]
    }
    delete next[key]
  }
  next.preset = preset
  return next
}

/** Release rollback only. Runtime always consumes the selected release's single shape. */
export function restoreGsviFlat(values: ConfigValues): ConfigValues {
  const next = structuredClone(values)
  if (next.preset && typeof next.preset === "object" && !Array.isArray(next.preset)) {
    for (const key of ["voice", "max_chars", "probability"]) {
      if (next.preset[key] !== undefined) {
        next[key] = next.preset[key]
      }
    }
  }
  delete next.preset
  return next
}
