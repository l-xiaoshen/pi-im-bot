import { z } from 'zod'
import { PluginIdSchema, PluginGrantSchema, PluginManifestSchema, PluginPathSchema } from './manifest'
import { ConfigDefinitionSchema } from './configuration/schema'
import { PluginOriginSchema } from './install/origin'

export const PluginInstanceSchema = z
  .object({
    id: PluginIdSchema,
    name: z.string().min(1).max(100),
    enabled: z.boolean().default(false),
    sourceDir: z.string().min(1).max(4096),
    release: z
      .string()
      .regex(/^[a-f0-9]{64}$/u)
      .optional(),
    settings: z.record(z.string(), z.json()).default({}),
    grants: z.array(PluginGrantSchema).max(100).default([]),
    services: z.record(PluginIdSchema, PluginIdSchema).default({}),
    connectors: z.record(PluginIdSchema, PluginIdSchema).default({}),
    dependencies: z.record(PluginIdSchema, PluginIdSchema).default({})
  })
  .strict()
export type PluginInstance = z.infer<typeof PluginInstanceSchema>
export const PluginPackageSchema = z
  .object({
    instanceId: PluginIdSchema,
    configRevision: z.string().regex(/^[a-f0-9]{64}$/u),
    revision: z.string().regex(/^[a-f0-9]{64}$/u),
    importedAt: z.number().int().nonnegative(),
    manifest: PluginManifestSchema,
    configuration: ConfigDefinitionSchema.optional(),
    origin: PluginOriginSchema.optional(),
    updateSourceId: z.uuid().optional(),
    files: z
      .array(
        z.object({
          path: PluginPathSchema,
          bytes: z
            .number()
            .int()
            .min(0)
            .max(16 * 1024 * 1024),
          sha256: z.string().regex(/^[a-f0-9]{64}$/u)
        })
      )
      .min(2)
      .max(2004)
  })
  .superRefine((value, context) => {
    const paths = value.files.map((file) => {
      return file.path
    })
    const expected = new Set(['plugin.json', ...value.manifest.files])
    for (const path of ['_conf_schema.json', 'README.md', 'CHANGELOG.md']) {
      if (paths.includes(path)) {
        expected.add(path)
      }
    }
    if (value.configuration && !paths.includes('_conf_schema.json')) {
      context.addIssue({ code: 'custom', message: '配置 schema 缺少对应的固定文件' })
    }
    if (
      new Set(paths).size !== paths.length ||
      paths.length !== expected.size ||
      paths.some((path) => {
        return !expected.has(path)
      })
    ) {
      context.addIssue({ code: 'custom', message: '插件快照文件列表与声明不一致' })
    }
    if (
      value.files.reduce((sum, file) => {
        return sum + file.bytes
      }, 0) >
      64 * 1024 * 1024
    ) {
      context.addIssue({ code: 'custom', message: '插件快照超过 64 MiB' })
    }
  })
export type PluginPackage = z.infer<typeof PluginPackageSchema>
export const PluginCatalogSchema = z.object({ packages: z.array(PluginPackageSchema).max(512).default([]) })
export const PluginOverridesSchema = z.object({
  priorities: z.record(z.string(), z.number().int().min(-100000).max(100000)).default({}),
  disabled: z.record(z.string(), z.boolean()).default({}),
  settings: z.record(PluginIdSchema, z.record(z.string(), z.json())).default({})
})
export type PluginOverrides = z.infer<typeof PluginOverridesSchema>
