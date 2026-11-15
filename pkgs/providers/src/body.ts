import { z } from 'zod'

const ObjectSchema = z.record(z.string(), z.unknown())

export function mergeBody(base: Record<string, unknown>, override: Record<string, unknown>) {
  const result = new Map(Object.entries(base))
  for (const [key, value] of Object.entries(override)) {
    const previous = ObjectSchema.safeParse(result.get(key))
    const next = ObjectSchema.safeParse(value)
    if (previous.success && next.success) {
      result.set(key, mergeBody(previous.data, next.data))
    } else {
      result.set(key, value)
    }
  }
  return Object.fromEntries(result)
}

export function mergeHeaders(...sets: Record<string, string | null>[]) {
  const result: Record<string, string | null> = {}
  for (const headers of sets) {
    for (const [name, value] of Object.entries(headers)) {
      result[name.toLowerCase()] = value
    }
  }
  return result
}

export function applyBody(payload: unknown, extra: Record<string, unknown>) {
  return mergeBody(ObjectSchema.parse(payload), extra)
}
