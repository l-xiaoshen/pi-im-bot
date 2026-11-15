import {
  comfyPublic,
  comfyFromDraft,
  workflowPublic,
  type ComfyDraftSchema
} from '@pi-im-bot/integrations/comfy/configuration'
import type { Workflow } from '@pi-im-bot/integrations/comfy/resources'
import type { z } from 'zod'
import { readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Configuration } from '@pi-im-bot/config/load'
import { ConfigurationMutations } from '@pi-im-bot/config/mutations'
import { revision } from '@pi-im-bot/settings/resolve'
import { SettingsEditError } from '@pi-im-bot/settings/editor'
import { McpServerSchema } from './mcp/schema'
import { ResourcesConfigSchema, type ResourcesConfig } from './schema'
import { ResourceLibrary } from './library'
import {
  ResourceSecretPlaceholder,
  type McpServerDraft,
  type McpServerView,
  type SkillView
} from './contracts'
import { inspectMcp } from './mcp/client'
import { mcpCapabilityId, mcpToolName } from './mcp/identity'
import { SkillConfigSchema, type SkillConfig } from './skills/schema'
import { importSkill } from './skills/package'
import { gsviPublic, gsviFromDraft, type GsviDraft } from '@pi-im-bot/integrations/gsvi/configuration'
import { usesMcpTask, mcpToolAvailable } from './mcp/tasks'

export class ResourceEditor {
  constructor(
    private readonly configuration: () => Configuration,
    private readonly apply: (library: ResourceLibrary) => void,
    private readonly mutations: ConfigurationMutations,
    private readonly usage: (kind: 'mcp' | 'skill', id: string) => string[]
  ) {}

  private async file() {
    const raw = await readFile(join(this.configuration().configDir, 'resources.json'), 'utf8')
    return { revision: revision(raw), config: ResourcesConfigSchema.parse(JSON.parse(raw)) }
  }

  async read() {
    const file = await this.file()
    const library = new ResourceLibrary(
      file.config,
      this.configuration().resources.manifests,
      this.configuration().resources.skillManifests,
      this.configuration().resources.pluginPackages
    )
    const mcp: McpServerView[] = file.config.mcp.map((server) => {
      const { url, headers, ...rest } = server
      const endpoint = new URL(url)
      const manifest = library.manifest(server.id)
      let state: McpServerView['state'] = 'undiscovered'
      if (!server.enabled) {
        state = 'disabled'
      } else if (manifest) {
        state = 'ready'
      }
      return {
        ...rest,
        endpoint: endpoint.origin + endpoint.pathname,
        headers: Object.fromEntries(
          Object.keys(headers).map((key) => {
            return [key, ResourceSecretPlaceholder]
          })
        ),
        state,
        fetchedAt: manifest?.fetchedAt,
        taskCapabilities: manifest?.taskCapabilities,
        tools: (manifest?.tools ?? []).map((tool) => {
          return {
            ...tool,
            capabilityId: mcpCapabilityId(server.id, tool.name),
            modelName: mcpToolName(server.id, tool.name),
            asynchronous: usesMcpTask(server, tool, manifest),
            available: mcpToolAvailable(server, tool, manifest)
          }
        })
      }
    })
    const skills: SkillView[] = file.config.skills.map((skill) => {
      const manifest = library.skillManifest(skill.id)
      let state: SkillView['state'] = 'unimported'
      if (!skill.enabled) {
        state = 'disabled'
      } else if (manifest) {
        state = 'ready'
      }
      return { ...skill, manifest, state }
    })
    return {
      revision: file.revision,
      applied: JSON.stringify(file.config) === JSON.stringify(this.configuration().resources.config),
      mcp,
      services: file.config.services.map(gsviPublic),
      comfyServices: file.config.comfyServices.map(comfyPublic),
      workflows: file.config.workflows.map(workflowPublic),
      skills
    }
  }

