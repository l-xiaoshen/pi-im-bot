import type { PluginEditor } from "../editor"
import type { FrameworkEditor } from "@pi-im-bot/settings/editor"
import { SettingsEditError } from "@pi-im-bot/settings/editor"
import type { Coordinator } from "@pi-im-bot/runtime/coordinator"
import type { SettingsPatch } from "@pi-im-bot/settings/schema"
import { revision } from "@pi-im-bot/settings/resolve"
import {
  fillConfigDefaults,
  mergeConfig,
  validateConfig,
  validateConfigOverride,
  configIssues,
  validateConfigReadonly,
  pruneConfigOverride
} from "./values"
import { publicConfig, applyConfigSecrets } from "./secrets"
import { ConfigValuesSchema, type ConfigValues } from "./schema"
import { configResourceChoices, validateConfigResources } from "./resources"
import { resolvePluginConnections, pluginConnections } from "../management"
import type { PluginConfigTarget, PluginConfigView, SavePluginConfigSchema } from "./contracts"
import type { z } from "zod"
import { usesGsviConfiguration, gsviWorkerDefinition } from "@pi-im-bot/integrations/gsvi/plugin-config/definition"
import { gsviPageValues, saveGsviPage, GsviPageSchema } from "@pi-im-bot/integrations/gsvi/plugin-config/values"
import { gsviChoiceState } from "@pi-im-bot/integrations/gsvi/plugin-config/cache"

export class PluginConfigurationEditor {
  constructor(
    readonly plugins: PluginEditor,
    readonly framework: FrameworkEditor,
    readonly coordinator: Coordinator
  ) {}

  async prepare(id: string, target: PluginConfigTarget) {
    const config = this.plugins.configuration()
    const instance = config.resources.config.plugins.find((entry) => {
      return entry.id === id
    })
    const bundle = config.resources.pluginPackage(id)
    if (!instance || !bundle) {
      throw new Error("请先安装插件的固定版本")
    }
    let definition = bundle.configuration
    if (usesGsviConfiguration(bundle) && target.level !== "instance") {
      definition = gsviWorkerDefinition(bundle)
    }
    const resourceView = await this.plugins.read()
    const frameworkView = await this.framework.read()
    let current: ConfigValues = instance.settings
    if (usesGsviConfiguration(bundle) && target.level === "instance") {
      current = gsviPageValues(config.resources.config, instance, bundle)
    }
    let inherited: ConfigValues = {}
    let version: string | number = resourceView.revision
    let patch: SettingsPatch = {}
    const framework = frameworkView.config
    if (target.level !== "instance") {
      inherited = structuredClone(instance.settings)
      inherited = mergeConfig(inherited, framework.defaults.extensions.settings[id] ?? {}, definition)
      let channel = ""
      let accountId = ""
      if (target.level === "account") {
        channel = target.channel
        accountId = target.accountId
      } else {
        const room = this.coordinator.requireRoom(target.roomId)
        channel = room.address.channel
        accountId = room.address.accountId
      }
      const account = framework.accounts.find((entry) => {
        return entry.channel === channel && entry.accountId === accountId
      })
      patch = account?.settings ?? {}
      version = frameworkView.version
      if (target.level !== "account") {
        inherited = mergeConfig(inherited, patch.extensions?.settings?.[id] ?? {}, definition)
        const room = this.coordinator.requireRoom(target.roomId)
        patch = room.settings
        version = room.revision
        if (target.level === "conversation") {
          inherited = mergeConfig(inherited, patch.extensions?.settings?.[id] ?? {}, definition)
          const conversation = this.coordinator.conversations.require(target.conversationId, target.roomId)
          patch = conversation.settings
          version = conversation.revision
        }
      }
      current = patch.extensions?.settings?.[id] ?? {}
    }
    const targets: PluginConfigView["targets"] = [{ name: "实例默认配置", target: { level: "instance" } }]
    const accounts = new Map(
      framework.accounts.map((entry) => {
        return [
          JSON.stringify([entry.channel, entry.accountId]),
          { channel: entry.channel, accountId: entry.accountId }
        ]
      })
    )
    for (const room of this.coordinator.store.listRooms()) {
      accounts.set(JSON.stringify([room.address.channel, room.address.accountId]), {
        channel: room.address.channel,
        accountId: room.address.accountId
      })
      targets.push({ name: room.name, target: { level: "room", roomId: room.id } })
      for (const conversation of this.coordinator.store.listConversations(room.id)) {
        if (!conversation.parentId) {
          targets.push({
            name: room.name + " / " + conversation.title,
            target: { level: "conversation", roomId: room.id, conversationId: conversation.id }
          })
        }
      }
    }
    for (const account of accounts.values()) {
      targets.push({
        name: account.channel + " · " + account.accountId,
        target: { level: "account", ...account }
      })
    }
    const token = revision({
      resources: resourceView.revision,
      framework: frameworkView.version,
      providers: revision(config.catalog.config),
      version,
      target
    })
    return {
      config,
      instance,
      bundle,
      definition,
      current,
      inherited,
      token,
      patch,
      frameworkView,
      resourceView,
      targets
    }
  }

