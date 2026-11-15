import { z } from 'zod'
import { ConfigDefinitionSchema, ConfigValuesSchema } from './schema'
import { SecretChangeSchema, SecretStateSchema } from './secrets'

export const PluginConfigTargetSchema = z.discriminatedUnion('level', [
  z.object({ level: z.literal('instance') }).strict(),
  z
    .object({
      level: z.literal('account'),
      channel: z.string().min(1).max(100),
      accountId: z.string().min(1).max(100)
    })
    .strict(),
  z.object({ level: z.literal('room'), roomId: z.string().min(1).max(200) }).strict(),
  z
    .object({
      level: z.literal('conversation'),
      roomId: z.string().min(1).max(200),
      conversationId: z.string().min(1).max(200)
    })
    .strict()
])
export type PluginConfigTarget = z.infer<typeof PluginConfigTargetSchema>
export const ConfigChoiceSchema = z.object({ id: z.string(), name: z.string(), enabled: z.boolean() })
export const PluginConfigViewSchema = z.object({
  revision: z.string(),
  release: z.string(),
  target: PluginConfigTargetSchema,
  targets: z.array(z.object({ name: z.string(), target: PluginConfigTargetSchema })),
  definition: ConfigDefinitionSchema.optional(),
  values: ConfigValuesSchema,
  inherited: ConfigValuesSchema,
  secrets: z.array(SecretStateSchema),
  issues: z.array(z.object({ path: z.string(), message: z.string() })),
  gsviConfiguration: z
    .object({
      projectionSupported: z.literal(true),
      inlinePresentationContract: z.literal('tool-send@1'),
      runtimeContract: z.literal('gsvi-plugin@1'),
      projectionActive: z.boolean(),
      refreshDisabled: z.boolean(),
      voiceChoices: z.array(z.string()).default([]),
      voiceHint: z.string().default('')
    })
    .optional(),
  bindings: z
    .array(
      z.object({
        alias: z.string(),
        kind: z.enum(['mcp', 'plugin', 'service']),
        title: z.string(),
        required: z.boolean(),
        value: z.string(),
        choices: z.array(ConfigChoiceSchema)
      })
    )
    .default([]),
  choices: z.object({
    select_mcp: z.array(ConfigChoiceSchema),
    select_provider: z.array(ConfigChoiceSchema),
    select_model_group: z.array(ConfigChoiceSchema),
    select_persona: z.array(ConfigChoiceSchema)
  })
})
export type PluginConfigView = z.infer<typeof PluginConfigViewSchema>
export const SavePluginConfigSchema = z
  .object({
    revision: z.string(),
    release: z.string(),
    target: PluginConfigTargetSchema,
    values: ConfigValuesSchema,
    secrets: z.array(SecretChangeSchema).max(500).default([]),
    services: z.record(z.string(), z.string()).optional(),
    connectors: z.record(z.string(), z.string()).optional(),
    dependencies: z.record(z.string(), z.string()).optional()
  })
  .strict()
