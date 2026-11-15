import { z } from 'zod'
import { ParametersSchema } from './compile'
export const ComfyInputSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('catalog'),
      workflow: z.string().max(32).optional(),
      section: z.enum(['workflows', 'parameters', 'models', 'loras']).default('workflows'),
      cursor: z.number().int().min(0).max(10000).default(0)
    })
    .strict(),
  z
    .object({
      action: z.literal('submit'),
      item: z.number().int().min(0).max(15),
      workflow: z.string().min(1).max(32),
      parameters: ParametersSchema
    })
    .strict(),
  z
    .object({
      action: z.enum(['recover', 'poll', 'cancel', 'reconcile', 'peek']),
      item: z.number().int().min(0).max(15)
    })
    .strict()
])
export const ComfyItemSchema = z.object({
  item: z.number().int(),
  status: z.enum([
    'not_started',
    'submitted',
    'running',
    'succeeded',
    'failed',
    'cancelled',
    'outcome_unknown',
    'abandoned'
  ]),
  recordId: z.string().optional(),
  attempted: z.boolean().default(false),
  hasReceipt: z.boolean(),
  artifactIds: z.array(z.uuid()).max(16).default([]),
  requestArtifactId: z.uuid().optional(),
  workflow: z.string().optional(),
  workflowDigest: z.string().optional(),
  error: z.string().max(300).optional()
})
export type ComfyItem = z.infer<typeof ComfyItemSchema>
