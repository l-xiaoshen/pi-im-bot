import type { RunInput } from '@pi-im-bot/contracts/run'
import type { QueuedExecution } from './execution-request'
import type { Settings } from '@pi-im-bot/settings/schema'

interface PendingBatch {
  key: string
  execution: QueuedExecution
  firstAt: number
  lastAt: number
  timer?: ReturnType<typeof setTimeout>
  policy: Settings['behavior']
}
interface InboxHost {
  key(input: RunInput): string
  create(input: RunInput): QueuedExecution
  append(execution: QueuedExecution, input: RunInput): void
  dispatch(execution: QueuedExecution): void
}

/** One bounded window per chat scope, not per participant. */
export class ConversationInbox {
  private readonly pending = new Map<string, PendingBatch>()
  constructor(private readonly host: InboxHost) {}

  accept(input: RunInput, policy: Settings['behavior']) {
    const key = this.host.key(input)
    let batch = this.pending.get(input.roomId)
    if (
      batch &&
      (batch.key !== key || batch.execution.input.text.length + input.text.length > policy.batchMaxChars)
    ) {
      this.flush(input.roomId)
      batch = undefined
    }
    if (!batch) {
      batch = { key, execution: this.host.create(input), firstAt: Date.now(), lastAt: Date.now(), policy }
      this.pending.set(input.roomId, batch)
    } else {
      this.host.append(batch.execution, input)
      batch.lastAt = Date.now()
    }
    if (batch.timer) {
      clearTimeout(batch.timer)
    }
    const count = batch.execution.input.parts?.length ?? 1
    if (
      count >= policy.batchMaxRequests ||
      batch.execution.input.text.length >= policy.batchMaxChars ||
      policy.batchQuietMs === 0
    ) {
      this.flush(input.roomId)
    } else {
      const due = Math.min(batch.lastAt + policy.batchQuietMs, batch.firstAt + policy.batchMaxHoldMs)
      batch.timer = setTimeout(
        () => {
          this.flush(input.roomId)
        },
        Math.max(0, due - Date.now())
      )
    }
    return batch.execution.run
  }

  flush(roomId: string) {
    const batch = this.pending.get(roomId)
    if (!batch) {
      return
    }
    this.pending.delete(roomId)
    if (batch.timer) {
      clearTimeout(batch.timer)
    }
    if (!batch.execution.controller.signal.aborted) {
      this.host.dispatch(batch.execution)
    }
  }

  discard(roomId: string) {
    const batch = this.pending.get(roomId)
    if (!batch) {
      return
    }
    if (batch.timer) {
      clearTimeout(batch.timer)
    }
    this.pending.delete(roomId)
  }

  close() {
    for (const roomId of this.pending.keys()) {
      this.discard(roomId)
    }
  }
}
