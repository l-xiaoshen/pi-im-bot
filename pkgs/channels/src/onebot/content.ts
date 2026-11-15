import { z } from "zod"
import type { OneBotMessage } from "./protocol"
import type { IncomingMedia, ReplyReference } from "@pi-im-bot/media/schema"

const IdSchema = z.union([z.string(), z.number()]).transform(String)
const MediaDataSchema = z.object({
  file: z
    .string()
    .max(1024 * 1024)
    .optional(),
  url: z.string().max(16000).optional(),
  name: z.string().optional(),
  file_name: z.string().optional()
})

function decode(value: string) {
  return value.replaceAll("&#91;", "[").replaceAll("&#93;", "]").replaceAll("&#44;", ",").replaceAll("&amp;", "&")
}

function segments(message: OneBotMessage["message"]) {
  if (typeof message !== "string") {
    return message
  }
  const result: Array<{ type: string; data: Record<string, unknown> }> = []
  let offset = 0
  for (const match of message.matchAll(/\[CQ:([a-zA-Z0-9_]+)((?:,[^\]]*)?)\]/gu)) {
    if (match.index > offset) {
      result.push({ type: "text", data: { text: decode(message.slice(offset, match.index)) } })
    }
    const data: Record<string, string> = {}
    for (const entry of match[2].split(",").slice(1)) {
      const index = entry.indexOf("=")
      if (index > 0) {
        data[entry.slice(0, index)] = decode(entry.slice(index + 1))
      }
    }
    result.push({ type: match[1], data })
    offset = match.index + match[0].length
  }
  if (offset < message.length) {
    result.push({ type: "text", data: { text: decode(message.slice(offset)) } })
  }
  return result
}

export function parseOneBotContent(message: OneBotMessage["message"]) {
  const texts: string[] = []
  const attachments: IncomingMedia[] = []
  let replyTo: ReplyReference | undefined
  for (const segment of segments(message)) {
    if (segment.type === "text") {
      texts.push(z.object({ text: z.string() }).parse(segment.data).text)
      continue
    }
    if (segment.type === "at") {
      texts.push("[CQ:at,qq=" + z.object({ qq: IdSchema }).parse(segment.data).qq + "]")
      continue
    }
    if (segment.type === "reply") {
      const id = z.object({ id: IdSchema }).parse(segment.data).id
      replyTo ??= { platformMessageId: id }
      texts.push("[CQ:reply,id=" + id + "]")
      continue
    }
    const types: Record<string, IncomingMedia["type"]> = {
      image: "image",
      record: "audio",
      video: "video",
      file: "file"
    }
    const type = types[segment.type]
    if (!type) {
      continue
    }
    const labels = { image: "图片", audio: "语音", video: "视频", file: "文件" }
    texts.push("[" + labels[type] + "]")
    const data = MediaDataSchema.safeParse(segment.data)
    if (!data.success || attachments.length >= 12) {
      continue
    }
    const reference = data.data.file ?? data.data.url
    if (!reference) {
      continue
    }
    attachments.push({
      type,
      name: (data.data.name ?? data.data.file_name ?? labels[type]).slice(0, 200),
      reference: { id: reference, url: data.data.url }
    })
  }
  return { text: texts.join(""), attachments, replyTo }
}
