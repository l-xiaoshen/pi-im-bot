import { z } from 'zod'
export const MessageFormatSchema = z.enum(['direct', 'forward'])
export const BusinessItemSchema = z.object({
  item: z.number().int().min(0).max(15),
  status: z.string().max(40),
  artifactIds: z.array(z.uuid()).max(16),
  requestArtifactId: z.uuid().optional(),
  workflow: z.string().optional(),
  workflowDigest: z.string().optional()
})
export const BusinessStatusSchema = z.enum(['succeeded', 'partial', 'failed', 'unknown'])
