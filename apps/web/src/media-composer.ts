import { element, button } from "./dom"
import { request } from "./api"
import { AttachmentSchema, type Attachment, type ChatMessage } from "@pi-im-bot/contracts/message"
import type { ReplyReference } from "@pi-im-bot/media/schema"

export interface ChatDraft {
  text: string
  attachments: Attachment[]
  replyTo?: ReplyReference
}

export function createMediaComposer(
  roomId: string,
  initial: ChatDraft,
  changed: () => void,
  notify: (error: unknown) => void
) {
  const root = element("div", "media-composer")
  const previews = element("div", "draft-attachments")
  const quote = element("div", "draft-quote")
  let attachments = [...initial.attachments]
  let replyTo = initial.replyTo
  let quoteText = ""
  let uploading = false
  const file = element("input")
  file.type = "file"
  file.multiple = true
  file.hidden = true
  file.setAttribute("aria-label", "上传附件")
  const add = button(
    "添加附件",
    () => {
      file.click()
    },
    "button secondary"
  )
  function render() {
    previews.replaceChildren()
    for (const attachment of attachments) {
      const item = element("span", "draft-attachment")
      item.append(
        element("span", "", attachment.name),
        button(
          "移除",
          () => {
            attachments = attachments.filter((entry) => {
              return entry.mediaId !== attachment.mediaId
            })
            render()
            changed()
          },
          "text-button"
        )
      )
      previews.append(item)
    }
    quote.replaceChildren()
    if (replyTo) {
      quote.append(
        element("span", "", "引用：" + (quoteText || replyTo.messageId || replyTo.platformMessageId)),
        button(
          "取消引用",
          () => {
            replyTo = undefined
            render()
            changed()
          },
          "text-button"
        )
      )
    }
    add.disabled = uploading || attachments.length >= 12
    add.textContent = "添加附件"
    if (uploading) {
      add.textContent = "上传中…"
    }
  }
  file.addEventListener("change", async () => {
    const files = [...(file.files ?? [])]
    file.value = ""
    if (files.length + attachments.length > 12) {
      notify(new Error("每条消息最多 12 个附件"))
      return
    }
    uploading = true
    render()
    changed()
    try {
      for (const item of files) {
        if (item.size > 8 * 1024 * 1024) {
          throw new Error("单个附件不能超过 8 MiB")
        }
        const body = new FormData()
        body.set("file", item)
        attachments.push(await request(`/api/rooms/${roomId}/media`, AttachmentSchema, { method: "POST", body }))
        render()
        changed()
      }
    } catch (error) {
      notify(error)
    } finally {
      uploading = false
      render()
      changed()
    }
  })
  root.append(quote, previews, add, file)
  render()
  return {
    root,
    get busy() {
      return uploading
    },
    snapshot(text: string): ChatDraft {
      return { text, attachments: [...attachments], replyTo }
    },
    reply(message: ChatMessage) {
      replyTo = { messageId: message.id }
      quoteText = message.actorName + " · " + message.text.slice(0, 80)
      render()
      changed()
    },
    clear() {
      attachments = []
      replyTo = undefined
      quoteText = ""
      render()
      changed()
    }
  }
}
