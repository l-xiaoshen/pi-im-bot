import type { JobService, JobInvocation } from "@pi-im-bot/jobs/service"
import type { PluginService } from "./service"
import type { Settings } from "@pi-im-bot/settings/schema"
import type { Configuration } from "@pi-im-bot/config/load"
import type { PluginInvocation } from "./invocation"
import { PluginArgumentsSchema, projectPluginResult, completedPluginResult } from "./result"
import { ArtifactStore } from "@pi-im-bot/artifacts/store"
import { pluginOperationId } from "./identity"

export function findPluginCommand(config: Configuration, settings: Settings, text: string) {
  const match = /^\/([\p{L}\p{N}_-]+)(?:\s+([\s\S]*))?$/u.exec(text.trim())
  if (!match) {
    return undefined
  }
  const entry = config.resources.pluginRegistry(settings).commands.get(match[1].toLowerCase())
  if (!entry) {
    return undefined
  }
  return { ...entry, text: match[2] ?? "" }
}

export function pluginCommandHelp(config: Configuration, settings: Settings, allowed: readonly string[]) {
  const lines = new Map<string, string>()
  for (const entry of config.resources.pluginRegistry(settings).commands.values()) {
    const operation = pluginOperationId(entry.binding.instance.id, entry.command.operation)
    if (allowed.includes(entry.capabilityId) && allowed.includes(operation)) {
      lines.set(
        entry.capabilityId,
        entry.command.names
          .map((name) => {
            return "/" + name
          })
          .join("、") +
          "：" +
          entry.command.description
      )
    }
  }
  if (lines.size === 0) {
    return ""
  }
  return "\n插件指令：\n" + [...lines.values()].join("\n")
}

export async function executePluginCommand(
  service: PluginService,
  invocation: PluginInvocation,
  jobInvocation: JobInvocation,
  jobs: JobService | undefined,
  entry: NonNullable<ReturnType<typeof findPluginCommand>>,
  signal: AbortSignal
) {
  invocation.services.authorize(entry.capabilityId)
  const capability = pluginOperationId(entry.binding.instance.id, entry.command.operation)
  invocation.services.authorize(capability)
  const operation = service.operation(invocation, capability)
  const callId =
    invocation.input.identities
      .flatMap((identity) => {
        return identity.messageIds
      })
      .join(":") || jobInvocation.runId
  let args = PluginArgumentsSchema.parse({})
  if (entry.command.parser) {
    args = await service.parse(invocation, operation, entry.command.parser, entry.text, callId + ":parse", signal)
  } else if (entry.command.arguments === "json") {
    args = PluginArgumentsSchema.parse(JSON.parse(entry.text || "{}"))
  } else if (entry.command.arguments === "text") {
    args = PluginArgumentsSchema.parse({ [entry.command.textField]: entry.text })
  } else if (entry.text.trim()) {
    throw new Error("此指令不接受参数")
  }
  invocation.services.authorize(entry.capabilityId)
  if (operation.operation.execution === "background") {
    if (!jobs) {
      throw new Error("后台任务运行时尚未启用")
    }
    const job = await jobs.forInvocation(jobInvocation).operation(operation.operation.title, capability, args, callId)
    return { summary: `已受理「${job.title}」，任务 ${job.id.slice(0, 8)}。完成后会回复。`, artifactIds: [] }
  }
  const result = await service.execute(invocation, capability, args, callId, signal)
  invocation.services.authorize(entry.capabilityId)
  return projectPluginResult(
    completedPluginResult(result),
    capability,
    new ArtifactStore(invocation.config.dataDir, invocation.room.id)
  )
}
