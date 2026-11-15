import { expect, test } from 'bun:test'
import { ChatMessageSchema } from '@pi-im-bot/contracts/message'
import { LogicalMessageSchema } from '@pi-im-bot/contracts/logical-message'
import { DeliverySuppressed } from '@pi-im-bot/contracts/presentation'
import { DeliveryUncertain } from '@pi-im-bot/runtime/delivery'
import { sendLogicalSequence } from '@pi-im-bot/runtime/logical-send'
import { deadlineScope } from '@pi-im-bot/support/deadline'

// Plain in-memory receipt handling only: no DeliveryService, plugin or service operation runs.
function receipt(index: number) {
  return ChatMessageSchema.parse({
    id: 'receipt-' + index,
    roomId: 'local',
    role: 'assistant',
    actorId: 'bot',
    actorName: 'Bot',
    text: 'part ' + index,
    platformMessageIds: ['ack-' + index],
    createdAt: 0
  })
}

test('an uncertain group retains earlier ACKs and prevents later sends', async () => {
  const calls: number[] = []
  const parts = ['first', 'second', 'third'].map((text) => LogicalMessageSchema.parse({ text }))
  const result = await sendLogicalSequence(
    parts,
    async (_part, index) => {
      calls.push(index)
      if (index === 1) {
        throw new DeliveryUncertain('transport result unknown')
      }
      return receipt(index)
    },
    () => {}
  )
  expect(calls).toEqual([0, 1])
  expect(result).toMatchObject({
    complete: false,
    failedAt: 1,
    uncertain: true,
    messages: [{ id: 'receipt-0', platformMessageIds: ['ack-0'] }]
  })
})

test('mixed logical groups remain whole and suppression affects only its own group', async () => {
  const artifact = crypto.randomUUID()
  const parts = [
    LogicalMessageSchema.parse({ text: 'mixed', artifactIds: [artifact] }),
    LogicalMessageSchema.parse({ text: 'suppressed' }),
    LogicalMessageSchema.parse({ text: 'last' })
  ]
  const seen: typeof parts = []
  const result = await sendLogicalSequence(
    parts,
    async (part, index) => {
      seen.push(part)
      if (index === 1) {
        throw new DeliverySuppressed('suppressed')
      }
      return receipt(index)
    },
    () => {}
  )
  expect(seen).toEqual(parts)
  expect(result.suppressed).toEqual([1])
  expect(result.messages.map((entry) => entry.id)).toEqual(['receipt-0', 'receipt-2'])
  expect(result.complete).toBe(false)
})

test('cancellation stops a sequence before the next logical group', async () => {
  const controller = new AbortController()
  const calls: number[] = []
  const parts = ['first', 'second'].map((text) => LogicalMessageSchema.parse({ text }))
  const pending = sendLogicalSequence(
    parts,
    async (_part, index) => {
      calls.push(index)
      controller.abort(new Error('stopped'))
      return receipt(index)
    },
    () => controller.signal.throwIfAborted()
  )
  await expect(pending).rejects.toThrow('stopped')
  expect(calls).toEqual([0])
})

test('long deadlines do not overflow timers and parent cancellation remains immediate', async () => {
  const parent = new AbortController()
  const deadline = deadlineScope(parent.signal, Date.now() + 2147483647 + 10000)
  try {
    await Bun.sleep(5)
    expect(deadline.signal.aborted).toBe(false)
    parent.abort(new Error('parent stopped'))
    expect(deadline.signal.aborted).toBe(true)
    expect(deadline.signal.reason.message).toBe('parent stopped')
  } finally {
    deadline.close()
  }
  const expired = deadlineScope(new AbortController().signal, Date.now() - 1)
  expect(expired.signal.aborted).toBe(true)
  expired.close()
})
