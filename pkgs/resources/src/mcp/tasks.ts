import { z } from 'zod'
import type { CallToolResult } from '@earendil-works/pi-mcp'
import type { McpServer, McpTool, McpManifest } from './schema'
import { McpRemoteTaskSchema } from './task-schema'

export function usesMcpTask(
  server: McpServer,
  tool: McpTool,
  manifest: McpManifest | undefined,
  background = false
) {
  if (tool.execution?.taskSupport === 'optional' && !background && server.tasks.automatic !== 'supported') {
    return false
  }
  return (
    server.tasks.mode === 'auto' &&
    Boolean(manifest?.taskCapabilities?.requests?.tools?.call) &&
    ['optional', 'required'].includes(tool.execution?.taskSupport ?? '')
  )
}
export function mcpToolAvailable(server: McpServer, tool: McpTool, manifest: McpManifest | undefined) {
  return tool.execution?.taskSupport !== 'required' || usesMcpTask(server, tool, manifest)
}
export const CreateMcpTaskResultSchema = z.object({ task: McpRemoteTaskSchema })
const ContentSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string() }),
  z.object({ type: z.literal('image'), data: z.string(), mimeType: z.string() }),
  z.object({ type: z.literal('audio'), data: z.string(), mimeType: z.string() }),
  z.object({
    type: z.literal('resource_link'),
    uri: z.string(),
    name: z.string(),
    mimeType: z.string().optional()
  }),
  z.object({
    type: z.literal('resource'),
    resource: z.union([
      z.object({ uri: z.string(), mimeType: z.string().optional(), text: z.string() }),
      z.object({ uri: z.string(), mimeType: z.string().optional(), blob: z.string() })
    ])
  })
])
export const McpCallResultSchema = z.object({
  content: z.array(ContentSchema).default([]),
  structuredContent: z.json().optional(),
  isError: z.boolean().optional()
}) satisfies z.ZodType<CallToolResult>
