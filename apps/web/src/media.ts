import { element, button } from './dom'
import { mutate } from './api'
import type { Attachment } from '@pi-im-bot/contracts/message'
import { botApiUrl } from './bot-origin'

export function renderAttachment(roomId: string, attachment: Attachment) {
  const prefix = `/api/rooms/${encodeURIComponent(roomId)}/`
  if (
    !attachment.url.startsWith(prefix) ||
    !/^(?:artifacts|media)\/[0-9a-f-]{36}\/content$/u.test(attachment.url.slice(prefix.length))
  ) {
    return element('span', 'muted', attachment.name)
  }
  const item = element('div', 'message-attachment')
  const url = botApiUrl(attachment.url + '?view=1')
  const status = element('small', 'form-error')
  const retry = button(
    '重新读取',
    () => {
      if (!attachment.mediaId) {
        return
      }
      void mutate(`/api/rooms/${encodeURIComponent(roomId)}/media/${attachment.mediaId}/retry`)
        .then(() => {
          item.replaceWith(renderAttachment(roomId, { ...attachment }))
        })
        .catch(() => {
          status.textContent = '仍不可用，请稍后再试。'
        })
    },
    'text-button'
  )
  retry.hidden = true
  function unavailable() {
    status.textContent = '媒体暂不可用或已过期'
    retry.hidden = !attachment.mediaId
  }
  if (attachment.type === 'image') {
    const image = element('img')
    image.src = url
    image.alt = attachment.name
    image.loading = 'lazy'
    image.addEventListener('error', unavailable)
    item.append(image)
  }
  if (attachment.type === 'audio' || attachment.type === 'video') {
    const media = element(attachment.type)
    media.src = url
    media.controls = true
    media.preload = 'none'
    media.addEventListener('error', unavailable)
    item.append(media)
  }
  const link = element('a', 'text-button', '下载 ' + attachment.name)
  link.href = botApiUrl(attachment.url)
  link.download = attachment.name
  item.append(link, status, retry)
  return item
}
