import { readFile, writeFile, rename, unlink, mkdir } from "node:fs/promises"
import { join } from "node:path"
import type { Configuration } from "@pi-im-bot/config/load"
import type { ConfigurationMutations } from "@pi-im-bot/config/mutations"
import { ResourcesConfigSchema, type ResourcesConfig } from "@pi-im-bot/resources/schema"
import { ResourceLibrary } from "@pi-im-bot/resources/library"
import { revision } from "@pi-im-bot/settings/resolve"
import { SettingsEditError } from "@pi-im-bot/settings/editor"
import { PluginInstanceSchema, type PluginInstance } from "./config"
import {
  PluginManagementPatchSchema,
  PluginSettingPlaceholder,
  type PluginEditorView,
  type PluginView
} from "./contracts"
import { importPlugin } from "./package"
import { pluginPaths } from "./runtime/config"
import type { PluginPackage } from "./config"
import { fillConfigDefaults } from "./configuration/values"
import { pluginIssues, resolvePluginConnections } from "./management"
import type { ManagePluginSchema } from "./contracts"
import {
  gsviBusinessValues,
  gsviCoreFields,
  migrateGsviFlat,
  restoreGsviFlat,
  usesGsviConfiguration
} from "@pi-im-bot/integrations/gsvi/plugin-config/definition"
import { GsviConfigurationRefresh } from "@pi-im-bot/integrations/gsvi/plugin-config/refresh"
import { gsviPageValues, saveGsviPage } from "@pi-im-bot/integrations/gsvi/plugin-config/values"
import type { z } from "zod"

export class PluginEditor {
  readonly gsviRefresh: GsviConfigurationRefresh
  constructor(
    readonly configuration: () => Configuration,
    private readonly apply: (resources: ResourceLibrary) => void,
    private readonly mutations: ConfigurationMutations,
    private readonly validate: (resources: ResourceLibrary) => void,
    private readonly usage: (id: string) => string[]
  ) {
    this.gsviRefresh = new GsviConfigurationRefresh(configuration)
  }

  private async file() {
    const text = await readFile(join(this.configuration().configDir, "resources.json"), "utf8")
    return {
      revision: revision({ file: revision(text), packages: this.configuration().resources.pluginPackages }),
      config: ResourcesConfigSchema.parse(JSON.parse(text))
    }
  }

  private library(config: ResourcesConfig) {
    const current = this.configuration().resources
    return new ResourceLibrary(config, current.manifests, current.skillManifests, current.pluginPackages)
  }

  async read(): Promise<PluginEditorView> {
    const file = await this.file()
    const library = this.library(file.config)
    const runtimeEnabled = this.configuration().bot.plugins.enabled
    return {
      revision: file.revision,
      applied: revision(file.config) === revision(this.configuration().resources.config),
      runtimeEnabled,
      plugins: file.config.plugins.map((instance) => {
        const bundle = library.pluginPackage(instance.id)
        let state: PluginView["state"] = "configured"
        if (!runtimeEnabled) {
          state = "runtime-disabled"
        }
        if (!bundle) {
          state = "unimported"
        }
        if (!instance.enabled) {
          state = "disabled"
        }
        let issues: Array<{ path: string; message: string }> = []
        if (bundle) {
          issues = pluginIssues(instance, bundle, library)
          if (issues.length) {
            state = "needs-configuration"
          }
        }
        return {
          ...instance,
          settings: Object.fromEntries(
            Object.keys(instance.settings).map((key) => {
              return [key, PluginSettingPlaceholder]
            })
          ),
          state,
          issues,
          bundle
        }
      })
    }
  }

