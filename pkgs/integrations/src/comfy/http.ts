import type { ComfyService } from './resources'
import { ComfyTransportError } from './errors'
export { ComfyTransportError } from './errors'
import { withComfyHttp } from './budgets'
async function requestBytes(
  service: ComfyService,
  route: string,
  signal: AbortSignal,
  maxBytes: number,
  payload?: object,
  dispatched?: () => Promise<void>
) {
  const url = new URL(service.url.replace(/\/$/u, '') + '/' + route)
  const headers = new Headers(service.headers)
  let method = 'GET'
  let body: string | undefined
  if (payload) {
    method = 'POST'
    body = JSON.stringify(payload)
    if (Buffer.byteLength(body) > 600000) {
      throw new ComfyTransportError('rejected')
    }
    headers.set('content-type', 'application/json')
  }
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(service.timeoutMs)])
  let response: Response
  const requestController = new AbortController()
  const requestSignal = AbortSignal.any([bounded, requestController.signal])
  let responsePromise: Promise<{ response: Response } | { error: boolean }> | undefined
  try {
    const request = fetch(url, {
      method,
      headers,
      body,
      signal: requestSignal,
      redirect: 'manual',
      credentials: 'omit'
    })
    responsePromise = request.then(
      (response) => {
        return { response }
      },
      () => {
        return { error: true }
      }
    )
    if (dispatched) {
      await dispatched()
    }
    const result = await responsePromise
    if (!('response' in result)) {
      throw new ComfyTransportError('unknown')
    }
    response = result.response
  } catch {
    requestController.abort()
    const abandoned = await responsePromise
    if (abandoned && 'response' in abandoned) {
      await abandoned.response.body?.cancel().catch(() => {})
    }
    signal.throwIfAborted()
    if (payload) {
      throw new ComfyTransportError('unknown')
    }
    throw new ComfyTransportError('read')
  }
  if (!response.ok || !response.body) {
    await response.body?.cancel()
    if (payload) {
      if (response.status >= 400 && response.status < 500) {
        throw new ComfyTransportError('rejected')
      }
      throw new ComfyTransportError('unknown')
    }
    throw new ComfyTransportError('read')
  }
  if (Number(response.headers.get('content-length')) > maxBytes) {
    await response.body.cancel()
    throw new ComfyTransportError('refused')
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    for (;;) {
      bounded.throwIfAborted()
      const part = await reader.read()
      if (part.done) {
        break
      }
      length += part.value.byteLength
      if (length > maxBytes) {
        throw new ComfyTransportError('refused')
      }
      chunks.push(part.value)
    }
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
  return {
    bytes: Buffer.concat(chunks, length),
    mimeType: response.headers.get('content-type')?.split(';')[0]?.toLowerCase()
  }
}

export async function comfyRequest(
  service: ComfyService,
  route: string,
  signal: AbortSignal,
  maxBytes: number,
  payload?: object,
  dispatched?: () => Promise<void>
) {
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(service.timeoutMs)])
  return withComfyHttp(service, bounded, Boolean(payload), () => {
    return requestBytes(service, route, bounded, maxBytes, payload, dispatched)
  })
}
