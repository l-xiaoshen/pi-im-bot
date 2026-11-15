import type { ChannelAdapter } from "@pi-im-bot/contracts/channel"

export function createMockAdapter(): ChannelAdapter {
  return {
    id: "mock",
    capabilities: {
      text: true,
      images: true,
      audio: true,
      video: true,
      files: true,
      edit: false,
      recall: true,
      threads: true
    },
    async send(_address, _text, _media, control) {
      await control?.beforePart?.()
      return { messageIds: [crypto.randomUUID()], sentAt: Date.now() }
    },
    async recall() {}
  }
}