  async read(id: string, target: PluginConfigTarget): Promise<PluginConfigView> {
    const state = await this.prepare(id, target)
    const { definition, current, inherited } = state
    let projected = { values: {} as ConfigValues, secrets: [] as PluginConfigView["secrets"] }
    let lower: ConfigValues = {}
    let issues: PluginConfigView["issues"] = []
    if (definition) {
      projected = publicConfig(definition, current)
      lower = publicConfig(definition, inherited).values
      issues = configIssues(definition, mergeConfig(inherited, current, definition))
    }
    let gsviConfiguration: PluginConfigView["gsviConfiguration"]
    if (
      state.bundle.manifest.connections.some(
        (connection) => connection.kind === "service" && connection.service === "gsvi@1"
      )
    ) {
      gsviConfiguration = {
        projectionSupported: true,
        inlinePresentationContract: "tool-send@1",
        runtimeContract: "gsvi-plugin@1",
        projectionActive: usesGsviConfiguration(state.bundle),
        refreshDisabled: !state.instance.enabled || !state.config.bot.plugins.enabled,
        ...(await gsviChoiceState(state.config, id))
      }
    }
    return {
      revision: state.token,
      release: state.bundle.revision,
      target,
      targets: state.targets,
      definition,
      values: projected.values,
      inherited: lower,
      secrets: projected.secrets,
      issues,
      gsviConfiguration,
      choices: configResourceChoices(state.config),
      bindings: pluginConnections(state.bundle)
        .filter(() => {
          return !usesGsviConfiguration(state.bundle)
        })
        .filter((connection) => {
          return target.level === "instance" && !connection.setting
        })
        .map((connection) => {
          let choices = state.config.resources.config.mcp.map((entry) => {
            return { id: entry.id, name: entry.name, enabled: entry.enabled }
          })
          let mapping = state.instance.connectors
          if (connection.kind === "plugin") {
            choices = state.config.resources.config.plugins
              .filter((entry) => {
                return entry.id !== id
              })
              .map((entry) => {
                return { id: entry.id, name: entry.name, enabled: entry.enabled }
              })
            mapping = state.instance.dependencies
          }
          if (connection.kind === "service") {
            let services: Array<{ id: string; name: string; enabled: boolean }> = state.config.resources.config.services
            if (connection.service === "comfy@1") {
              services = state.config.resources.config.comfyServices.map((entry) => {
                return { id: entry.id, name: entry.name, enabled: entry.enabled, contract: "comfy@1" }
              })
            }
            choices = services.map((entry) => {
              return { id: entry.id, name: entry.name, enabled: entry.enabled }
            })
            mapping = state.instance.services
          }
          return {
            alias: connection.alias,
            title: connection.title,
            kind: connection.kind,
            required: connection.required,
            value: mapping[connection.alias] ?? "",
            choices
          }
        })
    }
  }

