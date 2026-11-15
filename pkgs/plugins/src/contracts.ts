import { z } from 'zod'
import { PluginInstanceSchema, PluginPackageSchema } from './config'

export const PluginSettingPlaceholder = '__PI_PLUGIN_SETTING_PRESERVED__'
export const PluginViewSchema = PluginInstanceSchema.extend({
  state: z.enum(['disabled', 'unimported', 'runtime-disabled', 'configured', 'needs-configuration']),
  issues: z.array(z.object({ path: z.string(), message: z.string() })).default([]),
  bundle: PluginPackageSchema.optional()
})
export type PluginView = z.infer<typeof PluginViewSchema>
export const PluginEditorViewSchema = z.object({
  revision: z.string(),
  applied: z.boolean(),
  runtimeEnabled: z.boolean(),
  plugins: z.array(PluginViewSchema)
})
export type PluginEditorView = z.infer<typeof PluginEditorViewSchema>
export const SavePluginSchema = z.object({ revision: z.string(), plugin: PluginInstanceSchema })
export const PluginManagementPatchSchema = z
  .object({
    name: PluginInstanceSchema.shape.name.optional(),
    enabled: PluginInstanceSchema.shape.enabled.unwrap().optional(),
    grants: PluginInstanceSchema.shape.grants.unwrap().optional(),
    connectors: PluginInstanceSchema.shape.connectors.unwrap().optional(),
    services: PluginInstanceSchema.shape.services.unwrap().optional(),
    dependencies: PluginInstanceSchema.shape.dependencies.unwrap().optional()
  })
  .strict()
export const ManagePluginSchema = z
  .object({
    revision: z.string(),
    patch: PluginManagementPatchSchema
  })
  .strict()
