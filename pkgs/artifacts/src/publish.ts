import { posix } from "node:path"
import { z } from "zod"
import { obj, opt, str } from "@earendil-works/pi-schema"
import type { BotTool } from "@pi-im-bot/capabilities/tool"
import type { ArtifactStore } from "./store"

const PublishArtifactSchema = z.object({
  path: z.string().min(1).max(4096),
  name: z.string().min(1).max(200).optional(),
  mimeType: z
    .string()
    .regex(/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i)
    .optional()
})

export function publishArtifactTool(
  store: ArtifactStore,
  download: (path: string, signal?: AbortSignal) => Promise<Uint8Array>,
  assertActive: () => void
): BotTool {
  return {
    name: "artifact_publish",
    label: "发布容器产物",
    description:
      "Copy a generated file from the current remote container into a persistent artifact for this chat. Returns an artifact ID. A background task delivers its published files with its final result. In the main conversation use chat_send with artifactIds to deliver it. Paths always refer to the container, never the Bot host.",
    parameters: obj({ path: str(), name: opt(str()), mimeType: opt(str()) }),
    async execute(_id, args, signal) {
      const input = PublishArtifactSchema.parse(args)
      assertActive()
      signal?.throwIfAborted()
      const data = await download(input.path, signal)
      signal?.throwIfAborted()
      assertActive()
      const name = posix.basename(input.name ?? input.path)
      const mimeType = input.mimeType ?? (Bun.file(name).type.split(";")[0] || "application/octet-stream")
      const artifact = await store.save(name, mimeType, "sandbox", data)
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              artifactId: artifact.id,
              name: artifact.name,
              mimeType: artifact.mimeType,
              bytes: artifact.bytes
            })
          }
        ],
        details: { artifactId: artifact.id }
      }
    }
  }
}