  save(expected: string, input: PluginInstance, previousId?: string) {
    return this.mutate(expected, (config) => {
      const previous = config.plugins.find((instance) => {
        return instance.id === input.id
      })
      if (previousId && (!previous || previousId !== input.id)) {
        throw new SettingsEditError("插件实例不存在或 ID 已变化")
      }
      if (!previousId && previous) {
        throw new SettingsEditError("插件实例 ID 已存在")
      }
      const settings = Object.fromEntries(
        Object.entries(input.settings).map(([key, value]) => {
          if (value !== PluginSettingPlaceholder) {
            return [key, value]
          }
          if (!previous || !Object.hasOwn(previous.settings, key)) {
            throw new SettingsEditError("插件设置占位没有可保留的值")
          }
          return [key, previous.settings[key]]
        })
      )
      const instance = PluginInstanceSchema.parse({ ...input, settings })
      const bundle = this.configuration().resources.pluginPackage(instance.id)
      if (
        bundle &&
        usesGsviConfiguration(bundle) &&
        gsviCoreFields.some((key) => Object.hasOwn(instance.settings, key))
      ) {
        throw new Error("GSVI连接配置只通过实例configuration入口保存")
      }
      if (bundle?.configuration) {
        instance.settings = gsviBusinessValues(bundle, fillConfigDefaults(bundle.configuration, instance.settings))
      }
      if (bundle) {
        resolvePluginConnections(instance, bundle)
      }
      config.plugins = [
        ...config.plugins.filter((item) => {
          return item.id !== instance.id
        }),
        instance
      ]
    })
  }

  manage(expected: string, id: string, patch: z.infer<typeof ManagePluginSchema>["patch"]) {
    const update = Object.fromEntries(
      Object.entries(PluginManagementPatchSchema.parse(patch)).filter(([_key, value]) => {
        return value !== undefined
      })
    )
    const operation = this.mutate(expected, (config) => {
      const instance = config.plugins.find((entry) => {
        return entry.id === id
      })
      if (!instance) {
        throw new Error("插件实例不存在")
      }
      Object.assign(instance, update)
      const bundle = this.configuration().resources.pluginPackage(id)
      if (bundle) {
        resolvePluginConnections(instance, bundle)
      }
    })
    const bundle = this.configuration().resources.pluginPackage(id)
    if (bundle && usesGsviConfiguration(bundle) && update.enabled !== undefined) {
      return operation.then(async () => {
        this.gsviRefresh.request(id)
        return this.read()
      })
    }
    return operation
  }

  async initializeGsviConfiguration() {
    for (const instance of this.configuration().resources.config.plugins) {
      const bundle = this.configuration().resources.pluginPackage(instance.id)
      if (bundle && usesGsviConfiguration(bundle) && instance.enabled) {
        this.gsviRefresh.request(instance.id)
      }
    }
  }

  remove(expected: string, id: string) {
    const bundle = this.configuration().resources.pluginPackage(id)
    const operation = this.mutate(expected, (config) => {
      const usage = this.usage(id)
      for (const instance of config.plugins) {
        if (instance.id !== id && Object.values(instance.dependencies).includes(id)) {
          usage.push("插件 " + instance.id + " 的依赖")
        }
      }
      if (usage.length > 0) {
        throw new SettingsEditError("插件仍被引用：" + usage.join("、") + "。可先停用或清除引用。")
      }
      config.plugins = config.plugins.filter((item) => {
        return item.id !== id
      })
    })
    if (bundle && usesGsviConfiguration(bundle)) {
      return operation.then((view) => {
        this.gsviRefresh.request(id)
        return view
      })
    }
    return operation
  }

  async import(expected: string, id: string) {
    const file = await this.file()
    if (file.revision !== expected) {
      throw new SettingsEditError("资源配置已变化，请刷新后重试", 409)
    }
    const instance = file.config.plugins.find((item) => {
      return item.id === id
    })
    if (!instance) {
      throw new SettingsEditError("插件实例不存在")
    }
    const current = this.configuration()
    const bundle = await importPlugin(
      instance,
      current.projectDir,
      pluginPaths(current.projectDir, current.bot.plugins).packageDir
    )
    return this.publish(expected, id, bundle)
  }

