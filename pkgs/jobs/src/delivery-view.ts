import { z } from 'zod'
import { OutboundSchema } from '@pi-im-bot/contracts/delivery'
export const JobDeliveryViewSchema = z.object({
  delivery: OutboundSchema.pick({
    state: true,
    format: true,
    effectiveFormat: true,
    deliveryParts: true,
    platformMessageIds: true,
    sentAt: true,
    error: true
  }).nullable()
})
