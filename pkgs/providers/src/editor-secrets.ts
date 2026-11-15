import { z } from 'zod'
import { ProviderConfigSchema, ModelConfigSchema, type ProviderConfig } from './schema'
import { SecretPlaceholder, type ProviderDraft, type ProviderView } from './editor-contracts'

const ObjectSchema = z.record(z.string(), z.unknown())
const ArraySchema = z.array(z.unknown())
const SecretName =
  /authorization|cookie|password|secret|api[-_]?key|(?:access|refresh|auth)[-_]?token|(?:^|[-_])token$/i

export function visibleProvider(provider: ProviderConfig): ProviderView {
  const maskedFields: string[] = []
  const secrets = secretValues(provider)
  function mask(value: unknown, path: string[], sensitive = false): unknown {
    if (typeof value === 'string') {
      if (value && (sensitive || secrets.includes(value))) {
        maskedFields.push(path.join('.'))
        return SecretPlaceholder
      }
      return value
    }
    const array = ArraySchema.safeParse(value)
    if (array.success) {
      return array.data.map((item, index) => {
        return mask(item, [...path, String(index)], sensitive)
      })
    }
    const object = ObjectSchema.safeParse(value)
    if (object.success) {
      return Object.fromEntries(
        Object.entries(object.data).map(([key, item]) => {
          return [key, mask(item, [...path, key], sensitive || SecretName.test(key))]
        })
      )
    }
    return value
  }
  const { apiKey, ...plain } = provider
  const result = ProviderConfigSchema.omit({ apiKey: true }).parse({
    ...plain,
    headers: mask(plain.headers, ['headers']),
    body: mask(plain.body, ['body']),
    models: plain.models.map((model) => {
      return {
        ...model,
        headers: mask(model.headers, ['models', model.id, 'headers']),
        body: mask(model.body, ['models', model.id, 'body'])
      }
    })
  })
  return {
    ...result,
    hasApiKey: Boolean(apiKey),
    maskedFields,
    models: result.models.map((model) => {
      return { ...model, originalId: model.id }
    })
  }
}

function restore(value: unknown, previous: unknown): unknown {
  if (value === SecretPlaceholder) {
    if (previous === undefined) {
      throw new Error('凭据占位没有对应的已保存值，请重新填写该字段。')
    }
    return previous
  }
  const array = ArraySchema.safeParse(value)
  if (array.success) {
    const old = ArraySchema.safeParse(previous)
    return array.data.map((item, index) => {
      let prior: unknown
      if (old.success) {
        prior = old.data[index]
      }
      return restore(item, prior)
    })
  }
  const object = ObjectSchema.safeParse(value)
  if (object.success) {
    const old = ObjectSchema.safeParse(previous)
    return Object.fromEntries(
      Object.entries(object.data).map(([key, item]) => {
        let prior: unknown
        if (old.success) {
          prior = old.data[key]
        }
        return [key, restore(item, prior)]
      })
    )
  }
  return value
}

function restoreHeaders(headers: Record<string, string | null>, previous: Record<string, string | null>) {
  const old = new Map(
    Object.entries(previous).map(([key, value]) => {
      return [key.toLowerCase(), value]
    })
  )
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => {
      return [key, restore(value, old.get(key.toLowerCase()))]
    })
  )
}

export function resolveProvider(draft: ProviderDraft, previous?: ProviderConfig): ProviderConfig {
  let apiKey = previous?.apiKey
  if (draft.clearApiKey) {
    apiKey = undefined
  }
  if (draft.apiKey) {
    if (draft.apiKey === SecretPlaceholder) {
      throw new Error('API Key 需要填写真实值，或留空保留原值。')
    }
    apiKey = draft.apiKey
  }
  const originalIds = new Set<string>()
  const models = draft.models.map((model) => {
    const sourceId = model.originalId ?? model.id
    if (originalIds.has(sourceId)) {
      throw new Error(`重复的模型来源：${sourceId}`)
    }
    originalIds.add(sourceId)
    const old = previous?.models.find((item) => {
      return item.id === sourceId
    })
    if (model.originalId && !old) {
      throw new Error(`模型 ${sourceId} 已变化，请刷新后重新编辑。`)
    }
    return ModelConfigSchema.parse({
      ...model,
      headers: restoreHeaders(model.headers, old?.headers ?? {}),
      body: restore(model.body, old?.body)
    })
  })
  return ProviderConfigSchema.parse({
    ...draft,
    apiKey,
    models,
    headers: restoreHeaders(draft.headers, previous?.headers ?? {}),
    body: restore(draft.body, previous?.body)
  })
}

export function secretValues(provider: ProviderConfig) {
  const values = new Set<string>()
  if (provider.apiKey) {
    values.add(provider.apiKey)
  }
  if (provider.apiKeyEnv && process.env[provider.apiKeyEnv]) {
    values.add(process.env[provider.apiKeyEnv]!)
  }
  function visit(value: unknown, sensitive = false) {
    if (typeof value === 'string') {
      if (sensitive && value) {
        values.add(value)
      }
      return
    }
    const object = ObjectSchema.safeParse(value)
    if (object.success) {
      for (const [key, child] of Object.entries(object.data)) {
        visit(child, sensitive || SecretName.test(key))
      }
      return
    }
    const array = ArraySchema.safeParse(value)
    if (array.success) {
      for (const child of array.data) {
        visit(child, sensitive)
      }
    }
  }
  visit(provider.headers)
  visit(provider.body)
  for (const model of provider.models) {
    visit(model.headers)
    visit(model.body)
  }
  return [...values]
}

export function redactProviderError(error: unknown, provider: ProviderConfig) {
  let message = String(error)
  for (const secret of secretValues(provider)) {
    message = message.replaceAll(secret, '[redacted]')
  }
  return message
    .replace(/Bearer\s+[^\s"']+/gi, 'Bearer [redacted]')
    .replace(/\bsk-[A-Za-z0-9_-]+/g, '[redacted]')
}
