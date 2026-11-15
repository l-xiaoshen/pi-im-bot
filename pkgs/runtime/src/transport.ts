import type { ChannelRegistry } from '@pi-im-bot/channels/registry'
import type { Address } from '@pi-im-bot/contracts/message'
import type { ChannelMedia, SendControl } from '@pi-im-bot/contracts/channel-media'
import { PartialDelivery } from '@pi-im-bot/contracts/channel-media'

export async function sendTransport(
  channels: ChannelRegistry,
  address: Address,
  text: string,
  media: readonly ChannelMedia[],
  format: 'direct' | 'forward',
  itemized: boolean,
  control: SendControl,
  part: (artifactIds: string[], ids: string[]) => void
) {
  const adapter = channels.get(address.channel)
  if (format === 'forward' && adapter.capabilities.forward && adapter.sendForward) {
    const receipt = await adapter.sendForward(address, text, media, control)
    part(
      media.map((file) => {
        return file.id
      }),
      receipt.messageIds
    )
    return receipt
  }
  if (!itemized || media.length === 0) {
    return channels.send(address, text, media, control)
  }
  let ids: string[] = []
  let sentAt = Date.now()
  try {
    for (const [index, file] of media.entries()) {
      let body = ''
      if (index === 0) {
        body = text
      }
      const prior = ids
      const receipt = await channels.send(address, body, [file], {
        beforePart: control.beforePart,
        received: async (current, at) => {
          ids = [...new Set([...prior, ...current])]
          sentAt = at
          await control.received?.(ids, at)
        }
      })
      ids = [...new Set([...prior, ...receipt.messageIds])]
      sentAt = receipt.sentAt
      part([file.id], receipt.messageIds)
      await control.received?.(ids, sentAt)
    }
  } catch (error) {
    let cause = error
    if (error instanceof PartialDelivery) {
      ids = [...new Set([...ids, ...error.messageIds])]
      cause = error.cause
    }
    if (ids.length) {
      throw new PartialDelivery(ids, sentAt, cause)
    }
    throw error
  }
  return { messageIds: ids, sentAt }
}
