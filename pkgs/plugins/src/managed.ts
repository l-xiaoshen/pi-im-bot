import type { PluginStateStore } from './state/store'
import type { ComfyBroker } from '@pi-im-bot/integrations/comfy/broker'
export interface PluginManagedServices {
  state: PluginStateStore
  comfy: ComfyBroker
}
