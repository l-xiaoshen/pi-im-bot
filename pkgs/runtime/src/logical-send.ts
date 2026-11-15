import type { ChatMessage } from '@pi-im-bot/contracts/message'
import type { z } from 'zod'
import type { LogicalMessageSchema } from '@pi-im-bot/contracts/logical-message'
import { DeliverySuppressed } from '@pi-im-bot/contracts/presentation'
import { DeliveryCancelled, DeliveryUncertain } from './delivery'
/** Each complete group owns a stable Outbox and its real ACK; controls never enter this list. */
export async function sendLogicalSequence(
  parts: Array<z.infer<typeof LogicalMessageSchema>>,
  send: (part: z.infer<typeof LogicalMessageSchema>, index: number) => Promise<ChatMessage>,
  check: () => void
) {
  const messages: Array<{ id: string; platformMessageIds: string[] }> = []
  const suppressed: number[] = []
  for (let index = 0; index < parts.length; index += 1) {
    check()
    try {
      const message = await send(parts[index], index)
      messages.push({ id: message.id, platformMessageIds: message.platformMessageIds })
    } catch (error) {
      check()
      if (error instanceof DeliveryCancelled) {
        throw error
      }
      if (error instanceof DeliverySuppressed) {
        suppressed.push(index)
        continue
      }
      return {
        complete: false,
        messages,
        suppressed,
        failedAt: index,
        uncertain: error instanceof DeliveryUncertain,
        instruction: 'Do not repeat completed or uncertain groups; inspect the original Outbox receipts.'
      }
    }
  }
  return { complete: suppressed.length === 0, messages, suppressed }
}
