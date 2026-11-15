import { z } from 'zod'

export const ExternalStatusSchema = z.object({
  status: z.string(),
  message: z.string().optional(),
  nextPollAt: z.number().optional(),
  attempts: z.number().int().nonnegative().default(0),
  hasReceipt: z.boolean().default(false)
})
