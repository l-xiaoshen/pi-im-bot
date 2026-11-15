import { createHash } from "node:crypto"
import { writeFile, rename, rm } from "node:fs/promises"
import { join } from "node:path"
import type { Configuration } from "@pi-im-bot/config/load"
import { ProviderCatalog } from "./catalog"
import { ProvidersConfigSchema, type ProvidersConfig, type ProviderGroup, type CandidateRef } from "./schema"
import type { ProviderDraft, ProviderEditorSnapshot } from "./editor-contracts"
import { resolveProvider, visibleProvider } from "./editor-secrets"
import { ConfigurationMutations } from "@pi-im-bot/config/mutations"

export class ProviderEditError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409 = 400
  ) {
    super(message)
  }
}

interface EditorHost {
  configuration(): Configuration
  apply(catalog: ProviderCatalog): void
  groupUsage(): Record<string, string[]>
}

export class ProviderEditor {
  constructor(
    private readonly host: EditorHost,
    private readonly mutations = new ConfigurationMutations()
  ) {}

  exclusive<T>(operation: () => Promise<T>): Promise<T> {
    return this.mutations.exclusive(operation)
  }

  private async readFile() {
    const path = join(this.host.configuration().configDir, "providers.json")
    const raw = await Bun.file(path).text()
    let value: unknown
    try {
      value = JSON.parse(raw)
    } catch {
      throw new ProviderEditError("providers.json 不是有效的 JSON，请先修正文件。")
    }
    return { path, revision: digest(raw), config: ProvidersConfigSchema.parse(value) }
  }

  private snapshot(config: ProvidersConfig, revision: string): ProviderEditorSnapshot {
    return {
      revision,
      applied: JSON.stringify(config) === JSON.stringify(this.host.configuration().catalog.config),
      defaultGroup: config.defaultGroup,
      providers: config.providers.map(visibleProvider),
      groups: config.groups,
      groupUsage: this.host.groupUsage()
    }
  }

  async read() {
    const file = await this.readFile()
    return this.snapshot(file.config, file.revision)
  }

  private async mutate(revision: string, change: (config: ProvidersConfig) => void) {
    return this.exclusive(async () => {
      const file = await this.readFile()
      if (revision !== file.revision) {
        throw conflict()
      }
      change(file.config)
      const next = ProvidersConfigSchema.parse(file.config)
      const catalog = await ProviderCatalog.create(next)
      if (digest(await Bun.file(file.path).text()) !== revision) {
        throw conflict()
      }
      const raw = `${JSON.stringify(next, null, 2)}\n`
      const temporary = `${file.path}.${crypto.randomUUID()}.tmp`
      try {
        await writeFile(temporary, raw, { mode: 0o600 })
        await rename(temporary, file.path)
      } finally {
        await rm(temporary, { force: true })
      }
      this.host.apply(catalog)
      return this.snapshot(next, digest(raw))
    })
  }

  async saveProvider(revision: string, draft: ProviderDraft, previousId?: string) {
    return this.mutate(revision, (config) => {
      const previous = config.providers.find((provider) => {
        return provider.id === previousId
      })
      if (previousId && !previous) {
        throw new ProviderEditError("提供商不存在，请刷新。", 404)
      }
      if (
        config.providers.some((provider) => {
          return provider.id === draft.id && provider.id !== previousId
        })
      ) {
        throw new ProviderEditError(`提供商标识 ${draft.id} 已存在。`)
      }
      const next = resolveProvider(draft, previous)
      if (!previous) {
        config.providers.push(next)
        return
      }
      config.providers = config.providers.map((provider) => {
        if (provider.id === previousId) {
          return next
        }
        return provider
      })
      const modelNames = new Map(
        draft.models.map((model) => {
          return [model.originalId ?? model.id, model.id]
        })
      )
      for (const group of config.groups) {
        group.candidates = group.candidates.flatMap((candidate) => {
          if (candidate.provider !== previousId) {
            return [candidate]
          }
          const model = modelNames.get(candidate.model)
          if (!model) {
            return []
          }
          return [{ provider: next.id, model }]
        })
      }
    })
  }

  async deleteProvider(revision: string, id: string) {
    return this.mutate(revision, (config) => {
      if (
        !config.providers.some((provider) => {
          return provider.id === id
        })
      ) {
        throw new ProviderEditError("提供商不存在。", 404)
      }
      config.providers = config.providers.filter((provider) => {
        return provider.id !== id
      })
      for (const group of config.groups) {
        group.candidates = group.candidates.filter((candidate) => {
          return candidate.provider !== id
        })
      }
    })
  }

  async saveGroup(revision: string, group: ProviderGroup, previousId?: string) {
    return this.mutate(revision, (config) => {
      if (previousId) {
        if (group.id !== previousId) {
          throw new ProviderEditError("已有候选组的内部标识不可修改。")
        }
        if (
          !config.groups.some((item) => {
            return item.id === previousId
          })
        ) {
          throw new ProviderEditError("候选组不存在。", 404)
        }
        config.groups = config.groups.map((item) => {
          if (item.id === previousId) {
            return group
          }
          return item
        })
      } else {
        if (
          config.groups.some((item) => {
            return item.id === group.id
          })
        ) {
          throw new ProviderEditError("候选组标识已存在。")
        }
        config.groups.push(group)
      }
    })
  }

  async deleteGroup(revision: string, id: string) {
    return this.mutate(revision, (config) => {
      if (config.groups.length <= 1) {
        throw new ProviderEditError("至少保留一个候选组。")
      }
      const usage = this.host.groupUsage()[id] ?? []
      if (usage.length > 0) {
        throw new ProviderEditError(`此组仍用于会话「${usage.join("、")}」，请先修改会话的模型组。`)
      }
      config.groups = config.groups.filter((group) => {
        return group.id !== id
      })
      if (config.defaultGroup === id) {
        config.defaultGroup = config.groups[0].id
      }
    })
  }

  async setDefaultGroup(revision: string, id: string) {
    return this.mutate(revision, (config) => {
      config.defaultGroup = id
    })
  }

  async setDefaultCandidate(revision: string, candidate: CandidateRef) {
    return this.mutate(revision, (config) => {
      const provider = config.providers.find((item) => {
        return item.id === candidate.provider
      })
      const model = provider?.models.find((item) => {
        return item.id === candidate.model
      })
      if (!provider?.enabled || !model?.enabled) {
        throw new ProviderEditError("请先启用提供商和模型。")
      }
      const group = config.groups.find((item) => {
        return item.id === config.defaultGroup
      })!
      group.candidates = [
        candidate,
        ...group.candidates.filter((item) => {
          return item.provider !== candidate.provider || item.model !== candidate.model
        })
      ]
    })
  }

  async resolveDraft(revision: string, draft: ProviderDraft, providerId?: string) {
    const file = await this.readFile()
    if (revision !== file.revision) {
      throw conflict()
    }
    const previous = file.config.providers.find((provider) => {
      return provider.id === providerId
    })
    if (providerId && !previous) {
      throw new ProviderEditError("提供商不存在，请刷新。", 404)
    }
    return resolveProvider(draft, previous)
  }
}

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex")
}
function conflict() {
  return new ProviderEditError("配置已被其他页面或文件修改，请刷新后重新编辑。当前输入仍保留。", 409)
}
