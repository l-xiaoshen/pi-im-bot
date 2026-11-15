import { z } from 'zod'
export const GsviCatalogueSchema = z
  .object({
    status: z.literal('catalogue'),
    reference: z.uuid(),
    listReference: z.uuid(),
    count: z.number().int().nonnegative(),
    version: z.enum(['v1', 'v2', 'v4'])
  })
  .strict()
export const GsviCatalogueReadSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('page'),
      reference: z.uuid(),
      offset: z.number().int().nonnegative().default(0)
    })
    .strict(),
  z
    .object({ action: z.literal('match'), reference: z.uuid(), voice: z.string(), emotion: z.string() })
    .strict()
])
export const GsviCataloguePageSchema = z
  .object({
    offset: z.number().int().nonnegative(),
    nextOffset: z.number().int().nonnegative(),
    bytes: z.number().int().nonnegative(),
    base64: z.string(),
    hasMore: z.boolean()
  })
  .strict()
export const GsviCatalogueMatchSchema = z.object({ exists: z.boolean(), emotion: z.boolean() }).strict()
