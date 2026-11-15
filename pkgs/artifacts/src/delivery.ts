import { createHash } from "node:crypto"
import { z } from "zod"
import type { ChannelCapabilities } from "@pi-im-bot/contracts/channel"
import { mediaKind, type ChannelMedia } from "@pi-im-bot/contracts/channel-media"
import type { Attachment } from "@pi-im-bot/contracts/message"
import type { ArtifactStore } from "./store"

const ArtifactIdsSchema = z.array(z.uuid()).max(256)
const maxDeliveryBytes = 20 * 1024 * 1024

export function artifactUrl(roomId: string, id: string) {
  return `/api/rooms/${encodeURIComponent(roomId)}/artifacts/${encodeURIComponent(id)}/content`
}

export async function prepareMedia(
  roomId: string,
  ids: readonly string[],
  store: ArtifactStore | undefined,
  capabilities: ChannelCapabilities
) {
  const artifactIds = [...new Set(ArtifactIdsSchema.parse(ids))]
  const attachments: Attachment[] = []
  const media: ChannelMedia[] = []
  const downloads: string[] = []
  let bytes = 0
  for (const id of artifactIds) {
    if (!store) {
      throw new Error("产物交付未配置")
    }
    const { metadata, file } = await store.content(id)
    if (metadata.roomId !== roomId || file.size !== metadata.bytes) {
      throw new Error("产物范围或大小校验失败")
    }
    const kind = mediaKind(metadata.mimeType)
    attachments.push({
      type: kind,
      name: metadata.name,
      mimeType: metadata.mimeType,
      url: artifactUrl(roomId, id)
    })
    let supported = capabilities.files
    if (kind === "image") {
      supported = capabilities.images
    }
    if (kind === "audio") {
      supported = capabilities.audio === true
    }
    if (kind === "video") {
      supported = capabilities.video === true
    }
    if (!supported || bytes + file.size > maxDeliveryBytes) {
      downloads.push(metadata.name)
      continue
    }
    bytes += file.size
    const data = new Uint8Array(await file.arrayBuffer())
    if (createHash("sha256").update(data).digest("hex") !== metadata.sha256) {
      throw new Error("产物内容校验失败")
    }
    media.push({ id, kind, name: metadata.name, mimeType: metadata.mimeType, data })
  }
  return { artifactIds, attachments, media, downloads }
}
