import { ArtifactStore } from "@pi-im-bot/artifacts/store"
import type { RenderPlan } from "@pi-im-bot/contracts/rendering"
import type { PluginInvocation } from "../invocation"
import type { PluginService } from "../service"
import { completedPluginResult } from "../result"

/** Core-owned short rendering for a synchronous Agent tool send, outside the selector Hook. */
export async function inlinePresentation(
  service: PluginService,
  invocation: PluginInvocation,
  plan: RenderPlan,
  callId: string,
  parent: AbortSignal,
  deadlineAt: number
) {
  function authorize() {
    parent.throwIfAborted()
    service.validateInlinePresentation(invocation, plan)
  }
  authorize()
  const remaining = Math.max(0, Math.min(10000, deadlineAt - Date.now()))
  if (!remaining) {
    return undefined
  }
  const signal = AbortSignal.any([parent, AbortSignal.timeout(Math.ceil(remaining))])
  try {
    const outcome = await service.executeInlinePresentation(
      invocation,
      plan.capability,
      plan.arguments,
      callId,
      signal,
      remaining
    )
    const result = completedPluginResult(outcome)
    authorize()
    signal.throwIfAborted()
    const artifacts = new ArtifactStore(invocation.config.dataDir, invocation.room.id)
    for (const id of result.artifactIds) {
      await artifacts.metadata(id)
    }
    signal.throwIfAborted()
    authorize()
    return { text: result.text, artifactIds: result.artifactIds }
  } catch {
    // Stop/revocation propagate. Only a local render failure/budget expiry falls back.
    authorize()
    return undefined
  }
}
