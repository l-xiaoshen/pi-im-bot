import { z } from 'zod'
import { BACKGROUND_CONTEXT, awaitWithContext, withAbortSignal } from '@earendil-works/chord/context'
import { revision } from '@pi-im-bot/settings/resolve'
import type { PluginRegistry } from '../registry'
import type { OrderedHook } from './order'
import { applyHookPatch } from './patch'

export interface PluginHookTrace {
  point: string
  handler: string
  outcome: 'applied' | 'skipped' | 'failed'
  elapsedMs: number
  error?: string
}

export type HookInvoker = (
  handler: OrderedHook,
  input: unknown,
  inputRevision: string,
  signal: AbortSignal
) => Promise<unknown>

/** A failed patch never reaches the next handler, even when it contained earlier valid writes. */
export async function transformPluginPoint<Schema extends z.ZodType>(input: {
  registry: PluginRegistry
  point: string
  selector: Parameters<PluginRegistry['plan']>[1]
  value: z.input<Schema>
  schema: Schema
  invoke: HookInvoker
  signal: AbortSignal
  report?: (trace: PluginHookTrace) => void
  handlers?: readonly OrderedHook[]
}): Promise<z.output<Schema>> {
  const point = input.registry.points.get(input.point)
  if (!point || point.mode !== 'transform') {
    throw new Error('切入点不支持变换：' + input.point)
  }
  let value = input.schema.parse(input.value)
  const successful = new Set<string>()
  function report(trace: PluginHookTrace) {
    try {
      input.report?.(trace)
    } catch {
      /* A diagnostic sink cannot affect the transform transaction. */
    }
  }
  for (const handler of input.handlers ?? input.registry.plan(input.point, input.selector)) {
    input.signal.throwIfAborted()
    const startedAt = performance.now()
    const signal = AbortSignal.any([input.signal, AbortSignal.timeout(handler.hook.timeoutMs)])
    try {
      if (
        handler.hook.requires.some((key) => {
          return !successful.has(key)
        })
      ) {
        throw new Error('必需处理器未成功，跳过依赖结果的变换')
      }
      const pending = input.invoke(handler, structuredClone(value), revision(value), signal)
      const result = await awaitWithContext(pending, withAbortSignal(signal, BACKGROUND_CONTEXT))
      signal.throwIfAborted()
      const patched = applyHookPatch(value, result, handler.hook.writes ?? point.writable)
      const next = input.schema.parse(patched)
      signal.throwIfAborted()
      value = next
      successful.add(handler.key)
      report({
        point: input.point,
        handler: handler.key,
        outcome: 'applied',
        elapsedMs: performance.now() - startedAt
      })
    } catch (error) {
      input.signal.throwIfAborted()
      let outcome: PluginHookTrace['outcome'] = 'skipped'
      if (handler.hook.onError === 'fail') {
        outcome = 'failed'
      }
      report({
        point: input.point,
        handler: handler.key,
        outcome,
        elapsedMs: performance.now() - startedAt,
        error: String(error).slice(0, 500)
      })
      if (handler.hook.onError === 'fail') {
        throw error
      }
    }
  }
  return value
}
