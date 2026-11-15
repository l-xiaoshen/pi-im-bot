import { ComfyViewSchema, WorkflowViewSchema } from '@pi-im-bot/integrations/comfy/configuration'
import { z } from 'zod'
import { GsviViewSchema } from '@pi-im-bot/integrations/gsvi/configuration'
import { McpServerSchema, McpToolSchema } from './mcp/schema'
import { McpTaskCapabilitiesSchema } from './mcp/task-schema'
import { SkillConfigSchema, SkillManifestSchema } from './skills/schema'

export const McpServerViewSchema = McpServerSchema.omit({ url: true }).extend({
  endpoint: z.string(),
  state: z.enum(['disabled', 'undiscovered', 'ready']),
  fetchedAt: z.number().optional(),
  taskCapabilities: McpTaskCapabilitiesSchema.optional(),
  tools: z.array(
    McpToolSchema.extend({
      capabilityId: z.string(),
      modelName: z.string(),
      asynchronous: z.boolean().default(false),
      available: z.boolean().default(true)
    })
  )
})
export type McpServerView = z.infer<typeof McpServerViewSchema>
export const McpServerDraftSchema = McpServerSchema.omit({ url: true }).extend({
  url: z.string().default('')
})
export type McpServerDraft = z.infer<typeof McpServerDraftSchema>
export const SkillViewSchema = SkillConfigSchema.extend({
  state: z.enum(['disabled', 'unimported', 'ready']),
  manifest: SkillManifestSchema.optional()
})
export type SkillView = z.infer<typeof SkillViewSchema>
export const ResourcesViewSchema = z.object({
  revision: z.string(),
  applied: z.boolean(),
  mcp: z.array(McpServerViewSchema),
  services: z.array(GsviViewSchema).default([]),
  comfyServices: z.array(ComfyViewSchema).default([]),
  workflows: z.array(WorkflowViewSchema).default([]),
  skills: z.array(SkillViewSchema)
})
export type ResourcesView = z.infer<typeof ResourcesViewSchema>
export const SaveMcpServerSchema = z.object({ revision: z.string(), server: McpServerDraftSchema })
export const SaveSkillSchema = z.object({ revision: z.string(), skill: SkillConfigSchema })
export const ResourceRevisionSchema = z.object({ revision: z.string() })
export const ResourceSecretPlaceholder = '__PI_IM_BOT_SECRET_PRESERVED__'
