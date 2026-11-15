import { maxArchiveBytes } from './archive'
import { PluginUrlSchema } from './url'

export class PluginDownloadError extends Error {
  constructor(readonly status: number) {
    super('读取插件来源失败：HTTP ' + status)
  }
}
export type PluginSourceReader = (url: string, signal: AbortSignal, maxBytes?: number) => Promise<Buffer>

export async function downloadPluginFile(url: string, signal: AbortSignal, maxBytes = maxArchiveBytes) {
  PluginUrlSchema.parse(url)
  const response = await fetch(url, {
    signal,
    headers: { 'user-agent': 'pi-im-bot-plugin-manager/1' },
    redirect: 'follow'
  })
  PluginUrlSchema.parse(response.url)
  if (!response.ok || !response.body) {
    await response.body?.cancel().catch(() => {})
    throw new PluginDownloadError(response.status)
  }
  if (Number(response.headers.get('content-length')) > maxBytes) {
    await response.body.cancel()
    throw new Error('插件来源内容超过下载预算')
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let bytes = 0
  try {
    for (;;) {
      signal.throwIfAborted()
      const chunk = await reader.read()
      if (chunk.done) {
        break
      }
      bytes += chunk.value.length
      if (bytes > maxBytes) {
        throw new Error('插件来源内容超过下载预算')
      }
      chunks.push(chunk.value)
    }
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
  return Buffer.concat(chunks)
}