  publish(expected: string, id: string, bundle: PluginPackage, sourceDir?: string, create?: PluginInstance) {
    const previous = this.configuration().resources.pluginPackage(id)
    const operation = this.mutate(
      expected,
      (config) => {
        if (create) {
          config.plugins.push(create)
        }
        const instance = config.plugins.find((entry) => {
          return entry.id === id
        })
        if (!instance) {
          throw new Error("插件实例不存在")
        }
        instance.release = bundle.revision
        if (sourceDir) {
          instance.sourceDir = sourceDir
        }
        if (bundle.configuration) {
          let values = instance.settings
          if (usesGsviConfiguration(bundle)) {
            values = migrateGsviFlat(values)
          } else if (
            previous &&
            usesGsviConfiguration(previous) &&
            bundle.configuration.voice &&
            bundle.configuration.max_chars &&
            bundle.configuration.probability
          ) {
            values = restoreGsviFlat(values)
          }
          instance.settings = gsviBusinessValues(bundle, fillConfigDefaults(bundle.configuration, values))
          if (usesGsviConfiguration(bundle)) {
            saveGsviPage(config, instance, bundle, gsviPageValues(config, instance, bundle))
          }
        }
        resolvePluginConnections(instance, bundle)
      },
      bundle
    )
    if (usesGsviConfiguration(bundle) || (previous && usesGsviConfiguration(previous))) {
      return operation.then((view) => {
        this.gsviRefresh.request(id)
        return view
      })
    }
    return operation
  }

  mutate(expected: string, change: (config: ResourcesConfig) => void | Promise<void>, bundle?: PluginPackage) {
    return this.mutations.exclusive(async () => {
      const file = await this.file()
      if (file.revision !== expected) {
        throw new SettingsEditError("资源配置已变化，请刷新后重试", 409)
      }
      const previous = new Map(
        file.config.plugins.map((instance) => {
          return [instance.id, revision(instance)]
        })
      )
      const previousInstances = structuredClone(file.config.plugins)
      await change(file.config)
      const config = ResourcesConfigSchema.parse(file.config)
      let library = this.library(config)
      if (bundle) {
        library = new ResourceLibrary(config, library.manifests, library.skillManifests, [
          ...library.pluginPackages.filter((entry) => {
            return entry.instanceId !== bundle.instanceId || entry.revision !== bundle.revision
          }),
          bundle
        ])
      }
      for (const instance of config.plugins) {
        const current = library.pluginPackage(instance.id)
        if (instance.enabled && current && previous.get(instance.id) !== revision(instance)) {
          const issues = pluginIssues(instance, current, library)
          if (issues.length) {
            throw new SettingsEditError(
              issues
                .map((issue) => {
                  return issue.path + "：" + issue.message
                })
                .join("；")
            )
          }
        }
      }
      this.validate(library)
      for (const old of previousInstances) {
        const next = config.plugins.find((instance) => {
          return instance.id === old.id
        })
        if (!next || old.release !== next.release) {
          const directory = join(this.configuration().dataDir, "plugin-config-history", old.id)
          await mkdir(directory, { recursive: true, mode: 0o700 })
          await writeFile(join(directory, Date.now() + "-" + crypto.randomUUID() + ".json"), JSON.stringify(old), {
            mode: 0o600
          })
        }
      }
      if (bundle) {
        library = await library.withPlugin(bundle, this.configuration().dataDir)
      }
      const path = join(this.configuration().configDir, "resources.json")
      const temporary = path + "." + crypto.randomUUID() + ".tmp"
      try {
        await writeFile(temporary, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 })
        if ((await this.file()).revision !== expected) {
          throw new SettingsEditError("资源文件已变化，未覆盖当前内容", 409)
        }
        this.validate(library)
        await rename(temporary, path)
        this.apply(library)
      } finally {
        await unlink(temporary).catch(() => {})
      }
      return this.read()
    })
  }
}
