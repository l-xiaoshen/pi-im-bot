import { z } from 'zod'

const ReservedBodyFields = new Set([
  'model',
  'input',
  'tools',
  'stream',
  'previous_response_id',
  'conversation'
])
export const ExtraBodySchema = z.record(z.string(), z.unknown()).superRefine((body, context) => {
  for (const key of Object.keys(body)) {
    if (ReservedBodyFields.has(key)) {
      context.addIssue({ code: 'custom', path: [key], message: `${key} is owned by the agent runtime` })
    }
  }
})
export const HeadersSchema = z.record(z.string(), z.string().nullable())

export const ModelConfigSchema = z.object({
  id: z.string().min(1),
  name: z.string().optional(),
  enabled: z.boolean().default(true),
  contextWindow: z.number().int().min(1024).default(128000),
  maxOutputTokens: z.number().int().min(16).default(16384),
  reasoning: z.boolean().default(true),
  images: z.boolean().default(true),
  headers: HeadersSchema.default({}),
  body: ExtraBodySchema.default({})
})
export type ModelConfig = z.infer<typeof ModelConfigSchema>

export const ProviderConfigSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_-]*$/),
  name: z.string().optional(),
  enabled: z.boolean().default(true),
  protocol: z.literal('openai-responses').default('openai-responses'),
  baseUrl: z.url().refine((url) => {
    return ['http:', 'https:'].includes(new URL(url).protocol)
  }),
  apiKey: z.string().optional(),
  apiKeyEnv: z.string().optional(),
  headers: HeadersSchema.default({}),
  body: ExtraBodySchema.default({}),
  timeoutMs: z.number().int().min(1000).default(120000),
  models: z.array(ModelConfigSchema).default([])
})
export type ProviderConfig = z.infer<typeof ProviderConfigSchema>

export const CandidateSchema = z.object({ provider: z.string(), model: z.string() })
export type CandidateRef = z.infer<typeof CandidateSchema>
export const ProviderGroupSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_-]*$/),
  name: z.string().optional(),
  candidates: z.array(CandidateSchema).default([]),
  cooldownMs: z.number().int().min(0).default(60000)
})
export type ProviderGroup = z.infer<typeof ProviderGroupSchema>

export const ProvidersConfigSchema = z
  .object({
    defaultGroup: z.string().default('main'),
    providers: z.array(ProviderConfigSchema),
    groups: z.array(ProviderGroupSchema)
  })
  .superRefine((config, context) => {
    const providers = new Map<string, ProviderConfig>()
    for (const provider of config.providers) {
      if (providers.has(provider.id)) {
        context.addIssue({ code: 'custom', message: `Duplicate provider: ${provider.id}` })
      }
      providers.set(provider.id, provider)
      const models = new Set<string>()
      for (const model of provider.models) {
        if (models.has(model.id)) {
          context.addIssue({ code: 'custom', message: `Duplicate model: ${provider.id}/${model.id}` })
        }
        models.add(model.id)
      }
    }
    const groups = new Set<string>()
    for (const group of config.groups) {
      if (groups.has(group.id)) {
        context.addIssue({ code: 'custom', message: `Duplicate group: ${group.id}` })
      }
      groups.add(group.id)
      const candidates = new Set<string>()
      for (const candidate of group.candidates) {
        const key = `${candidate.provider}/${candidate.model}`
        if (candidates.has(key)) {
          context.addIssue({ code: 'custom', message: `Duplicate candidate: ${key}` })
        }
        candidates.add(key)
        if (
          !providers.get(candidate.provider)?.models.some((model) => {
            return model.id === candidate.model
          })
        ) {
          context.addIssue({ code: 'custom', message: `Unknown candidate: ${key}` })
        }
      }
    }
    if (!groups.has(config.defaultGroup)) {
      context.addIssue({ code: 'custom', message: 'defaultGroup must reference a group' })
    }
  })
export type ProvidersConfig = z.infer<typeof ProvidersConfigSchema>
