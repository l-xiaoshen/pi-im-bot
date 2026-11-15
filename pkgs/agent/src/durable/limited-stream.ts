import type { AssistantMessageEventStream, Model, Api } from '@earendil-works/pi-ai'
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai/utils/event-stream'
import { fauxAssistantMessage } from '@earendil-works/pi-ai/providers/faux'

export type ModelPermit = (signal?: AbortSignal) => Promise<() => void>

export function limitedStream(
  model: Model<Api>,
  signal: AbortSignal | undefined,
  acquire: ModelPermit,
  assertActive: () => void,
  start: () => AssistantMessageEventStream
) {
  const output = createAssistantMessageEventStream()
  void (async () => {
    assertActive()
    const release = await acquire(signal)
    try {
      signal?.throwIfAborted()
      assertActive()
      const stream = start()
      for await (const event of stream) {
        output.push(event)
      }
      output.end(await stream.result())
    } finally {
      release()
    }
  })().catch((error) => {
    let reason: 'error' | 'aborted' = 'error'
    if (signal?.aborted) {
      reason = 'aborted'
    }
    const result = {
      ...fauxAssistantMessage('', { stopReason: reason, errorMessage: String(error) }),
      api: model.api,
      model: model.id,
      provider: model.provider
    }
    output.push({ type: 'error', reason, error: result })
    output.end(result)
  })
  return output
}
