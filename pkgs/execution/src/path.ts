import { posix } from 'node:path'
import { z } from 'zod'

export const GUEST_WORKSPACE = '/workspace'
// Pi probes local paths before calling ReadOperations. Keep these probes in a
// synthetic namespace instead of probing host /etc or /home for guest paths.
export const VIRTUAL_ROOT = '/__pi_remote_sandbox__'
const PathSchema = z
  .string()
  .min(1)
  .max(4096)
  .refine((value) => {
    return !value.includes('\0')
  }, 'Invalid container path')

export function guestPath(input: string) {
  return posix.resolve(GUEST_WORKSPACE, PathSchema.parse(input))
}

export function virtualPath(path: string, scope = 'guest') {
  return VIRTUAL_ROOT + '/' + scope + guestPath(path)
}

export function containerPath(path: string) {
  if (!path.startsWith(VIRTUAL_ROOT + '/')) {
    throw new Error('Invalid remote tool path')
  }
  const start = path.indexOf('/', VIRTUAL_ROOT.length + 1)
  if (start < 0) {
    return '/'
  }
  return path.slice(start)
}

export function displayContainerPaths(text: string) {
  return text.replace(/\/__pi_remote_sandbox__\/[a-zA-Z0-9_-]+/gu, '')
}
