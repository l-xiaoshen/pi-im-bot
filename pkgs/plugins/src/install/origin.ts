import { z } from 'zod'
import { PluginPathSchema } from '../manifest'

export const PluginOriginSchema = z
  .object({
    kind: z.enum(['url', 'github-release', 'github-source']),
    repository: z
      .url()
      .refine((value) => {
        const url = new URL(value)
        return (
          url.protocol === 'https:' &&
          url.hostname === 'github.com' &&
          !url.username &&
          !url.password &&
          !url.search &&
          !url.hash
        )
      }, 'GitHub 来源须使用规范的仓库 HTTPS 地址')
      .optional(),
    ref: z.string().max(1000).optional(),
    commit: z
      .string()
      .regex(/^[a-f0-9]{40}$/u)
      .optional(),
    directory: PluginPathSchema.optional(),
    archiveSha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/u)
      .optional()
  })
  .strict()
export type PluginOrigin = z.infer<typeof PluginOriginSchema>
