import { z } from 'zod'
import { BACKGROUND_CONTEXT, awaitWithContext, withAbortSignal } from '@earendil-works/chord/context'
import { RunLimiter } from '@pi-im-bot/support/limiter'
import { revision } from '@pi-im-bot/settings/resolve'
import type { OrderedHook } from './order'
import type { HookInvoker, PluginHookTrace } from './transform'

export interface HookDispatch {
  invoke: HookInvoker
  signal: AbortSignal
  report(trace: PluginHookTrace): void
}

async function callHook<Schema extends z.ZodType>(
  dispatch: HookDispatch,
  entry: OrderedHook,
  input: unknown,
  schema: Schema
) {
  dispatch.signal.throwIfAborted()
  const signal = AbortSignal.any([dispatch.signal, AbortSignal.timeout(entry.hook.timeoutMs)])
  const started = performance.now()
  try {
    const result = await awaitWithContext(
      dispatch.invoke(entry, structuredClone(input), revision(input), signal),
      withAbortSignal(signal, BACKGROUND_CONTEXT)
    )
    signal.throwIfAborted()
    const output = schema.parse(result)
    dispatch.report({
      point: entry.hook.point,
      handler: entry.key,
      outcome: 'applied',
      elapsedMs: performance.now() - started
    })
    return { success: true as const, output }
  } catch (error) {
    dispatch.signal.throwIfAborted()
    dispatch.report({
      point: entry.hook.point,
      handler: entry.key,
      outcome: 'skipped',
      elapsedMs: performance.now() - started,
      error: String(error).slice(0, 500)
    })
    if (entry.hook.onError === 'fail' || entry.hook.mode === 'policy') {
      throw error
    }
    return { success: false as const }
  }
}

function dependencies(entry: OrderedHook, successful: ReadonlySet<string>) {
  if (
    entry.hook.requires.some((key) => {
      return !successful.has(key)
    })
  ) {
    throw new Error('必需处理器未成功：' + entry.key)
  }
}

export async function decidePluginPoint<Schema extends z.ZodType>(
  entries: readonly OrderedHook[],
  input: unknown,
  schema: Schema,
  dispatch: HookDispatch,
  accept: (output: z.output<Schema>) => boolean
) {
  const successful = new Set<string>()
  for (const entry of entries) {
    try {
      dependencies(entry, successful)
    } catch (error) {
      if (entry.hook.onError === 'fail' || entry.hook.mode === 'policy') {
        throw error
      }
      dispatch.report({
        point: entry.hook.point,
        handler: entry.key,
        outcome: 'skipped',
        elapsedMs: 0,
        error: String(error)
      })
      continue
    }
    const result = await callHook(dispatch, entry, input, schema)
    if (!result.success) {
      continue
    }
    successful.add(entry.key)
    if (accept(result.output)) {
      return { handler: entry.key, output: result.output }
    }
  }
  return undefined
}

export async function collectPluginPoint<Schema extends z.ZodType>(
  entries: readonly OrderedHook[],
  input: unknown,
  schema: Schema,
  dispatch: HookDispatch,
  concurrency: number
) {
  const slots = new RunLimiter(concurrency)
  const pending = new Map<string, Promise<Awaited<ReturnType<typeof callHook<Schema>>>>>()
  for (const entry of entries) {
    const required = entry.hook.requires.map((key) => {
      return pending.get(key)
    })
    const work = (async () => {
      const prior = await Promise.all(required)
      if (
        prior.some((result) => {
          return !result?.success
        })
      ) {
        if (entry.hook.onError === 'fail') {
          throw new Error('必需上下文来源未成功：' + entry.key)
        }
        dispatch.report({
          point: entry.hook.point,
          handler: entry.key,
          outcome: 'skipped',
          elapsedMs: 0,
          error: '必需上下文来源未成功'
        })
        return { success: false as const }
      }
      const release = await slots.acquire(dispatch.signal)
      try {
        return await callHook(dispatch, entry, input, schema)
      } finally {
        release()
      }
    })()
    void work.catch(() => {})
    pending.set(entry.key, work)
  }
  const values = await Promise.all([...pending.values()])
  return entries.flatMap((entry, index) => {
    const result = values[index]
    if (!result.success) {
      return []
    }
    return [{ handler: entry.key, output: result.output }]
  })
}
