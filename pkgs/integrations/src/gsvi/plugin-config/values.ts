import { z } from "zod"
import { GsviServiceSchema, GsviNativeHeadersSchema, GsviUrlSchema } from "../schema"
import type { ResourcesConfig } from "@pi-im-bot/resources/schema"
import type { PluginInstance, PluginPackage } from "@pi-im-bot/plugins/config"
import { fillConfigDefaults } from "@pi-im-bot/plugins/configuration/values"
import { gsviBusinessValues, usesGsviConfiguration } from "./definition"
import type { ConfigValues } from "@pi-im-bot/plugins/configuration/schema"
import { createHash } from "node:crypto"
const HeaderJsonSchema = z
  .string()
  .transform((text, context) => {
    try {
      if (text === "") {
        return {}
      }
      return JSON.parse(text) as unknown
    } catch {
      context.addIssue({ code: "custom", message: "Header需要JSON字符串对象" })
      return z.NEVER
    }
  })
  .pipe(GsviNativeHeadersSchema)
export const GsviPageSchema = z
  .object({
    api_base: GsviUrlSchema,
    api_key: z
      .string()
      .refine((value) => {
        return !/[\r\n]/u.test(value)
      })
      .default(""),
    request_headers: HeaderJsonSchema.prefault("{}"),
    download_headers: HeaderJsonSchema.prefault("{}"),
    timeout_ms: z.number().int().min(1000),
    refresh_voices: z.boolean(),
    version: z.enum(["v1", "v2", "v4"]),
    text_lang: z.string().min(1),
    emotion: z.string().min(1),
    prompt_text_lang: z.string(),
    preset: z
      .object({
        voice: z.string().min(1),
        max_chars: z.number().int().positive(),
        probability: z.number().int().min(0).max(100)
      })
      .strict()
  })
  .strict()
export function gsviPageValues(config: ResourcesConfig, instance: PluginInstance, bundle: PluginPackage): ConfigValues {
  for (const [key, type, secret] of [
    ["api_base", "string", false],
    ["api_key", "string", true],
    ["request_headers", "string", true],
    ["download_headers", "string", true],
    ["timeout_ms", "int", false],
    ["refresh_voices", "bool", false]
  ] as const) {
    const field = bundle.configuration?.[key]
    if (
      !field ||
      field.type !== type ||
      field.secret !== secret ||
      field.scope.length !== 1 ||
      field.scope[0] !== "instance"
    ) {
      throw new Error("GSVI配置投影字段声明不正确：" + key)
    }
  }
  const values = fillConfigDefaults(bundle.configuration ?? {}, instance.settings)
  const service = config.services.find((entry) => entry.id === instance.services.speech)
  if (service) {
    values.api_base = service.url
    values.api_key = service.apiKey ?? ""
    values.request_headers = JSON.stringify(service.nativeRequestHeaders ?? service.headers)
    values.download_headers = JSON.stringify(service.nativeDownloadHeaders ?? service.downloadHeaders)
    values.timeout_ms = service.timeoutMs
  }
  values.refresh_voices = false
  return values
}
export function saveGsviPage(
  config: ResourcesConfig,
  instance: PluginInstance,
  bundle: PluginPackage,
  values: ConfigValues
) {
  const parsed = GsviPageSchema.parse(values)
  const old = config.services.find((entry) => entry.id === instance.services.speech)
  let id = instance.services.speech
  // A shared binding must not let one plugin configuration silently replace another instance's service.
  if (!id || config.plugins.some((entry) => entry.id !== instance.id && Object.values(entry.services).includes(id))) {
    const prefix = "gsvi-" + createHash("sha256").update(instance.id).digest("hex").slice(0, 20)
    id = prefix
    let suffix = 0
    while (config.services.some((entry) => entry.id === id)) {
      suffix += 1
      id = prefix + "-" + suffix
    }
  }
  const service = GsviServiceSchema.parse({
    ...old,
    id,
    name: old?.name ?? instance.name + " GSVI",
    kind: "gsvi",
    enabled: true,
    url: parsed.api_base,
    apiKey: parsed.api_key,
    headers: {},
    downloadHeaders: {},
    nativeRequestHeaders: parsed.request_headers,
    nativeDownloadHeaders: parsed.download_headers,
    timeoutMs: parsed.timeout_ms,
    sourceCompatibleDownloads: true,
    maxAudioBytes: undefined
  })
  config.services = [...config.services.filter((entry) => entry.id !== id), service]
  instance.services.speech = id
  instance.settings = gsviBusinessValues(bundle, { ...values, refresh_voices: false })
  return parsed.refresh_voices
}
