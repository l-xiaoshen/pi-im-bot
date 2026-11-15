import type { CallToolResult } from "@earendil-works/pi-mcp"
import { ArtifactStore } from "@pi-im-bot/artifacts/store"
import { projectMcpResult } from "@pi-im-bot/resources/mcp/result"
import type { McpServer } from "@pi-im-bot/resources/mcp/schema"
import type { Job } from "../schema"

export async function externalResult(
  result: CallToolResult,
  server: McpServer,
  capability: string,
  dataDir: string,
  job: Job,
  revision: number
) {
  const artifacts = new ArtifactStore(dataDir, job.roomId, `job:${job.id}:${revision}`)
  const projected = await projectMcpResult(result, capability, artifacts, server)
  return {
    summary: projected.summary,
    artifactIds: projected.artifactIds
  }
}
