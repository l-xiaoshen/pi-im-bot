import { deadlineScope } from "@pi-im-bot/support/deadline"
export function gsviDeadline(parent: AbortSignal, timeoutMs: number) {
  return deadlineScope(parent, Date.now() + timeoutMs)
}
