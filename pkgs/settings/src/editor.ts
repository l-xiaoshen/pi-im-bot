import { readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Configuration } from '@pi-im-bot/config/load'
import type { StateStore } from '@pi-im-bot/storage/state'
import type { Room } from '@pi-im-bot/contracts/message'
import type { Conversation } from '@pi-im-bot/conversations/schema'
import { FrameworkConfigSchema, type FrameworkConfig, type SettingsPatch } from './schema'
import { revision, resolveSettings } from './resolve'
import { capabilityIds, isActionCapability } from '@pi-im-bot/permissions/catalog'
import { ConfigurationMutations } from '@pi-im-bot/config/mutations'
import { validateConfigOverride } from '@pi-im-bot/plugins/configuration/values'

export class SettingsEditError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 409 = 400
  ) {
    super(message)
  }
}

export class FrameworkEditor {
  constructor(
    private readonly configuration: () => Configuration,
    private readonly store: Pick<StateStore, keyof StateStore>,
    private readonly apply: (config: FrameworkConfig) => void,
    private readonly mutations = new ConfigurationMutations()
  ) {}

  async read() {
    const content = await readFile(join(this.configuration().configDir, 'framework.json'), 'utf8')
    return { version: revision(content), config: FrameworkConfigSchema.parse(JSON.parse(content)) }
  }

  validate(
    config: FrameworkConfig,
    changedRoom?: Room,
    changedConversation?: Conversation,
    catalog = this.configuration().catalog,
    resources = this.configuration().resources
  ) {
    const providerIds = new Set(
      catalog.config.groups.map((item) => {
        return item.id
      })
    )
    const personaIds = new Set(
      config.personas.map((item) => {
        return item.id
      })
    )
    const capabilities = new Set<string>(capabilityIds())
    function recognizes(id: string) {
      return capabilities.has(id) || resources.recognizes(id)
    }
    const patches: SettingsPatch[] = [
      config.defaults,
      ...config.accounts.map((item) => {
        return item.settings
      })
    ]
    resources.pluginRegistry(config.defaults)
    const definitions = resources.pluginConfigurations()
    function validateOverrides(
      patch: SettingsPatch,
      level: 'instance' | 'account' | 'room' | 'conversation'
    ) {
      for (const [id, values] of Object.entries(patch.extensions?.settings ?? {})) {
        if (definitions[id]) {
          validateConfigOverride(definitions[id], values, level)
        }
      }
    }
    validateOverrides(config.defaults, 'instance')
    for (const account of config.accounts) {
      validateOverrides(account.settings, 'account')
      resources.pluginRegistry(
        resolveSettings(
          config,
          {
            channel: account.channel,
            accountId: account.accountId,
            kind: 'group',
            chatId: 'configuration-preview'
          },
          {},
          {},
          undefined,
          definitions
        ).settings
      )
    }
    for (const room of this.store.listRooms()) {
      let current = room
      if (changedRoom?.id === room.id) {
        current = changedRoom
      }
      patches.push(current.settings)
      validateOverrides(current.settings, 'room')
      for (const conversation of this.store.listConversations(room.id)) {
        let selected = conversation
        if (changedConversation?.id === conversation.id) {
          selected = changedConversation
        }
        patches.push(selected.settings)
        validateOverrides(selected.settings, 'conversation')
        resources.pluginRegistry(
          resolveSettings(
            config,
            current.address,
            current.settings,
            selected.settings,
            undefined,
            definitions
          ).settings
        )
      }
    }
    for (const patch of patches) {
      const personaId = patch.preferences?.personaId
      const group = patch.preferences?.providerGroup
      if (personaId && !personaIds.has(personaId)) {
        throw new SettingsEditError(`人格仍被引用或不存在：${personaId}`)
      }
      if (group && !providerIds.has(group)) {
        throw new SettingsEditError(`模型组不存在：${group}`)
      }
      const selection = patch.resources?.tools
      const ids: string[] = []
      for (const id of patch.resources?.permanentTools ?? []) {
        if (
          !recognizes(id) ||
          id.startsWith('command:') ||
          id.startsWith('hook:') ||
          isActionCapability(id) ||
          id.endsWith('/*')
        ) {
          throw new SettingsEditError(`常驻工具尚未注册：${id}`)
        }
      }
      if (selection?.mode === 'selected') {
        for (const id of selection.ids) {
          if (
            !recognizes(id) ||
            id.startsWith('command:') ||
            id.startsWith('hook:') ||
            isActionCapability(id) ||
            id.endsWith('/*')
          ) {
            throw new SettingsEditError(`工具尚未注册：${id}`)
          }
        }
      }
      for (const rule of patch.permissions?.rules ?? []) {
        ids.push(...rule.capabilities)
      }
      for (const id of ids) {
        if (id !== '*' && !recognizes(id)) {
          throw new SettingsEditError(`能力尚未注册：${id}`)
        }
      }
      if (patch.resources?.mcp?.mode === 'selected') {
        for (const id of patch.resources.mcp.ids) {
          if (
            !resources.config.mcp.some((server) => {
              return server.id === id
            })
          ) {
            throw new SettingsEditError(`MCP 服务未登记：${id}`)
          }
        }
      }
      if (patch.resources?.skills?.mode === 'selected') {
        for (const id of patch.resources.skills.ids) {
          if (
            !resources.config.skills.some((skill) => {
              return skill.id === id
            })
          ) {
            throw new SettingsEditError(`Skill 未登记：${id}`)
          }
        }
      }
      if (patch.resources?.plugins?.mode === 'selected') {
        for (const id of patch.resources.plugins.ids) {
          if (
            !resources.config.plugins.some((instance) => {
              return instance.id === id
            })
          ) {
            throw new SettingsEditError('插件实例未登记：' + id)
          }
        }
      }
    }
  }

  async save(version: string, value: FrameworkConfig, before?: () => void | Promise<void>) {
    const config = FrameworkConfigSchema.parse(value)
    return this.exclusive(async () => {
      await before?.()
      const current = await this.read()
      if (current.version !== version) {
        throw new SettingsEditError('Bot 设置已变化，请刷新后重试，未覆盖当前文件。', 409)
      }
      this.validate(config)
      const path = join(this.configuration().configDir, 'framework.json')
      const temporary = `${path}.${crypto.randomUUID()}.tmp`
      try {
        await writeFile(temporary, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 })
        if ((await this.read()).version !== version) {
          throw new SettingsEditError('配置文件已变化，请刷新后重试。', 409)
        }
        // Scope edits may have occurred while the file was written.
        this.validate(config)
        await rename(temporary, path)
        this.apply(config)
      } finally {
        await unlink(temporary).catch(() => {})
      }
      return this.read()
    })
  }

  async exclusive<T>(operation: () => Promise<T>): Promise<T> {
    return this.mutations.exclusive(operation)
  }
}

export function providerReferences(config: FrameworkConfig, rooms: Room[], conversations: Conversation[]) {
  const result: Record<string, string[]> = {}
  function record(patch: SettingsPatch, label: string) {
    const group = patch.preferences?.providerGroup
    if (group) {
      result[group] ??= []
      result[group].push(label)
    }
  }
  record(config.defaults, 'Bot 默认配置')
  for (const account of config.accounts) {
    record(account.settings, `${account.channel}/${account.accountId}`)
  }
  for (const room of rooms) {
    record(room.settings, room.name)
  }
  for (const conversation of conversations) {
    record(conversation.settings, `对话 ${conversation.title}`)
  }
  return result
}
