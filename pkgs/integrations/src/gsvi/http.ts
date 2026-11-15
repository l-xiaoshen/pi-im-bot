import type { GsviService } from './schema'
import { gsviServiceHeaders } from './headers'

export class GsviHttpError extends Error {
  constructor(readonly code: 'unavailable' | 'protocol' | 'budget' | 'remote_unknown') {
    super('具名语音服务请求未完成')
  }
}

function permitted(url: URL, origins: readonly string[]) {
  if (!['http:', 'https:'].includes(url.protocol) || !origins.includes(url.origin)) {
    throw new GsviHttpError('protocol')
  }
}

export async function gsviRequest(
  service: GsviService,
  address: URL,
  signal: AbortSignal,
  maxBytes: number,
  payload?: Record<string, string>,
  download = false
) {
  const base = new URL(service.url)
  const origins = [base.origin]
  if (download) {
    origins.push(
      ...service.downloadOrigins.map((origin) => {
        return new URL(origin).origin
      })
    )
  }
  const downloadOrigin = address.origin
  if (download && service.sourceCompatibleDownloads) {
    origins.push(downloadOrigin)
  }
  let url = address
  let currentPayload = payload
  let maximumRedirects = 4
  if (service.sourceCompatibleDownloads) {
    maximumRedirects = 5
  }
  for (let redirects = 0; redirects <= maximumRedirects; redirects++) {
    signal.throwIfAborted()
    permitted(url, origins)
    const headers = new Headers()
    if (url.origin === base.origin) {
      gsviServiceHeaders(service).forEach((value, name) => {
        headers.set(name, value)
      })
    }
    if (download && url.origin === downloadOrigin) {
      for (const [name, value] of Object.entries(service.nativeDownloadHeaders ?? service.downloadHeaders)) {
        headers.set(name, value)
      }
    }
    let body: string | undefined
    let method = 'GET'
    if (currentPayload) {
      body = JSON.stringify(currentPayload)
      method = 'POST'
      headers.set('content-type', 'application/json')
    }
    let response: Response
    const address = new URL(url)
    if (address.username || address.password) {
      if (headers.has('authorization')) {
        // aiohttp rejects URL Basic credentials combined with Authorization.
        throw new GsviHttpError('unavailable')
      }
      headers.set(
        'authorization',
        'Basic ' +
          Buffer.from(
            decodeURIComponent(address.username) + ':' + decodeURIComponent(address.password)
          ).toString('base64')
      )
      address.username = ''
      address.password = ''
    }
    try {
      response = await fetch(address, {
        method,
        headers,
        body,
        signal,
        redirect: 'manual',
        credentials: 'omit'
      })
    } catch {
      signal.throwIfAborted()
      if (currentPayload) {
        throw new GsviHttpError('remote_unknown')
      }
      throw new GsviHttpError('unavailable')
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel()
      // Legacy services retain their conservative protocol. Native projection follows
      // explicit HTTP redirects like the source, never retries an unknown response.
      if (currentPayload && !service.sourceCompatibleDownloads) {
        throw new GsviHttpError('remote_unknown')
      }
      const location = response.headers.get('location')
      if (!location) {
        throw new GsviHttpError('protocol')
      }
      url = new URL(location, url)
      if (service.sourceCompatibleDownloads) {
        origins.push(url.origin)
        if (response.status === 303 || (currentPayload && [301, 302].includes(response.status))) {
          currentPayload = undefined
        }
      }
      continue
    }
    if (!response.ok || !response.body) {
      await response.body?.cancel()
      if (currentPayload && response.status >= 500) {
        throw new GsviHttpError('remote_unknown')
      }
      throw new GsviHttpError('unavailable')
    }
    if (Number(response.headers.get('content-length')) > maxBytes) {
      await response.body.cancel()
      throw new GsviHttpError('budget')
    }
    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let bytes = 0
    try {
      for (;;) {
        const part = await reader.read()
        signal.throwIfAborted()
        if (part.done) {
          break
        }
        bytes += part.value.byteLength
        if (bytes > maxBytes) {
          throw new GsviHttpError('budget')
        }
        chunks.push(part.value)
      }
    } catch (error) {
      if (currentPayload) {
        throw new GsviHttpError('remote_unknown')
      }
      throw error
    } finally {
      await reader.cancel().catch(() => {})
      reader.releaseLock()
    }
    return {
      bytes: Buffer.concat(chunks, bytes),
      mimeType: response.headers.get('content-type')?.split(';')[0]?.toLowerCase()
    }
  }
  throw new GsviHttpError('protocol')
}