  saveService(expected: string, draft: GsviDraft, previousId?: string) {
    return this.mutate(expected, (config) => {
      const previous = config.services.find((entry) => {
        return entry.id === draft.id
      })
      if ((previousId && (!previous || previousId !== draft.id)) || (!previousId && previous)) {
        throw new SettingsEditError('语音服务 ID 不存在、重复或已变化')
      }
      const service = gsviFromDraft(draft, previous)
      config.services = [
        ...config.services.filter((entry) => {
          return entry.id !== service.id
        }),
        service
      ]
    })
  }

  saveComfy(expected: string, draft: z.infer<typeof ComfyDraftSchema>, previousId?: string) {
    return this.mutate(expected, (config) => {
      const previous = config.comfyServices.find((entry) => {
        return entry.id === draft.id
      })
      if ((previousId && (!previous || previousId !== draft.id)) || (!previousId && previous)) {
        throw new SettingsEditError('Comfy服务ID重复或不存在')
      }
      const service = comfyFromDraft(draft, previous)
      config.comfyServices = [
        ...config.comfyServices.filter((entry) => {
          return entry.id !== service.id
        }),
        service
      ]
    })
  }
  saveWorkflow(expected: string, workflow: Workflow) {
    return this.mutate(expected, (config) => {
      config.workflows = [
        ...config.workflows.filter((entry) => {
          return entry.id !== workflow.id
        }),
        workflow
      ]
    })
  }
  async workflow(id: string) {
    const file = await this.file()
    const workflow = file.config.workflows.find((entry) => {
      return entry.id === id
    })
    if (!workflow) {
      throw new SettingsEditError('工作流不存在')
    }
    return { revision: file.revision, workflow }
  }
  removeComfy(expected: string, id: string) {
    return this.mutate(expected, (config) => {
      if (
        config.plugins.some((entry) => {
          return Object.values(entry.services).includes(id)
        })
      ) {
        throw new SettingsEditError('服务仍被插件绑定')
      }
      config.comfyServices = config.comfyServices.filter((entry) => {
        return entry.id !== id
      })
    })
  }
  removeWorkflow(expected: string, id: string) {
    return this.mutate(expected, (config) => {
      if (
        config.comfyServices.some((entry) => {
          return entry.workflows.includes(id)
        })
      ) {
        throw new SettingsEditError('模板仍被服务绑定')
      }
      config.workflows = config.workflows.filter((entry) => {
        return entry.id !== id
      })
    })
  }
  removeService(expected: string, id: string) {
    return this.mutate(expected, (config) => {
      if (
        config.plugins.some((entry) => {
          return Object.values(entry.services).includes(id)
        })
      ) {
        throw new SettingsEditError('语音服务仍被插件绑定，请先解除绑定')
      }
      config.services = config.services.filter((entry) => {
        return entry.id !== id
      })
    })
  }

  save(expected: string, draft: McpServerDraft, previousId?: string) {
    return this.mutate(expected, (config) => {
      const previous = config.mcp.find((item) => {
        return item.id === previousId
      })
      if (previousId && (!previous || draft.id !== previousId)) {
        throw new SettingsEditError('MCP 服务不存在或标识已变化')
      }
      if (
        !previousId &&
        config.mcp.some((item) => {
          return item.id === draft.id
        })
      ) {
        throw new SettingsEditError('MCP 服务 ID 已存在')
      }
      const headers = Object.fromEntries(
        Object.entries(draft.headers).map(([key, value]) => {
          if (value !== ResourceSecretPlaceholder) {
            return [key, value]
          }
          const saved = Object.entries(previous?.headers ?? {}).find(([name]) => {
            return name.toLowerCase() === key.toLowerCase()
          })?.[1]
          if (saved === undefined) {
            throw new SettingsEditError('Header 占位没有可保留的值')
          }
          return [key, saved]
        })
      )
      const server = McpServerSchema.parse({ ...draft, url: draft.url || previous?.url, headers })
      config.mcp = [
        ...config.mcp.filter((item) => {
          return item.id !== server.id
        }),
        server
      ]
    })
  }

