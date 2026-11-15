import { z } from "zod"
import { defineTool, type ToolRegistration } from "@earendil-works/pi-durable"
import type { BotTool } from "@pi-im-bot/capabilities/tool"

const SafeTools = new Set([
  "chat_history",
  "artifact_read",
  "schedule_list",
  "read",
  "ls",
  "delegate_task",
  "start_job",
  "job_list",
  "job_status"
])

export function durableTool(tool: BotTool, authorize: () => void): ToolRegistration {
  const definition: ToolRegistration = {
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    replay: tool.replay ?? "unsafe",
    executionMode: "sequential",
    outputLimits: { maxBytes: 64 * 1024, maxLines: 4000, retain: "head" },
    async execute(args, api, context) {
      authorize()
      const result = await tool.execute(api.callId, args, context.abortSignal, (progress) => {
        for (const part of progress.content) {
          if (part.type === "text") {
            api.output(part.text)
          }
        }
      })
      let details: z.infer<ReturnType<typeof z.json>> | undefined
      if (result.details !== undefined) {
        details = z.json().parse(JSON.parse(JSON.stringify(result.details)))
      }
      return { output: result.content, details, isError: result.isError }
    }
  }
  if (SafeTools.has(tool.name)) {
    return { ...definition, replay: "safe" }
  }
  return definition
}

export function withDeferred(tool: ToolRegistration, deferred: boolean): ToolRegistration {
  if (deferred) {
    return defineTool({ ...tool, deferred: true })
  }
  return tool
}
