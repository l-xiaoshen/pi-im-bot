import { join } from 'node:path'
import { mkdir, rename, unlink } from 'node:fs/promises'
import { McpCatalogFileSchema, type McpManifest } from './mcp/schema'
import { ResourcesConfigSchema, type ResourcesConfig } from './schema'
import { mcpCapabilityId, mcpServerRevision, mcpToolName, mcpToolRevision } from './mcp/identity'
import { builtinCapabilities } from '@pi-im-bot/permissions/catalog'
import type { Settings } from '@pi-im-bot/settings/schema'
import { SkillCatalogFileSchema, type SkillManifest } from './skills/schema'
import { skillConfigRevision, skillCapabilityId } from './skills/package'
import { revision } from '@pi-im-bot/settings/resolve'
import { mcpToolAvailable } from './mcp/tasks'
import { PluginCatalogSchema, type PluginPackage } from '@pi-im-bot/plugins/config'
import {
  pluginSourceRevision,
  pluginOperationId,
  pluginCommandId,
  pluginHookId
} from '@pi-im-bot/plugins/identity'
import { PluginRegistry } from '@pi-im-bot/plugins/registry'
import { gsviWorkerDefinition } from '@pi-im-bot/integrations/gsvi/plugin-config/definition'
import { pluginIssues } from '@pi-im-bot/plugins/management'

export class ResourceLibrary {
  constructor(
    readonly config: ResourcesConfig,
    readonly manifests: readonly McpManifest[],
    readonly skillManifests: readonly SkillManifest[] = [],
    readonly pluginPackages: readonly PluginPackage[] = []
  ) {}

  static empty() {
    return new ResourceLibrary(ResourcesConfigSchema.parse({}), [])
  }

  static async load(config: ResourcesConfig, dataDir: string) {
    const file = Bun.file(join(dataDir, 'resources/mcp-catalog.json'))
    let manifests: McpManifest[] = []
    if (await file.exists()) {
      manifests = McpCatalogFileSchema.parse(await file.json()).manifests
    }
    const skills = Bun.file(join(dataDir, 'resources/skill-catalog.json'))
    let skillManifests: SkillManifest[] = []
    if (await skills.exists()) {
      skillManifests = SkillCatalogFileSchema.parse(await skills.json()).manifests
    }
    const plugins = Bun.file(join(dataDir, 'resources/plugin-catalog.json'))
    let pluginPackages: PluginPackage[] = []
    if (await plugins.exists()) {
      pluginPackages = PluginCatalogSchema.parse(await plugins.json()).packages
    }
    return new ResourceLibrary(config, manifests, skillManifests, pluginPackages)
  }

  manifest(id: string) {
    const server = this.config.mcp.find((item) => {
      return item.id === id
    })
    if (!server) {
      return undefined
    }
    return this.manifests.find((item) => {
      return item.serverId === id && item.configRevision === mcpServerRevision(server)
    })
  }

  mcpTools(settings?: Settings) {
    return this.config.mcp.flatMap((server) => {
      if (!server.enabled) {
        return []
      }
      if (settings?.resources.mcp.mode === 'selected' && !settings.resources.mcp.ids.includes(server.id)) {
        return []
      }
      return (this.manifest(server.id)?.tools ?? [])
        .filter((tool) => {
          return mcpToolAvailable(server, tool, this.manifest(server.id))
        })
        .map((tool) => {
          return {
            id: mcpCapabilityId(server.id, tool.name),
            name: mcpToolName(server.id, tool.name),
            server,
            tool
          }
        })
    })
  }

