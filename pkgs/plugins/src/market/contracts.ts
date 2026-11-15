import { z } from 'zod'
import { PluginUrlSchema } from '../install/url'
import { PluginIdSchema } from '../manifest'

export const PluginCatalogSourceSchema = z
  .object({ id: PluginIdSchema, name: z.string().min(1).max(100), url: PluginUrlSchema })
  .strict()
export const CatalogReleaseSchema = z
  .object({
    id: PluginIdSchema,
    name: z.string().min(1).max(100),
    description: z.string().max(2000),
    version: z.string().regex(/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/u),
    author: z.string().max(100).default(''),
    categories: z.array(z.string().max(40)).max(8).default([]),
    apiVersion: z.literal(1),
    url: PluginUrlSchema,
    sha256: z.string().regex(/^[a-f0-9]{64}$/u)
  })
  .strict()
export const PluginIndexSchema = z
  .object({ version: z.literal(1), plugins: z.array(CatalogReleaseSchema).max(200) })
  .strict()
export const MarketEntrySchema = CatalogReleaseSchema.omit({ url: true, sha256: true }).extend({
  key: z.string(),
  source: z.string(),
  installedId: z.string().optional(),
  installedVersion: z.string().optional(),
  updateAvailable: z.boolean().default(false)
})
export const MarketViewSchema = z.object({
  entries: z.array(MarketEntrySchema),
  sources: z.array(PluginCatalogSourceSchema),
  errors: z.array(z.string())
})
