import type { Provider, Model, Api, AssistantMessageEventStream } from '@earendil-works/pi-ai'
import { fauxAssistantMessage } from '@earendil-works/pi-ai/providers/faux'
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai/utils/event-stream'
import type { Configuration } from '@pi-im-bot/config/load'
import type { Room } from '@pi-im-bot/contracts/message'
import type { PreparedRunInput } from '@pi-im-bot/contracts/run'
import type { AgentCallbacks } from '../events'
import { createResponsesStream } from '@pi-im-bot/providers/responses'
import { createDemoProvider, prepareDemo } from '../demo'
import { limitedStream, type ModelPermit } from './limited-stream'

export function runProvider(
  id: string,
  config: Configuration,
  room: Room,
  input: PreparedRunInput,
  callbacks: AgentCallbacks,
  acquire: ModelPermit,
  assertActive: () => void,
  spent = 0
): Provider {
  if (room.mode === 'demo') {
    const demo = createDemoProvider()
    prepareDemo(demo, input.text)
    const model: Model<Api> = { ...demo.getModel(), provider: id }
    function observe(native: AssistantMessageEventStream) {
      const output = createAssistantMessageEventStream()
      void (async () => {
        let preview = ''
        for await (const event of native) {
          if (event.type === 'text_delta') {
            preview += event.delta
            callbacks.preview(preview)
          }
          output.push(event)
        }
        const result = await native.result()
        callbacks.provider({
          provider: 'offline-demo',
          model: result.model,
          attempt: 1,
          status: 'completed',
          usage: result.usage
        })
        output.end(result)
      })().catch((error) => {
        const failure = fauxAssistantMessage('', { stopReason: 'error', errorMessage: String(error) })
        output.push({ type: 'error', reason: 'error', error: failure })
        output.end(failure)
      })
      return output
    }
    return {
      ...demo.provider,
      id,
      getModels() {
        return [model]
      },
      stream(selected, context, options) {
        return limitedStream(selected, options?.signal, acquire, assertActive, () => {
          return observe(demo.provider.stream(selected, context, options))
        })
      },
      streamSimple(selected, context, options) {
        return limitedStream(selected, options?.signal, acquire, assertActive, () => {
          return observe(demo.provider.streamSimple(selected, context, options))
        })
      }
    }
  }
  const group = input.context.effective.settings.preferences.providerGroup
  const candidates = config.catalog.forGroup(group)
  if (candidates.length === 0) {
    throw new Error(`模型组 ${group} 尚未配置可用模型`)
  }
  const first = candidates[0].model
  const model: Model<Api> = {
    ...first,
    input: ['text'],
    id: 'agent',
    provider: id,
    contextWindow: Math.min(
      ...candidates.map((candidate) => {
        return candidate.config.contextWindow
      })
    ),
    maxTokens: Math.min(
      ...candidates.map((candidate) => {
        return candidate.config.maxOutputTokens
      })
    )
  }
  if (
    candidates.some((candidate) => {
      return candidate.config.images
    })
  ) {
    model.input.push('image')
  }
  const stream = createResponsesStream(
    config.catalog,
    group,
    { attempt: callbacks.provider, preview: callbacks.preview },
    Math.max(0, input.context.effective.settings.behavior.maxModelCalls - spent)
  )
  return {
    id,
    name: 'Bot model gateway',
    auth: {
      apiKey: {
        name: 'Bot gateway',
        async resolve() {
          return { auth: { apiKey: 'internal-gateway' }, source: 'Bot configuration' }
        }
      }
    },
    getModels() {
      return [model]
    },
    stream(selected, context, options) {
      return limitedStream(selected, options?.signal, acquire, assertActive, () => {
        return stream(selected, context, {
          signal: options?.signal,
          headers: options?.headers,
          onPayload: options?.onPayload
        })
      })
    },
    streamSimple(selected, context, options) {
      return limitedStream(selected, options?.signal, acquire, assertActive, () => {
        return stream(selected, context, options)
      })
    }
  }
}
