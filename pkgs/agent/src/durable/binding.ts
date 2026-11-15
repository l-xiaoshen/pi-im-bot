import type { Extension } from "@earendil-works/pi-durable"
import type { Configuration } from "@pi-im-bot/config/load"
import type { Room } from "@pi-im-bot/contracts/message"
import type { PreparedRunInput } from "@pi-im-bot/contracts/run"
import type { AgentCallbacks } from "../events"
import type { HostToolServices } from "../host-tools"
import type { createToolkit } from "../toolkit"
import type { runProvider } from "./model"

export interface DurableBinding {
  id: string
  config: Configuration
  room: Room
  input: PreparedRunInput
  signal: AbortSignal
  services: HostToolServices
  callbacks: AgentCallbacks
  toolkit: ReturnType<typeof createToolkit>
  provider: ReturnType<typeof runProvider>
  extension: Extension
}
