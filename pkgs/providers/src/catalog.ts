import type { Model } from '@earendil-works/pi-ai'
import { mergeHeaders } from './body'
import { secretValues } from './editor-secrets'
import { ProviderPool, type Candidate } from './pool'
import type { ProviderGroup, ProvidersConfig } from './schema'

export class ProviderCatalog {
  readonly pool = new ProviderPool()
  readonly candidates = new Map<string, Candidate>()
  private readonly secrets: string[] = []

  private constructor(readonly config: ProvidersConfig) {}

  static async create(config: ProvidersConfig) {
    const catalog = new ProviderCatalog(config)
    for (const provider of config.providers) {
      if (
        !provider.enabled ||
        !provider.models.some((model) => {
          return model.enabled
        })
      ) {
        continue
      }
      let key = provider.apiKey ?? ''
      if (provider.apiKeyEnv) {
        const configured = process.env[provider.apiKeyEnv]
        if (configured === undefined) {
          throw new Error(`Missing provider environment variable: ${provider.apiKeyEnv}`)
        }
        key = configured
      }
      if (key) {
        catalog.secrets.push(key)
      }
      catalog.secrets.push(...secretValues(provider))
      for (const headers of [
        provider.headers,
        ...provider.models.map((model) => {
          return model.headers
        })
      ]) {
        for (const value of Object.values(headers)) {
          if (value && value.length >= 8) {
            catalog.secrets.push(value)
          }
        }
      }
      for (const modelConfig of provider.models) {
        if (!modelConfig.enabled) {
          continue
        }
        const model: Model<'openai-responses'> = {
          id: modelConfig.id,
          name: modelConfig.name ?? modelConfig.id,
          api: 'openai-responses',
          provider: provider.id,
          baseUrl: provider.baseUrl.replace(/\/$/, ''),
          input: modelConfig.images ? ['text', 'image'] : ['text'],
          reasoning: modelConfig.reasoning,
          contextWindow: modelConfig.contextWindow,
          maxTokens: modelConfig.maxOutputTokens,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
        }
        const candidate: Candidate = {
          key: `${provider.id}/${modelConfig.id}`,
          provider,
          config: modelConfig,
          model,
          apiKey: key
        }
        catalog.candidates.set(candidate.key, candidate)
      }
    }
    return catalog
  }

  group(id: string): ProviderGroup {
    const group = this.config.groups.find((item) => {
      return item.id === id
    })
    if (!group) {
      throw new Error(`Unknown provider group: ${id}`)
    }
    return group
  }

  forGroup(id: string) {
    return this.group(id).candidates.flatMap((reference) => {
      const candidate = this.candidates.get(`${reference.provider}/${reference.model}`)
      if (!candidate) {
        return []
      }
      return [candidate]
    })
  }

  headers(candidate: Candidate) {
    const defaults: Record<string, string | null> = {}
    if (!candidate.apiKey) {
      defaults.authorization = null
    }
    return mergeHeaders(defaults, candidate.provider.headers, candidate.config.headers)
  }

  redact(value: string) {
    let result = value
    for (const secret of this.secrets) {
      result = result.replaceAll(secret, '[redacted]')
    }
    return result
      .replace(/Bearer\s+[^\s"']+/gi, 'Bearer [redacted]')
      .replace(/\bsk-[A-Za-z0-9_-]+/g, '[redacted]')
  }

  publicStatus() {
    return {
      defaultGroup: this.config.defaultGroup,
      groups: this.config.groups.map((group) => {
        return {
          id: group.id,
          name: group.name ?? group.id,
          candidates: group.candidates,
          ready: this.forGroup(group.id).length > 0,
          cooldownMs: group.cooldownMs
        }
      }),
      providers: this.config.providers.map((provider) => {
        return {
          id: provider.id,
          name: provider.name ?? provider.id,
          enabled: provider.enabled,
          protocol: provider.protocol,
          models: provider.models.map((model) => {
            return model.id
          }),
          headerNames: Object.keys(provider.headers),
          bodyFields: Object.keys(provider.body)
        }
      }),
      health: this.pool.snapshot()
    }
  }
}
