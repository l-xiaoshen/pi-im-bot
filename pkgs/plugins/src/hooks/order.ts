import type { PluginHook } from '../manifest'

export interface OrderedHook {
  key: string
  instanceId: string
  generation: string
  hook: PluginHook
  priority: number
}

/** Dependencies define the partial order; priority only chooses among eligible nodes. */
export function orderHooks(handlers: readonly OrderedHook[]) {
  const entries = new Map(
    handlers.map((entry) => {
      return [entry.key, entry]
    })
  )
  if (entries.size !== handlers.length) {
    throw new Error('切入点处理器 ID 重复')
  }
  const outgoing = new Map<string, Set<string>>()
  const degree = new Map(
    handlers.map((entry) => {
      return [entry.key, 0]
    })
  )
  function edge(before: string, after: string) {
    if (!entries.has(before) || !entries.has(after)) {
      return
    }
    const targets = outgoing.get(before) ?? new Set<string>()
    if (!targets.has(after)) {
      targets.add(after)
      degree.set(after, degree.get(after)! + 1)
    }
    outgoing.set(before, targets)
  }
  for (const entry of handlers) {
    for (const dependency of entry.hook.requires) {
      if (!entries.has(dependency)) {
        throw new Error(`${entry.key} 缺少必需处理器 ${dependency}`)
      }
      edge(dependency, entry.key)
    }
    for (const before of entry.hook.before) {
      edge(entry.key, before)
    }
    for (const after of entry.hook.after) {
      edge(after, entry.key)
    }
  }
  const result: OrderedHook[] = []
  const remaining = new Set(entries.keys())
  while (remaining.size > 0) {
    const eligible = [...remaining]
      .filter((id) => {
        return degree.get(id) === 0
      })
      .map((id) => {
        return entries.get(id)!
      })
      .sort((a, b) => {
        if (a.priority !== b.priority) {
          return b.priority - a.priority
        }
        if (a.key < b.key) {
          return -1
        }
        if (a.key > b.key) {
          return 1
        }
        return 0
      })
    const entry = eligible[0]
    if (!entry) {
      throw new Error('切入点顺序存在环路：' + [...remaining].join(' → '))
    }
    result.push(entry)
    remaining.delete(entry.key)
    for (const target of outgoing.get(entry.key) ?? []) {
      degree.set(target, degree.get(target)! - 1)
    }
  }
  return result
}
