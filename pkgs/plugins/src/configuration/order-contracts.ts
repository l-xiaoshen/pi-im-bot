import { z } from 'zod'
import { PluginConfigTargetSchema } from './contracts'

export const SavePluginOrderSchema = z
  .object({
    revision: z.string(),
    release: z.string(),
    target: PluginConfigTargetSchema,
    changes: z
      .array(
        z
          .object({
            key: z.string().max(100),
            priority: z.number().int().min(-100000).max(100000),
            disabled: z.boolean()
          })
          .strict()
      )
      .max(100),
    selected: z.boolean().optional(),
    reset: z.boolean().optional()
  })
  .strict()
export const PluginOrderViewSchema = z.object({
  revision: z.string(),
  release: z.string(),
  target: PluginConfigTargetSchema,
  selected: z.boolean(),
  handlers: z.array(
    z.object({
      key: z.string(),
      point: z.string(),
      priority: z.number(),
      disabled: z.boolean(),
      before: z.array(z.string()),
      after: z.array(z.string()),
      requires: z.array(z.string())
    })
  ),
  order: z.array(z.object({ point: z.string(), handlers: z.array(z.string()) })),
  error: z.string().optional()
})
