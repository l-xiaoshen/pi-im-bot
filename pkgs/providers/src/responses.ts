import type { StreamFn } from "@earendil-works/pi-agent-core"
import type { AssistantMessage, AssistantMessageEvent, AssistantMessageEventStream } from "@earendil-works/pi-ai"
import { streamSimple } from "@earendil-works/pi-ai/api/openai-responses"
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai/utils/event-stream"
import { applyBody, mergeBody } from "./body"
import type { ProviderCatalog } from "./catalog"
import type { Candidate } from "./pool"
import type { Usage } from "@pi-im-bot/contracts/run"

export interface ProviderAttempt {
  provider: string
  model: string
  attempt: number
  status: "started" | "completed" | "failed" | "cancelled"
  durationMs?: number
  httpStatus?: number
  error?: string
  usage?: Usage
}

export interface ProviderObserver {
  attempt(event: ProviderAttempt): void
  preview(text: string): void
}

export type ResponsesStream = (...args: Parameters<StreamFn>) => AssistantMessageEventStream

function failure(candidate: Candidate, error: string, aborted = false): AssistantMessage {
  let stopReason: "error" | "aborted" = "error"
  if (aborted) {
    stopReason = "aborted"
  }
  return {
    role: "assistant",
    content: [],
    api: "openai-responses",
    provider: candidate.provider.id,
    model: candidate.config.id,
    stopReason,
    errorMessage: error,
    timestamp: Date.now(),
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
    }
  }
}

export function createResponsesStream(
  catalog: ProviderCatalog,
  groupId: string,
  observer: ProviderObserver,
  maxRequests = Number.POSITIVE_INFINITY
): ResponsesStream {
  const group = catalog.group(groupId)
  const candidates = catalog.forGroup(groupId)
  if (candidates.length === 0) {
    throw new Error(`Provider group ${groupId} has no enabled providers. Fill config/providers.json and reload.`)
  }
  let preferred: string | undefined
  let requests = 0

  return (_selectedModel, context, options) => {
    const output = createAssistantMessageEventStream()
    async function execute() {
      let finalError = failure(candidates[0], "No provider completed the request")
      let attempt = 0
      const needsImages = context.messages.some((message) => {
        return (
          (message.role === "user" || message.role === "toolResult") &&
          Array.isArray(message.content) &&
          message.content.some((part) => {
            return part.type === "image"
          })
        )
      })
      const eligible = catalog.pool.order(
        candidates.filter((candidate) => {
          return !needsImages || candidate.config.images
        }),
        preferred
      )
      if (eligible.length === 0 && needsImages) {
        finalError = failure(candidates[0], "此模型组没有可用的图片模型")
      }
      for (const candidate of eligible) {
        if (options?.signal?.aborted) {
          finalError = failure(candidate, "Request cancelled", true)
          break
        }
        if (requests >= maxRequests) {
          finalError = failure(candidate, `模型请求达到本轮上限 ${maxRequests}`)
          break
        }
        requests += 1
        attempt += 1
        const started = performance.now()
        observer.preview("")
        observer.attempt({
          provider: candidate.provider.id,
          model: candidate.config.id,
          attempt,
          status: "started"
        })
        const controller = new AbortController()
        const timeout = setTimeout(() => {
          controller.abort(new Error("Provider deadline exceeded"))
        }, candidate.provider.timeoutMs)
        let signal = controller.signal
        if (options?.signal) {
          signal = AbortSignal.any([options.signal, controller.signal])
        }
        let httpStatus: number | undefined
        let preview = ""
        let success: AssistantMessage | undefined
        const buffered: AssistantMessageEvent[] = []
        try {
          const transportFetch: typeof fetch = Object.assign(
            async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
              const response = await fetch(input, init)
              httpStatus = response.status
              return response
            },
            { preconnect: fetch.preconnect }
          )
          const stream = streamSimple(candidate.model, context, {
            ...options,
            signal,
            apiKey: candidate.apiKey || "unused",
            headers: catalog.headers(candidate),
            fetch: transportFetch,
            maxRetries: 0,
            timeoutMs: candidate.provider.timeoutMs,
            async onPayload(payload, model) {
              const transformed = await options?.onPayload?.(payload, model)
              let base = payload
              if (transformed !== undefined) {
                base = transformed
              }
              return applyBody(base, mergeBody(candidate.provider.body, candidate.config.body))
            }
          })
          for await (const event of stream) {
            if (event.type === "text_delta") {
              preview += event.delta
              observer.preview(preview)
            }
            buffered.push(event)
          }
          const result = await stream.result()
          if (options?.signal?.aborted || result.stopReason === "error" || result.stopReason === "aborted") {
            finalError = result
            if (options?.signal?.aborted) {
              finalError = failure(candidate, "Request cancelled", true)
            } else {
              finalError.stopReason = "error"
              finalError.errorMessage = catalog.redact(result.errorMessage ?? "Provider request failed")
              if (controller.signal.aborted) {
                finalError.errorMessage = `Provider deadline exceeded (${candidate.provider.timeoutMs} ms)`
              }
            }
          } else {
            success = result
          }
        } catch (error) {
          finalError = failure(candidate, catalog.redact(String(error)), options?.signal?.aborted ?? false)
        } finally {
          clearTimeout(timeout)
        }
        if (success) {
          catalog.pool.succeeded(candidate)
          preferred = candidate.key
          // Observer failures must not cause another provider request.
          observer.attempt({
            provider: candidate.provider.id,
            model: candidate.config.id,
            attempt,
            status: "completed",
            durationMs: performance.now() - started,
            httpStatus,
            usage: success.usage
          })
          // Commit only a successful attempt to Pi. Failed partial text and tool calls never execute.
          for (const event of buffered) {
            output.push(event)
          }
          output.end(success)
          return
        }
        let status: "failed" | "cancelled" = "failed"
        if (finalError.stopReason === "aborted") {
          status = "cancelled"
        }
        observer.attempt({
          provider: candidate.provider.id,
          model: candidate.config.id,
          attempt,
          status,
          durationMs: performance.now() - started,
          httpStatus,
          error: finalError.errorMessage,
          usage: finalError.usage
        })
        if (status === "cancelled") {
          break
        }
        catalog.pool.failed(candidate, group, finalError.errorMessage ?? "Provider failed")
      }
      observer.preview("")
      let reason: "error" | "aborted" = "error"
      if (finalError.stopReason === "aborted") {
        reason = "aborted"
      }
      output.push({ type: "error", reason, error: finalError })
      output.end(finalError)
    }
    void execute().catch((error) => {
      const result = failure(candidates[0], catalog.redact(String(error)))
      output.push({ type: "error", reason: "error", error: result })
      output.end(result)
    })
    return output
  }
}
