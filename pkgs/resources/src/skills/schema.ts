import { z } from 'zod'

export const SkillFilePathSchema = z
  .string()
  .min(1)
  .max(500)
  .refine((path) => {
    return (
      !path.includes('\\') &&
      !path.includes('\0') &&
      !/^[A-Za-z]:/.test(path) &&
      path.split('/').every((part) => {
        return part !== '' && part !== '.' && part !== '..'
      })
    )
  }, '文件必须是技能包内的相对路径')

export const SkillConfigSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9_-]{0,47}$/),
    name: z.string().min(1).max(100),
    enabled: z.boolean().default(false),
    sourceDir: z.string().min(1).max(1000)
  })
  .strict()
export type SkillConfig = z.infer<typeof SkillConfigSchema>

export const SkillManifestSchema = z.object({
  id: z.string(),
  configRevision: z.string(),
  revision: z.string().regex(/^[a-f0-9]{64}$/),
  importedAt: z.number(),
  name: z.string().min(1).max(64),
  description: z.string().min(1).max(1024),
  disableModelInvocation: z.boolean(),
  files: z
    .array(
      z.object({
        path: SkillFilePathSchema,
        bytes: z.number().int().nonnegative(),
        sha256: z.string().regex(/^[a-f0-9]{64}$/)
      })
    )
    .max(200)
})
export type SkillManifest = z.infer<typeof SkillManifestSchema>
export const SkillCatalogFileSchema = z.object({ manifests: z.array(SkillManifestSchema).default([]) })
