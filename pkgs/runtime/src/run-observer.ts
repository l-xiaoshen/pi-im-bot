import type { Run, Trace } from "@pi-im-bot/contracts/run"
import type { AgentCallbacks } from "@pi-im-bot/agent/events"
import type { EventHub } from "@pi-im-bot/contracts/events"

export type RunTrace = Omit<Trace, "id" | "at" | "runId" | "roomId">

export function runObserver(
  run: Run,
  events: EventHub,
  update: () => void,
  trace: (event: RunTrace) => void
): AgentCallbacks {
  let lastPreview = 0
  return {
    trace,
    preview(text) {
      if (run.context?.jobId && run.context.conversationId !== run.context.rootConversationId && text) {
        return
      }
      if (text && Date.now() - lastPreview < 80) {
        return
      }
      lastPreview = Date.now()
      events.emit({ type: "preview", roomId: run.roomId, runId: run.id, text })
    },
    tool() {
      run.toolCalls += 1
      update()
    },
    provider(event) {
      if (event.status === "started" || run.mode === "demo") {
        run.modelCalls += 1
      }
      if (event.usage) {
        run.usage.input += event.usage.input
        run.usage.output += event.usage.output
        run.usage.cacheRead += event.usage.cacheRead
        run.usage.cacheWrite += event.usage.cacheWrite
      }
      update()
      trace({
        kind: "provider",
        title: `${event.provider} / ${event.model} · ${event.status}`,
        detail: event.error ?? "",
        provider: event.provider,
        model: event.model,
        attempt: event.attempt,
        durationMs: event.durationMs,
        usage: event.usage
      })
    }
  }
}
