import { z } from 'zod'
import type { IncomingMedia } from '@pi-im-bot/media/schema'
import { downloadMedia } from '@pi-im-bot/media/download'

export const MediaOriginsSchema = z
  .array(
    z.url().refine((value) => {
      const url = new URL(value)
      return (
        ['http:', 'https:'].includes(url.protocol) &&
        !url.username &&
        !url.password &&
        url.pathname === '/' &&
        !url.search &&
        !url.hash
      )
    }, '请填写 HTTP(S) 来源，例如 http://media.example:8080，不含路径和凭据')
  )
  .max(20)

export function oneBotMediaAllowed(url: URL, origins: readonly string[]) {
  if (
    origins.some((origin) => {
      return new URL(origin).origin === url.origin
    })
  ) {
    return true
  }
  if (url.protocol !== 'https:' || (url.port && url.port !== '443')) {
    return false
  }
  return ['qpic.cn', 'qlogo.cn', 'multimedia.nt.qq.com.cn'].some((domain) => {
    return url.hostname === domain || url.hostname.endsWith('.' + domain)
  })
}

export async function readOneBotMedia(
  media: IncomingMedia,
  origins: readonly string[],
  signal: AbortSignal,
  resolveImage: (id: string) => Promise<unknown>
) {
  const reference = media.reference
  if (reference.id.startsWith('base64://')) {
    const data = z
      .base64()
      .max(12 * 1024 * 1024)
      .parse(reference.id.slice(9))
    return { data: Buffer.from(data, 'base64'), mimeType: media.mimeType ?? 'application/octet-stream' }
  }
  let url = reference.url
  if (!url && /^https?:\/\//u.test(reference.id)) {
    url = reference.id
  }
  if (!url && media.type === 'image') {
    const resolved = z.object({ url: z.string().optional() }).parse(await resolveImage(reference.id))
    url = resolved.url
  }
  if (!url) {
    throw new Error('平台未提供可下载的媒体地址；不会读取宿主或 NapCat 文件路径')
  }
  return downloadMedia(
    url,
    (value) => {
      return oneBotMediaAllowed(value, origins)
    },
    signal
  )
}
