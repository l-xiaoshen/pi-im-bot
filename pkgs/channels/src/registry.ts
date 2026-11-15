import type { ChannelAdapter } from '@pi-im-bot/contracts/channel'
import type { Address } from '@pi-im-bot/contracts/message'
import type { ChannelMedia, SendControl } from '@pi-im-bot/contracts/channel-media'

export class ChannelRegistry {
  private readonly adapters = new Map<string, ChannelAdapter>()
  register(adapter: ChannelAdapter) {
    this.adapters.set(adapter.id, adapter)
  }
  get(id: string) {
    const adapter = this.adapters.get(id)
    if (!adapter) {
      throw new Error(`Channel adapter is not installed: ${id}`)
    }
    return adapter
  }
  send(address: Address, text: string, media?: readonly ChannelMedia[], control?: SendControl) {
    return this.get(address.channel).send(address, text, media, control)
  }
}