  async save(id: string, input: z.infer<typeof SavePluginConfigSchema>) {
    const initial = await this.prepare(id, input.target)
    const assertCurrent = async () => {
      const current = await this.prepare(id, input.target)
      if (current.token !== input.revision || current.bundle.revision !== input.release) {
        throw new SettingsEditError("插件版本或配置已变化，请刷新后重试", 409)
      }
      return current
    }
    if (input.target.level === "instance") {
      await this.plugins.mutate(initial.resourceView.revision, async (config) => {
        const state = await assertCurrent()
        if (usesGsviConfiguration(state.bundle) && Object.keys(input.services ?? {}).length) {
          throw new Error("GSVI连接通过本页原生字段保存，不另改服务映射")
        }
        const instance = config.plugins.find((entry) => {
          return entry.id === id
        })!
        if (state.definition) {
          const values = fillConfigDefaults(
            state.definition,
            applyConfigSecrets(state.definition, input.values, state.current, input.secrets)
          )
          validateConfig(state.definition, values)
          validateConfigReadonly(state.definition, instance.settings, values)
          validateConfigResources(state.definition, values, state.config)
          if (usesGsviConfiguration(state.bundle)) {
            GsviPageSchema.parse(values)
            saveGsviPage(config, instance, state.bundle, values)
          } else {
            instance.settings = values
          }
        } else if (Object.keys(input.values).length || input.secrets.length) {
          throw new Error("插件没有声明可视化配置字段")
        }
        for (const [kind, values] of [
          ["service", input.services],
          ["mcp", input.connectors],
          ["plugin", input.dependencies]
        ] as const) {
          if (!values) {
            continue
          }
          let mapping = instance.connectors
          if (kind === "plugin") {
            mapping = instance.dependencies
          }
          if (kind === "service") {
            mapping = instance.services
          }
          for (const [alias, value] of Object.entries(values)) {
            if (
              !pluginConnections(state.bundle).some((entry) => {
                return entry.kind === kind && entry.alias === alias && !entry.setting
              })
            ) {
              throw new Error("不能修改未声明的服务绑定：" + alias)
            }
            if (value) {
              mapping[alias] = value
            } else {
              delete mapping[alias]
            }
          }
        }
        resolvePluginConnections(instance, state.bundle)
      })
    } else {
      const state = await assertCurrent()
      if (!state.definition) {
        throw new Error("插件没有声明可视化配置")
      }
      if (input.secrets.length) {
        throw new Error("秘密字段只能在实例配置中修改")
      }
      validateConfigOverride(state.definition, input.values, input.target.level)
      validateConfig(state.definition, mergeConfig(state.inherited, input.values, state.definition))
      validateConfigResources(state.definition, input.values, state.config)
      const patch = structuredClone(state.patch)
      patch.extensions ??= {}
      patch.extensions.settings ??= {}
      const overrides = pruneConfigOverride(state.definition, ConfigValuesSchema.parse(input.values))
      if (Object.keys(overrides).length) {
        patch.extensions.settings[id] = overrides
      } else {
        delete patch.extensions.settings[id]
      }
      const target = input.target
      if (target.level === "account") {
        const value = structuredClone(state.frameworkView.config)
        let account = value.accounts.find((entry) => {
          return entry.channel === target.channel && entry.accountId === target.accountId
        })
        if (!account) {
          account = { channel: target.channel, accountId: target.accountId, settings: {} }
          value.accounts.push(account)
        }
        account.settings = patch
        await this.framework.save(state.frameworkView.version, value, async () => {
          await assertCurrent()
        })
      } else {
        await this.framework.exclusive(async () => {
          await assertCurrent()
          if (target.level === "room") {
            const room = this.coordinator.requireRoom(target.roomId)
            const next = { ...room, settings: patch, revision: room.revision + 1, updatedAt: Date.now() }
            this.framework.validate(state.frameworkView.config, next)
            this.coordinator.store.saveRoom(next)
          } else {
            const conversation = this.coordinator.conversations.require(target.conversationId, target.roomId)
            const next = {
              ...conversation,
              settings: patch,
              revision: conversation.revision + 1,
              updatedAt: Date.now()
            }
            this.framework.validate(state.frameworkView.config, undefined, next)
            this.coordinator.store.saveConversation(next)
          }
        })
      }
    }
    if (usesGsviConfiguration(initial.bundle) && input.target.level === "instance") {
      this.plugins.gsviRefresh.request(id)
    }
    return this.read(id, input.target)
  }
}