  capabilityIds(settings?: Settings) {
    return [
      ...builtinCapabilities.map((item) => {
        return item.id
      }),
      ...this.mcpTools(settings).map((item) => {
        return item.id
      }),
      ...this.skills(settings).map((item) => {
        return skillCapabilityId(item.id)
      }),
      ...this.plugins(settings).flatMap(({ instance, bundle }) => {
        return [
          ...bundle.manifest.operations.map((operation) => {
            return pluginOperationId(instance.id, operation.id)
          }),
          ...bundle.manifest.commands.map((command) => {
            return pluginCommandId(instance.id, command.id)
          }),
          ...bundle.manifest.hooks
            .filter((hook) => {
              return !settings?.extensions.disabled[instance.id + '/' + hook.id]
            })
            .map((hook) => {
              return pluginHookId(instance.id, hook.id)
            })
        ]
      })
    ]
  }

  capabilityRevisions(settings: Settings) {
    const result: Record<string, string> = {}
    for (const entry of this.mcpTools(settings)) {
      result[entry.id] = revision({
        server: mcpServerRevision(entry.server),
        tool: mcpToolRevision(entry.tool)
      })
    }
    for (const manifest of this.skills(settings)) {
      result[skillCapabilityId(manifest.id)] = manifest.revision
    }
    for (const { instance, bundle } of this.plugins(settings)) {
      for (const operation of bundle.manifest.operations) {
        result[pluginOperationId(instance.id, operation.id)] = revision({ bundle: bundle.revision, instance })
      }
      for (const command of bundle.manifest.commands) {
        result[pluginCommandId(instance.id, command.id)] = revision({ bundle: bundle.revision, instance })
      }
      for (const hook of bundle.manifest.hooks) {
        result[pluginHookId(instance.id, hook.id)] = revision({ bundle: bundle.revision, instance, hook })
      }
    }
    return result
  }

  async withManifest(manifest: McpManifest, dataDir: string) {
    const manifests = [
      ...this.manifests.filter((item) => {
        return item.serverId !== manifest.serverId
      }),
      manifest
    ]
    const directory = join(dataDir, 'resources')
    await mkdir(directory, { recursive: true })
    const path = join(directory, 'mcp-catalog.json')
    const temporary = path + '.' + crypto.randomUUID() + '.tmp'
    try {
      await Bun.write(temporary, JSON.stringify({ manifests }, null, 2) + '\n')
      await rename(temporary, path)
    } finally {
      await unlink(temporary).catch(() => {})
    }
    return new ResourceLibrary(this.config, manifests, this.skillManifests, this.pluginPackages)
  }

  recognizes(id: string) {
    if (
      this.config.plugins.some((plugin) => {
        return (
          id.startsWith(`plugin:${plugin.id}/`) ||
          id.startsWith(`command:plugin:${plugin.id}/`) ||
          id.startsWith(`hook:plugin:${plugin.id}/`)
        )
      })
    ) {
      return true
    }
    if (
      builtinCapabilities.some((item) => {
        return item.id === id
      })
    ) {
      return true
    }
    if (
      this.config.skills.some((skill) => {
        return id === skillCapabilityId(skill.id)
      })
    ) {
      return true
    }
    return this.config.mcp.some((server) => {
      return id.startsWith(`mcp:${server.id}/`) && id.length > server.id.length + 5
    })
  }

  publicCapabilities() {
    const mcp = this.config.mcp.flatMap((server) => {
      return (this.manifest(server.id)?.tools ?? []).map((tool) => {
        return {
          id: mcpCapabilityId(server.id, tool.name),
          name: `${server.name} / ${tool.title ?? tool.name}`,
          kind: 'tool' as const
        }
      })
    })
    const skills = this.config.skills.map((skill) => {
      return { id: skillCapabilityId(skill.id), name: skill.name, kind: 'tool' as const }
    })
    const plugins = this.config.plugins.flatMap((instance) => {
      const bundle = this.pluginPackage(instance.id)
      if (!bundle) {
        return []
      }
      return [
        ...bundle.manifest.operations.map((operation) => {
          return {
            id: pluginOperationId(instance.id, operation.id),
            name: instance.name + ' / ' + operation.title,
            kind: 'tool' as const
          }
        }),
        ...bundle.manifest.commands.map((command) => {
          return {
            id: pluginCommandId(instance.id, command.id),
            name: instance.name + ' / ' + command.names.join('、'),
            kind: 'command' as const
          }
        }),
        ...bundle.manifest.hooks.map((hook) => {
          return {
            id: pluginHookId(instance.id, hook.id),
            name: instance.name + ' / ' + hook.id + ' → ' + hook.point,
            kind: 'hook' as const
          }
        })
      ]
    })
    return [...builtinCapabilities, ...mcp, ...skills, ...plugins]
  }

