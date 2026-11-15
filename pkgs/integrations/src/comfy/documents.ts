import { defineDoc, defineDocFamily } from '@earendil-works/pi-durable'
import { z } from 'zod'
import { ComfyServiceSchema } from './resources'
import { ComfyItemSchema } from './protocol'
export const ReceiptSchema = z.object({
  key: z.string(),
  instance: z.string(),
  room: z.string(),
  job: z.string(),
  revision: z.number().int(),
  item: z.number().int(),
  service: ComfyServiceSchema,
  serviceRevision: z.string(),
  workflow: z.string(),
  workflowDigest: z.string(),
  parametersDigest: z.string(),
  outputs: z.array(z.string()),
  status: ComfyItemSchema.shape.status,
  promptId: z.string().optional(),
  requestArtifactId: z.uuid(),
  artifactIds: z.array(z.uuid()).default([]),
  recorded: z.boolean().default(false),
  dispatched: z.boolean(),
  cancelDispatched: z.boolean().default(false),
  createdAt: z.number(),
  error: z.string().max(300).optional()
})
export type Receipt = z.infer<typeof ReceiptSchema>
export const ComfyReceipts = defineDocFamily<{ value: Receipt | null }, null>({
  kind: 'bot.comfy-receipt',
  version: 1,
  scope: 'session',
  family: true,
  initial: () => ({ value: null }),
  checkpointWhen: () => false
})
export const ComfyActive = defineDoc<{ owners: Record<string, { room: string; instance: string }> }>({
  kind: 'bot.comfy-active',
  version: 1,
  scope: 'session',
  initial: () => ({ owners: {} }),
  checkpointWhen: () => true
})
