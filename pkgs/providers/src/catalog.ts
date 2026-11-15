import { ModelRuntime } from '@earendil-works/pi-coding-agent'
import type { Model } from '@earendil-works/pi-ai'
import { join } from 'node:path'
import { mergeHeaders } from './body'
import { secretValues } from './editor-secrets'
import { ProviderPool, type Candidate } from './pool'
import type { ProviderGroup, ProvidersConfig } from './schema'

export class ProviderCatalog {
  readonly pool = new ProviderPool()
  readonly candidates = new Map<string, Candidate>()
  private readonly secrets: string[] = []

  private constructor(
    readonly config: ProvidersConfig,
    readonly runtime: ModelRuntime
  ) {}

  static async create(config: ProvidersConfig, dataDir: string) {
    const runtime = await ModelRuntime.create({
      authPath: join(dataDir, 'provider-auth.json'),
      modelsPath: null,
      refreshOnCreate: false,
      allowModelNetwork: false
    })
    const catalog = new ProviderCatalog(config, runtime)
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
      runtime.registerProvider(provider.id, {
        api: 'openai-responses',
        baseUrl: provider.baseUrl.replace(/\/$/, ''),
        apiKey: key || 'unused',
        models: provider.models
          .filter((model) => {
            return model.enabled
          })
          .map((model) => {
            return {
              id: model.id,
              name: model.name ?? model.id,
              api: 'openai-responses',
              reasoning: model.reasoning,
              input: ['text', ...imageInput(model.images)],
              contextWindow: model.contextWindow,
              maxTokens: model.maxOutputTokens,
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
            }
          })
      })
      for (const modelConfig of provider.models) {
        if (!modelConfig.enabled) {
          continue
        }
        const registered = runtime.getModel(provider.id, modelConfig.id)
        if (!registered) {
          throw new Error(`Cannot register ${provider.id}/${modelConfig.id}`)
        }
        const model: Model<'openai-responses'> = { ...registered, api: 'openai-responses' }
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
    for (const group of config.groups) {
      const candidates = catalog.forGroup(group.id)
      if (candidates.length === 0) {
        continue
      }
      runtime.registerVirtualModel({
        provider: 'pi-im-groups',
        id: group.id,
        name: group.name ?? group.id,
        contextWindow: Math.min(
          ...candidates.map((candidate) => {
            return candidate.config.contextWindow
          })
        ),
        maxTokens: Math.min(
          ...candidates.map((candidate) => {
            return candidate.config.maxOutputTokens
          })
        ),
        route(request) {
          let preferred: string | undefined
          if (request.reason !== 'user' && request.previous) {
            preferred = `${request.previous.model.provider}/${request.previous.model.id}`
          }
          const [candidate] = catalog.pool.order(candidates, preferred)
          return { model: candidate.model, thinkingLevel: 'off' }
        }
      })
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

function imageInput(enabled: boolean): 'image'[] {
  if (enabled) {
    return ['image']
  }
  return []
}
