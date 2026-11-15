import { RunLimiter } from '@pi-im-bot/support/limiter'
import type { ComfyService } from './resources'
import { ComfyTransportError } from './errors'
const requests = new RunLimiter(4)
const downloads = new RunLimiter(2)
const services = new Map<string, { slots: RunLimiter; users: number }>()
let requestUsers = 0
let downloadUsers = 0
export async function withComfyHttp<T>(
  service: ComfyService,
  signal: AbortSignal,
  write: boolean,
  action: () => Promise<T>
): Promise<T> {
  if (requestUsers >= 64) {
    if (write) {
      throw new ComfyTransportError('rejected')
    }
    throw new ComfyTransportError('read')
  }
  requestUsers += 1
  const key = service.id + '|' + service.url
  let entry = services.get(key)
  if (!entry) {
    entry = { slots: new RunLimiter(2), users: 0 }
    services.set(key, entry)
  }
  entry.users += 1
  let serviceLease: (() => void) | undefined
  let globalLease: (() => void) | undefined
  try {
    serviceLease = await entry.slots.acquire(signal)
    globalLease = await requests.acquire(signal)
    signal.throwIfAborted()
    return await action()
  } finally {
    globalLease?.()
    serviceLease?.()
    requestUsers -= 1
    entry.users -= 1
    if (entry.users === 0) {
      services.delete(key)
    }
  }
}
export async function withComfyDownload<T>(
  service: ComfyService,
  signal: AbortSignal,
  action: (bounded: AbortSignal) => Promise<T>
) {
  if (downloadUsers >= 34) {
    throw new ComfyTransportError('read')
  }
  downloadUsers += 1
  let release: (() => void) | undefined
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(service.timeoutMs)])
  try {
    release = await downloads.acquire(bounded)
    const result = await action(bounded)
    bounded.throwIfAborted()
    return result
  } finally {
    release?.()
    downloadUsers -= 1
  }
}