  remove(expected: string, id: string) {
    return this.mutate(expected, (config) => {
      const usage = this.usage('mcp', id)
      if (usage.length > 0) {
        throw new SettingsEditError(`MCP 仍被配置引用：${usage.join('、')}。可先停用，或清除引用后删除。`)
      }
      config.mcp = config.mcp.filter((item) => {
        return item.id !== id
      })
    })
  }

  async refresh(expected: string, id: string, signal: AbortSignal) {
    const file = await this.file()
    if (file.revision !== expected) {
      throw new SettingsEditError('资源配置已变化，请刷新后重试', 409)
    }
    const server = file.config.mcp.find((item) => {
      return item.id === id
    })
    if (!server) {
      throw new SettingsEditError('MCP 服务不存在')
    }
    const manifest = await inspectMcp(server, signal)
    return this.mutations.exclusive(async () => {
      if ((await this.file()).revision !== expected) {
        throw new SettingsEditError('连接期间配置已变化，未应用旧目录', 409)
      }
      const current = new ResourceLibrary(
        file.config,
        this.configuration().resources.manifests,
        this.configuration().resources.skillManifests,
        this.configuration().resources.pluginPackages
      )
      this.apply(await current.withManifest(manifest, this.configuration().dataDir))
      return this.read()
    })
  }

  private mutate(expected: string, change: (config: ResourcesConfig) => void) {
    return this.mutations.exclusive(async () => {
      const file = await this.file()
      if (file.revision !== expected) {
        throw new SettingsEditError('资源配置已变化，请刷新后重试', 409)
      }
      change(file.config)
      const config = ResourcesConfigSchema.parse(file.config)
      const path = join(this.configuration().configDir, 'resources.json')
      const temporary = `${path}.${crypto.randomUUID()}.tmp`
      try {
        await writeFile(temporary, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 })
        if ((await this.file()).revision !== expected) {
          throw new SettingsEditError('资源文件已变化，未覆盖当前内容', 409)
        }
        await rename(temporary, path)
        this.apply(
          new ResourceLibrary(
            config,
            this.configuration().resources.manifests,
            this.configuration().resources.skillManifests,
            this.configuration().resources.pluginPackages
          )
        )
      } finally {
        await unlink(temporary).catch(() => {})
      }
      return this.read()
    })
  }

  saveSkill(expected: string, input: SkillConfig, previousId?: string) {
    return this.mutate(expected, (config) => {
      const skill = SkillConfigSchema.parse(input)
      const existing = config.skills.some((item) => {
        return item.id === skill.id
      })
      if (previousId && (previousId !== skill.id || !existing)) {
        throw new SettingsEditError('Skill 不存在或 ID 已变化')
      }
      if (!previousId && existing) {
        throw new SettingsEditError('Skill ID 已存在')
      }
      config.skills = [
        ...config.skills.filter((item) => {
          return item.id !== skill.id
        }),
        skill
      ]
    })
  }

  removeSkill(expected: string, id: string) {
    return this.mutate(expected, (config) => {
      const usage = this.usage('skill', id)
      if (usage.length > 0) {
        throw new SettingsEditError(`Skill 仍被配置引用：${usage.join('、')}。可先停用或清除引用。`)
      }
      config.skills = config.skills.filter((item) => {
        return item.id !== id
      })
    })
  }

  async importSkill(expected: string, id: string) {
    const file = await this.file()
    if (file.revision !== expected) {
      throw new SettingsEditError('资源配置已变化，请刷新后重试', 409)
    }
    const config = file.config.skills.find((item) => {
      return item.id === id
    })
    if (!config) {
      throw new SettingsEditError('Skill 不存在')
    }
    const current = this.configuration()
    const manifest = await importSkill(config, current.projectDir, current.dataDir)
    return this.mutations.exclusive(async () => {
      if ((await this.file()).revision !== expected) {
        throw new SettingsEditError('导入期间配置已变化，未应用旧快照', 409)
      }
      const library = new ResourceLibrary(
        file.config,
        this.configuration().resources.manifests,
        this.configuration().resources.skillManifests,
        this.configuration().resources.pluginPackages
      )
      this.apply(await library.withSkill(manifest, current.dataDir))
      return this.read()
    })
  }
}
