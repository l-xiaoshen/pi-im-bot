export async function downloadMedia(
  address: string,
  allowed: (url: URL) => boolean,
  signal: AbortSignal,
  maxBytes = 8 * 1024 * 1024
) {
  let url = new URL(address)
  for (let redirects = 0; redirects < 4; redirects++) {
    signal.throwIfAborted()
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || !allowed(url)) {
      throw new Error('媒体来源不在此平台允许的地址中')
    }
    const response = await fetch(url, { signal, redirect: 'manual', credentials: 'omit' })
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel()
      const location = response.headers.get('location')
      if (!location) {
        throw new Error('媒体重定向缺少地址')
      }
      url = new URL(location, url)
      continue
    }
    if (!response.ok || !response.body) {
      await response.body?.cancel()
      throw new Error('媒体下载失败：HTTP ' + response.status)
    }
    if (Number(response.headers.get('content-length')) > maxBytes) {
      await response.body.cancel()
      throw new Error('媒体超过 8 MiB 下载上限')
    }
    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let bytes = 0
    try {
      for (;;) {
        const { done, value } = await reader.read()
        signal.throwIfAborted()
        if (done) {
          break
        }
        bytes += value.byteLength
        if (bytes > maxBytes) {
          throw new Error('媒体超过 8 MiB 下载上限')
        }
        chunks.push(value)
      }
    } finally {
      await reader.cancel().catch(() => {})
      reader.releaseLock()
    }
    return {
      data: Buffer.concat(chunks, bytes),
      mimeType: response.headers.get('content-type')?.split(';')[0] ?? 'application/octet-stream'
    }
  }
  throw new Error('媒体重定向次数超过上限')
}
