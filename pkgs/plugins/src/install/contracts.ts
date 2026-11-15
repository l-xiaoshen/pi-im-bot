import { z } from 'zod'
import { PluginIdSchema } from '../manifest'
import { PluginInstallUrlSchema } from './url'
import { PluginOriginSchema } from './origin'

export const InstallRequestSchema = z
  .object({
    revision: z.string(),
    url: PluginInstallUrlSchema.optional(),
    directory: z.string().min(1).max(4096).optional(),
    builtin: PluginIdSchema.optional(),
    targetId: PluginIdSchema.optional(),
    catalogId: PluginIdSchema.optional(),
    sha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/u)
      .optional(),
    packageId: PluginIdSchema.optional(),
    version: z.string().max(100).optional()
  })
  .strict()
  .refine((value) => {
    return [value.url, value.directory, value.builtin].filter(Boolean).length === 1
  }, '请选择一个插件来源')
export const InstallationSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  stage: z.enum([
    'queued',
    'downloading',
    'verifying',
    'applying',
    'succeeded',
    'failed',
    'cancelled',
    'interrupted'
  ]),
  createdAt: z.number(),
  updatedAt: z.number(),
  pluginId: z.string().optional(),
  error: z.string().optional(),
  origin: PluginOriginSchema.optional()
})
export type Installation = z.infer<typeof InstallationSchema>
export const InstallationListSchema = z.array(InstallationSchema).max(100)
