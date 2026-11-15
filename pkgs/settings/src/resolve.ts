import { createHash } from 'node:crypto'
import type { BotConfig } from '@pi-im-bot/config/schema'
import type { Address } from '@pi-im-bot/contracts/message'
import type { ConfigDefinition } from '@pi-im-bot/plugins/configuration/schema'
import { mergeConfig } from '@pi-im-bot/plugins/configuration/values'
import {
  FrameworkConfigSchema,
  SettingsSchema,
  type EffectiveSettings,
  type FrameworkConfig,
  type Settings,
  type SettingsPatch
} from './schema'

export function revision(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

export function initialFramework(bot: BotConfig, providerGroup: string): FrameworkConfig {
  return FrameworkConfigSchema.parse({
    defaults: {
      preferences: { providerGroup },
      behavior: { timeoutMs: bot.agent.timeoutMs, maxModelCalls: bot.agent.maxModelCalls }
    },
    personas: [{ id: 'default', name: '默认人格', prompt: bot.agent.systemPrompt }]
  })
}

export function resolveSettings(
  framework: FrameworkConfig,
  address: Address,
  scope: SettingsPatch,
  conversation: SettingsPatch = {},
  child?: SettingsPatch,
  pluginConfigurations: Record<string, ConfigDefinition> = {}
): EffectiveSettings {
  const account = framework.accounts.find((item) => {
    return item.channel === address.channel && item.accountId === address.accountId
  })
  const sources: Record<string, string> = {}
  const settings = SettingsSchema.parse(framework.defaults)
  const layers = [
    { source: '默认', patch: framework.defaults },
    { source: '账号', patch: account?.settings ?? {} },
    { source: '聊天范围', patch: scope },
    { source: '当前对话', patch: conversation }
  ]
  if (child) {
    layers.push({ source: '任务对话', patch: child })
  }
  for (const layer of layers) {
    mergeSection(settings, layer.patch, 'data', layer.source, sources)
    mergeSection(settings, layer.patch, 'preferences', layer.source, sources)
    mergeSection(settings, layer.patch, 'behavior', layer.source, sources)
    mergeSection(settings, layer.patch, 'output', layer.source, sources)
    mergeSection(settings, layer.patch, 'resources', layer.source, sources)
    const previousExtensions = structuredClone(settings.extensions)
    mergeSection(settings, layer.patch, 'extensions', layer.source, sources)
    if (layer.patch.extensions) {
      settings.extensions.priorities = {
        ...previousExtensions.priorities,
        ...layer.patch.extensions.priorities
      }
      settings.extensions.disabled = { ...previousExtensions.disabled, ...layer.patch.extensions.disabled }
      settings.extensions.settings = previousExtensions.settings
      for (const [id, patch] of Object.entries(layer.patch.extensions.settings ?? {})) {
        settings.extensions.settings[id] = mergeConfig(
          previousExtensions.settings[id] ?? {},
          patch,
          pluginConfigurations[id]
        )
      }
    }
    if (layer.patch.permissions) {
      settings.permissions = structuredClone(layer.patch.permissions)
      sources.permissions = layer.source
    }
  }
  const persona = framework.personas.find((item) => {
    return item.id === settings.preferences.personaId
  })
  if (!persona) {
    throw new Error(`人格不存在：${settings.preferences.personaId}`)
  }
  const pinnedPersona = { ...persona, revision: revision(persona) }
  return {
    settings,
    persona: pinnedPersona,
    sources,
    revision: revision({ settings, persona: pinnedPersona })
  }
}

function mergeSection<K extends Exclude<keyof Settings, 'permissions'>>(
  target: Settings,
  patch: SettingsPatch,
  key: K,
  source: string,
  sources: Record<string, string>
) {
  const section = patch[key]
  if (!section) {
    return
  }
  Object.assign(target[key], structuredClone(section))
  for (const field of Object.keys(section)) {
    sources[`${key}.${field}`] = source
  }
}
