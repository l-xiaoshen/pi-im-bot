import { z } from "zod"
import { obj, str, opt, bool } from "@earendil-works/pi-schema"
import type { BotTool } from "@pi-im-bot/capabilities/tool"
import type { MediaService } from "./service"
import type { ImageReference } from "./provenance"

const ReadMediaSchema = z.object({
  id: z.uuid(),
  source: z.enum(["media", "artifact"]).default("media"),
  stage: z.boolean().default(false)
})
type Reference = Pick<ImageReference, "id" | "source">
export interface MediaToolServices {
  content(reference: Reference, signal: AbortSignal): ReturnType<MediaService["content"]>
  preview(reference: Reference, signal: AbortSignal): ReturnType<MediaService["preview"]>
  require(id: string): unknown
  validate?(): void
  visionEnabled: boolean
}

export function mediaTool(
  services: MediaToolServices,
  signal: AbortSignal,
  authorize: (capability: string) => void,
  upload?: (path: string, content: Uint8Array, signal?: AbortSignal) => Promise<void>
): BotTool {
  return {
    name: "media_read",
    label: "读取会话媒体",
    description:
      "Read an image or attachment by the scoped ID shown in the message, quote or chat_history. source is media for an incoming/uploaded attachment, artifact for a tool output. Images are resized under this conversation budget. Set stage=true to also copy the file to the current remote sandbox and return its container path; this additionally requires write permission. Never supply a URL or host path.",
    parameters: obj({ id: str(), source: opt(str()), stage: opt(bool()) }),
    async execute(_id, args, toolSignal) {
      const input = ReadMediaSchema.parse(args)
      const signals = [signal]
      if (toolSignal) {
        signals.push(toolSignal)
      }
      const active = AbortSignal.any(signals)
      authorize("media_read")
      if (input.stage) {
        authorize("write")
        if (!upload) {
          throw new Error("当前未配置沙盒")
        }
      }
      const { metadata, file } = await services.content(input, active)
      if (file.size > 8 * 1024 * 1024) {
        throw new Error("媒体超过单次读取预算")
      }
      let path: string | undefined
      if (input.stage && upload) {
        const extension = metadata.mimeType.split("/")[1]?.replace(/[^a-zA-Z0-9]/gu, "") || "bin"
        const relative = ".bot-media/" + input.id + "." + extension
        const data = new Uint8Array(await file.arrayBuffer())
        active.throwIfAborted()
        authorize("media_read")
        authorize("write")
        await upload(relative, data, active)
        path = "/workspace/" + relative
      }
      const content: Awaited<ReturnType<BotTool["execute"]>>["content"] = [
        {
          type: "text",
          text: JSON.stringify({
            artifactId: metadata.id,
            name: metadata.name,
            mimeType: metadata.mimeType,
            bytes: metadata.bytes,
            path
          })
        }
      ]
      if (metadata.mimeType.startsWith("image/") && services.visionEnabled) {
        const image = await services.preview(input, active)
        authorize("media_read")
        content.push({ type: "image", data: image.data, mimeType: image.mimeType })
      }
      active.throwIfAborted()
      authorize("media_read")
      services.validate?.()
      return { content, details: { artifactId: metadata.id, path } }
    }
  }
}
