import type { BotTool } from "@pi-im-bot/capabilities/tool"
import type { PluginService } from "./service"
import { pluginOperations, type PluginInvocation } from "./invocation"
import { PluginArgumentsSchema, projectPluginResult, pluginArtifactStoreOwner, completedPluginResult } from "./result"
import { ArtifactStore } from "@pi-im-bot/artifacts/store"
import type { JobToolServices } from "@pi-im-bot/jobs/tools"

export function createPluginTools(
  service: PluginService | undefined,
  invocation: PluginInvocation,
  signal: AbortSignal,
  jobs?: Pick<JobToolServices, "operation">
) {
  const tools: BotTool[] = []
  const capabilities = new Map<string, string>()
  if (service?.available()) {
    for (const entry of pluginOperations(invocation.config, invocation.input)) {
      if (!entry.operation.tool || !invocation.input.context.authority.capabilities.includes(entry.capabilityId)) {
        continue
      }
      capabilities.set(entry.modelName, entry.capabilityId)
      let description = entry.operation.description + "\nCapability ID: " + entry.capabilityId
      let replay: "safe" | "unsafe" = "unsafe"
      if (entry.operation.execution === "background") {
        description += "\nStarts a persistent background Job and returns its ID. Completion is delivered by the host."
        if (jobs) {
          replay = "safe"
        }
      }
      tools.push({
        name: entry.modelName,
        label: entry.instance.name + " / " + entry.operation.title,
        description,
        parameters: entry.operation.inputSchema,
        executionMode: "sequential",
        replay,
        namespace: { name: "plugin__" + entry.instance.id, description: entry.instance.name },
        async execute(callId, input, toolSignal) {
          const args = PluginArgumentsSchema.parse(input)
          const signals = [signal]
          if (toolSignal) {
            signals.push(toolSignal)
          }
          const deadline = AbortSignal.any(signals)
          deadline.throwIfAborted()
          invocation.services.authorize(entry.capabilityId)
          if (entry.operation.execution === "background" && jobs) {
            const job = await jobs.operation(entry.operation.title, entry.capabilityId, args, callId)
            return {
              content: [{ type: "text", text: JSON.stringify({ accepted: true, jobId: job.id, state: job.state }) }],
              details: { jobId: job.id }
            }
          }
          const result = await service.execute(invocation, entry.capabilityId, args, callId, deadline)
          const artifacts = new ArtifactStore(
            invocation.config.dataDir,
            invocation.room.id,
            pluginArtifactStoreOwner(invocation.input.context)
          )
          const projected = await projectPluginResult(completedPluginResult(result), entry.capabilityId, artifacts)
          deadline.throwIfAborted()
          return { content: [{ type: "text", text: projected.summary }], details: projected }
        }
      })
    }
  }
  return {
    tools,
    capabilityFor(name: string) {
      return capabilities.get(name) ?? name
    }
  }
}
