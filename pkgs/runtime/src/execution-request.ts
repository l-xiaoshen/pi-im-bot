import type { Configuration } from "@pi-im-bot/config/load"
import type { Room } from "@pi-im-bot/contracts/message"
import type { Run, PreparedRunInput } from "@pi-im-bot/contracts/run"

export interface QueuedExecution {
  config: Configuration
  room: Room
  input: PreparedRunInput
  run: Run
  controller: AbortController
}
