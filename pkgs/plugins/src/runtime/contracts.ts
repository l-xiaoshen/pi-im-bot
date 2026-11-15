import { z } from 'zod'
import { PluginRuntimeSchema } from './config'

export const PluginEnvironmentInputSchema = z
  .object({
    image: PluginRuntimeSchema.unwrap().shape.image,
    mountCommand: z
      .string()
      .min(1)
      .refine((value) => {
        return value.startsWith('/')
      }, '请使用绝对路径')
  })
  .strict()
export const SavePluginEnvironmentSchema = PluginEnvironmentInputSchema.extend({
  revision: z.string(),
  enabled: z.boolean()
}).strict()
export const PluginEnvironmentSchema = z.object({
  revision: z.string(),
  enabled: z.boolean(),
  applied: z.boolean(),
  image: z.string(),
  mountCommand: z.string(),
  suggestedMountCommand: z.string().optional(),
  ready: z.boolean(),
  checks: z.array(z.object({ id: z.string(), name: z.string(), ready: z.boolean(), detail: z.string() }))
})
export type PluginEnvironment = z.infer<typeof PluginEnvironmentSchema>
