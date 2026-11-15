import { defineDoc } from '@earendil-works/pi-durable'
import type { ObserverRecord } from './schema'

export const ObserverIndex = defineDoc<{
  requests: Record<string, ObserverRecord>
  recent: ObserverRecord[]
}>({
  kind: 'bot.plugin-observers',
  version: 1,
  scope: 'session',
  initial: () => ({ requests: {}, recent: [] }),
  checkpointWhen: () => false
})
