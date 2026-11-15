import { z } from 'zod'
import { ModelConfigSchema, ProviderConfigSchema, ProviderGroupSchema, CandidateSchema } from './schema'

export const SecretPlaceholder = '<已保存，保持不变>'
export const ModelDraftSchema = ModelConfigSchema.extend({ originalId: z.string().optional() })
export type ModelDraft = z.infer<typeof ModelDraftSchema>

export const ProviderDraftSchema = ProviderConfigSchema.omit({ models: true }).extend({
  models: z.array(ModelDraftSchema).default([]),
  clearApiKey: z.boolean().default(false)
})
export type ProviderDraft = z.infer<typeof ProviderDraftSchema>

export const ProviderViewSchema = ProviderConfigSchema.omit({ apiKey: true, models: true }).extend({
  models: z.array(ModelDraftSchema),
  hasApiKey: z.boolean(),
  maskedFields: z.array(z.string())
})
export type ProviderView = z.infer<typeof ProviderViewSchema>

export const ProviderEditorSnapshotSchema = z.object({
  revision: z.string(),
  applied: z.boolean(),
  defaultGroup: z.string(),
  providers: z.array(ProviderViewSchema),
  groups: z.array(ProviderGroupSchema),
  groupUsage: z.record(z.string(), z.array(z.string()))
})
export type ProviderEditorSnapshot = z.infer<typeof ProviderEditorSnapshotSchema>

export const RevisionSchema = z.object({ revision: z.string().min(1) })
export const SaveProviderSchema = RevisionSchema.extend({ provider: ProviderDraftSchema })
export const SaveGroupSchema = RevisionSchema.extend({ group: ProviderGroupSchema })
export const DefaultCandidateSchema = RevisionSchema.extend({ candidate: CandidateSchema })
export const ProviderProbeInputSchema = RevisionSchema.extend({
  providerId: z.string().optional(),
  provider: ProviderDraftSchema,
  modelId: z.string().optional()
})
export const RemoteModelsSchema = z.object({
  models: z.array(z.object({ id: z.string(), owner: z.string().optional() }))
})
export type RemoteModel = z.infer<typeof RemoteModelsSchema>['models'][number]
export const ModelProbeResultSchema = z.object({
  ok: z.boolean(),
  model: z.string(),
  durationMs: z.number(),
  text: z.string(),
  status: z.string(),
  usage: z.object({ input: z.number(), output: z.number(), cacheRead: z.number() })
})

export function providerDraft(view: ProviderView): ProviderDraft {
  return ProviderDraftSchema.parse(view)
}
