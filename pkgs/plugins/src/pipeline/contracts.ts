import { z } from 'zod'
import { HookModeSchema } from '../manifest'

export const PipelineViewSchema = z.object({
  revision: z.string(),
  nodes: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      stage: z.string(),
      position: z.enum(['before', 'after']),
      mode: HookModeSchema,
      summary: z.string(),
      flow: z.string(),
      source: z.string(),
      writable: z.array(z.string()),
      input: z.record(z.string(), z.json()),
      output: z.record(z.string(), z.json()),
      handlers: z.array(
        z.object({
          key: z.string(),
          pluginId: z.string(),
          pluginName: z.string(),
          enabled: z.boolean(),
          available: z.boolean(),
          priority: z.number(),
          before: z.array(z.string()),
          after: z.array(z.string()),
          requires: z.array(z.string())
        })
      )
    })
  )
})
export const SavePipelineSchema = z
  .object({
    revision: z.string(),
    changes: z
      .array(
        z
          .object({
            key: z.string(),
            priority: z.number().int().min(-100000).max(100000),
            disabled: z.boolean()
          })
          .strict()
      )
      .max(200)
  })
  .strict()
