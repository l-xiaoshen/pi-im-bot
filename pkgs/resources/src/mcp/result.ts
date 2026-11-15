import { z } from "zod"
import { toLlmContent, type CallToolResult, type ContentBlock, type LlmContent } from "@earendil-works/pi-mcp"
import type { ArtifactStore } from "@pi-im-bot/artifacts/store"
import { mediaKind } from "@pi-im-bot/contracts/channel-media"
import type { McpServer } from "./schema"
import { redactMcpText } from "./client"

const BinarySchema = z.base64().max(28 * 1024 * 1024)
const textBudget = 12000

export async function projectMcpResult(
  result: CallToolResult,
  source: string,
  artifacts: ArtifactStore,
  server: McpServer
) {
  const blocks: ContentBlock[] = []
  const artifactIds: string[] = []
  const notices: string[] = []
  let bytes = 0
  let imageBytes = 0
  let images = 0
  for (const block of result.content) {
    let encoded: string | undefined
    let mimeType = "application/octet-stream"
    if (block.type === "image" || block.type === "audio") {
      encoded = block.data
      mimeType = block.mimeType
    }
    if (block.type === "resource" && "blob" in block.resource) {
      encoded = block.resource.blob
      mimeType = block.resource.mimeType ?? mimeType
    }
    if (encoded === undefined) {
      blocks.push(block)
      continue
    }
    if (encoded.length > 28 * 1024 * 1024 || artifactIds.length >= 8) {
      notices.push("部分媒体超过单次保存预算，未载入。")
      blocks.push({ type: "text", text: "部分媒体超过单次保存预算，未载入。" })
      continue
    }
    const data = Buffer.from(BinarySchema.parse(encoded), "base64")
    if (bytes + data.byteLength > 20 * 1024 * 1024) {
      notices.push("部分媒体超过 20 MiB 保存预算，未载入。")
      blocks.push({ type: "text", text: "部分媒体超过 20 MiB 保存预算，未载入。" })
      continue
    }
    bytes += data.byteLength
    const extension = mimeType.split("/")[1]?.replace(/[^a-zA-Z0-9]/g, "") || "bin"
    const name = source.replace(/[^a-zA-Z0-9_-]/g, "_") + "-" + (artifactIds.length + 1) + "." + extension
    const artifact = await artifacts.save(name, mimeType, source, data)
    artifactIds.push(artifact.id)
    blocks.push({
      type: "text",
      text: `产物 ID：${artifact.id}；${mimeType}；${data.byteLength} 字节。可用 chat_send 的 artifactIds 发送，后台任务会随结果交付。`
    })
    if (mediaKind(mimeType) === "image" && images < 2 && imageBytes + data.byteLength <= 4 * 1024 * 1024) {
      blocks.push({ type: "image", mimeType, data: encoded })
      images += 1
      imageBytes += data.byteLength
    }
  }
  function serialize(value: unknown) {
    return JSON.stringify(value, (key, item: unknown) => {
      if (key === "_meta") {
        return undefined
      }
      if (typeof item === "string") {
        return redactMcpText(item, server)
      }
      return item
    })
  }
  const publicResult: CallToolResult = JSON.parse(
    serialize({ content: blocks, structuredContent: result.structuredContent, isError: result.isError })
  )
  const displayResult: CallToolResult = JSON.parse(
    serialize({
      content: result.content.filter((part) => {
        return (
          part.type === "text" || part.type === "resource_link" || (part.type === "resource" && "text" in part.resource)
        )
      }),
      structuredContent: result.structuredContent
    })
  )
  let summary = toLlmContent(displayResult)
    .filter((part) => {
      return part.type === "text"
    })
    .map((part) => {
      return part.text
    })
    .join("\n")
  if (!summary && artifactIds.length > 0) {
    summary = `已生成 ${artifactIds.length} 个附件。`
  }
  summary = [summary, ...new Set(notices)].filter(Boolean).join("\n").slice(0, textBudget)
  const output = toLlmContent(publicResult)
  const length = output.reduce((sum, part) => {
    if (part.type === "text") {
      return sum + part.text.length
    }
    return sum
  }, 0)
  if (length <= textBudget) {
    return { content: output, artifactIds, summary }
  }
  const artifact = await artifacts.save(
    source + ".json",
    "application/json",
    source,
    serialize({
      content: blocks.filter((part) => {
        return part.type !== "image"
      }),
      structuredContent: result.structuredContent,
      isError: result.isError
    })
  )
  artifactIds.push(artifact.id)
  const content: LlmContent[] = []
  let remaining = textBudget
  for (const part of output) {
    if (part.type === "image") {
      content.push(part)
      continue
    }
    if (remaining > 0) {
      content.push({ type: "text", text: part.text.slice(0, remaining) })
      remaining -= part.text.length
    }
  }
  content.push({
    type: "text",
    text: `输出已裁剪。完整结果产物 ID：${artifact.id}。可用 artifact_read 按页读取。`
  })
  return { content, artifactId: artifact.id, artifactIds, summary }
}
