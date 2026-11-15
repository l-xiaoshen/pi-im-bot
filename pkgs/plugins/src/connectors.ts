import { z } from "zod"
import type { PluginHostServices } from "./rpc/services"
import type { PluginInvocation } from "./invocation"
import type { PluginBinding } from "./registry"
import type { ArtifactStore } from "@pi-im-bot/artifacts/store"
import { ResourceLibrary } from "@pi-im-bot/resources/library"
import { createMcpTools } from "@pi-im-bot/resources/mcp/tools"
import { mcpCapabilityId } from "@pi-im-bot/resources/mcp/identity"

const ConnectorCallSchema = z
  .object({ tool: z.string().min(1).max(128), arguments: z.record(z.string(), z.json()).default({}) })
  .strict()
const ResultDetailsSchema = z.object({
  artifactIds: z.array(z.string()).default([]),
  artifactId: z.string().optional(),
  summary: z.string().optional()
})

export function registerPluginConnectors(
  host: PluginHostServices,
  invocation: PluginInvocation,
  binding: PluginBinding,
  artifacts: ArtifactStore,
  callId: string
) {
  for (const [alias, serverId] of Object.entries(binding.instance.connectors)) {
    host.register("connector:" + alias, "connector:" + alias, ConnectorCallSchema, async (input, context) => {
      const capability = mcpCapabilityId(serverId, input.tool)
      invocation.services.authorize(capability)
      const library = invocation.config.resources
      if (invocation.readOnly) {
        const definition = library.manifest(serverId)?.tools.find((tool) => {
          return tool.name === input.tool
        })
        if (definition?.annotations?.readOnlyHint !== true) {
          throw new Error("此切入点只允许声明为只读的 MCP 工具")
        }
      }
      const selected = new ResourceLibrary(
        {
          ...library.config,
          mcp: library.config.mcp.filter((server) => {
            return server.id === serverId
          })
        },
        library.manifests
      )
      const tools = createMcpTools(
        selected,
        invocation.input.context.effective.settings,
        invocation.input.context.authority.capabilities,
        artifacts,
        context.signal,
        undefined,
        invocation.readOnly === true
      )
      try {
        const tool = tools.tools.find((tool) => {
          return tools.capabilityFor(tool.name) === capability
        })
        if (!tool) {
          throw new Error("连接器工具未登记、未启用或未获授权")
        }
        const result = await tool.execute(callId + ":connector:" + alias, input.arguments, context.signal, undefined)
        invocation.services.authorize(capability)
        context.signal.throwIfAborted()
        const details = ResultDetailsSchema.parse(result.details)
        const artifactIds = [...details.artifactIds]
        if (details.artifactId) {
          artifactIds.push(details.artifactId)
        }
        return {
          text: result.content
            .filter((part) => {
              return part.type === "text"
            })
            .map((part) => {
              return part.text
            })
            .join("\n"),
          artifactIds: [...new Set(artifactIds)],
          isError: Boolean(result.isError)
        }
      } finally {
        await tools.close()
      }
    })
  }
}
