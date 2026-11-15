import { createHash } from "node:crypto"
import { revision } from "@pi-im-bot/settings/resolve"
import type { McpServer, McpTool } from "./schema"

export function mcpCapabilityId(server: string, tool: string) {
  return `mcp:${server}/${tool}`
}

export function mcpToolName(server: string, tool: string) {
  const hash = createHash("sha256").update(tool).digest("hex").slice(0, 10)
  const prefix = `mcp__${server}__`
  return prefix + tool.replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 64 - prefix.length - hash.length - 1) + "_" + hash
}

export function mcpServerRevision(server: McpServer) {
  return revision({
    url: server.url,
    headers: server.headers,
    headerEnv: server.headerEnv,
    transport: server.transport
  })
}

export function mcpToolRevision(tool: McpTool) {
  return revision({
    name: tool.name,
    inputSchema: tool.inputSchema,
    outputSchema: tool.outputSchema,
    execution: tool.execution
  })
}