  skillManifest(id: string) {
    const config = this.config.skills.find((item) => {
      return item.id === id
    })
    if (!config) {
      return undefined
    }
    return this.skillManifests.find((item) => {
      return item.id === id && item.configRevision === skillConfigRevision(config)
    })
  }

  skills(settings?: Settings) {
    return this.config.skills.flatMap((config) => {
      if (!config.enabled) {
        return []
      }
      if (
        settings?.resources.skills.mode === 'selected' &&
        !settings.resources.skills.ids.includes(config.id)
      ) {
        return []
      }
      const manifest = this.skillManifest(config.id)
      if (!manifest) {
        return []
      }
      return [manifest]
    })
  }

  async withSkill(manifest: SkillManifest, dataDir: string) {
    const manifests = [
      ...this.skillManifests.filter((item) => {
        return item.id !== manifest.id
      }),
      manifest
    ]
    const directory = join(dataDir, 'resources')
    await mkdir(directory, { recursive: true })
    const path = join(directory, 'skill-catalog.json')
    const temporary = path + '.' + crypto.randomUUID() + '.tmp'
    try {
      await Bun.write(temporary, JSON.stringify({ manifests }, null, 2) + '\n')
      await rename(temporary, path)
    } finally {
      await unlink(temporary).catch(() => {})
    }
    return new ResourceLibrary(this.config, this.manifests, manifests, this.pluginPackages)
  }

  pluginPackage(id: string) {
    const instance = this.config.plugins.find((plugin) => {
      return plugin.id === id
    })
    if (!instance) {
      return undefined
    }
    return this.pluginPackages.find((bundle) => {
      if (instance.release) {
        return bundle.instanceId === id && bundle.revision === instance.release
      }
      return bundle.instanceId === id && bundle.configRevision === pluginSourceRevision(instance)
    })
  }
  plugins(settings?: Settings) {
    return this.config.plugins.flatMap((instance) => {
      if (!instance.enabled) {
        return []
      }
      if (
        settings?.resources.plugins.mode === 'selected' &&
        !settings.resources.plugins.ids.includes(instance.id)
      ) {
        return []
      }
      const bundle = this.pluginPackage(instance.id)
      if (!bundle) {
        return []
      }
      if (pluginIssues(instance, bundle, this).length) {
        return []
      }
      return [{ instance, bundle }]
    })
  }
  pluginRegistry(settings: Settings) {
    return new PluginRegistry(this.plugins(settings), settings.extensions)
  }
  pluginConfigurations() {
    return Object.fromEntries(
      this.config.plugins.flatMap((instance) => {
        const bundle = this.pluginPackage(instance.id)
        const definition = bundle && gsviWorkerDefinition(bundle)
        if (!definition) {
          return []
        }
        return [[instance.id, definition]]
      })
    )
  }
  async withPlugin(bundle: PluginPackage, dataDir: string) {
    const packages = [
      ...this.pluginPackages.filter((entry) => {
        return entry.instanceId !== bundle.instanceId || entry.revision !== bundle.revision
      }),
      bundle
    ]
    const directory = join(dataDir, 'resources')
    await mkdir(directory, { recursive: true })
    const path = join(directory, 'plugin-catalog.json')
    const temporary = path + '.' + crypto.randomUUID() + '.tmp'
    try {
      await Bun.write(temporary, JSON.stringify({ packages }, null, 2) + '\n', { mode: 0o600 })
      await rename(temporary, path)
    } finally {
      await unlink(temporary).catch(() => {})
    }
    return new ResourceLibrary(this.config, this.manifests, this.skillManifests, packages)
  }
}
