import { z } from 'zod'

export function patchPathSegments(path: string) {
  if (!path.startsWith('/') || /~(?![01])/u.test(path)) {
    throw new Error('插件 patch 路径不是有效的 JSON Pointer')
  }
  const parts = path
    .slice(1)
    .split('/')
    .map((part) => {
      return part.replaceAll('~1', '/').replaceAll('~0', '~')
    })
  if (
    parts.some((part) => {
      return !part || ['__proto__', 'constructor', 'prototype'].includes(part)
    })
  ) {
    throw new Error('插件 patch 路径不可写')
  }
  return parts
}

export const PatchPathSchema = z
  .string()
  .max(500)
  .superRefine((path, context) => {
    try {
      patchPathSegments(path)
    } catch (error) {
      context.addIssue({ code: 'custom', message: String(error) })
    }
  })

export function writablePath(path: readonly string[], writable: readonly string[][]) {
  return writable.some((allowed) => {
    return (
      allowed.length <= path.length &&
      allowed.every((segment, index) => {
        return segment === path[index]
      })
    )
  })
}
