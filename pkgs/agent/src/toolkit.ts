import { projectPluginHistory } from "@pi-im-bot/plugins/hooks/model-history"
import type { Configuration } from "@pi-im-bot/config/load"
import type { Room } from "@pi-im-bot/contracts/message"
import type { PreparedRunInput } from "@pi-im-bot/contracts/run"
import type { AgentCallbacks } from "./events"
import { createHostTools, type HostToolServices } from "./host-tools"
import { createWorkspaceTools } from "@pi-im-bot/execution/pi-tools"
import { executionStatus } from "@pi-im-bot/execution/config"
import { authorizedTools } from "@pi-im-bot/permissions/authorize"
import { exposedDefinitions } from "@pi-im-bot/capabilities/exposure"
import { ArtifactStore } from "@pi-im-bot/artifacts/store"
import { artifactTool } from "@pi-im-bot/artifacts/tool"
import { publishArtifactTool } from "@pi-im-bot/artifacts/publish"
import { mediaTool } from "@pi-im-bot/media/tool"
import { createMcpTools } from "@pi-im-bot/resources/mcp/tools"
import { createSkillTools } from "@pi-im-bot/resources/skills/tools"
import { createPluginTools } from "@pi-im-bot/plugins/tools"
import { pluginContext } from "@pi-im-bot/plugins/hooks/context"
import { reserveMediaSources } from "@pi-im-bot/media/dependencies"

export function createToolkit(
  config: Configuration,
  room: Room,
  input: PreparedRunInput,
  signal: AbortSignal,
  services: HostToolServices,
  callbacks: AgentCallbacks
) {
  services.projectModelHistory = (messages) => {
    return projectPluginHistory(services.plugins, { config, room, input, services }, messages, signal)
  }
  let hostTools = createHostTools(services)
  const effective = input.context.effective
  let artifactOwner: string | undefined
  if (input.context.jobId) {
    artifactOwner = `job:${input.context.jobId}:${input.context.jobRevision}`
  }
  const sources = (services.mediaSources ??= new Set<string>())
  function access() {
    for (const id of sources) {
      signal.throwIfAborted()
      services.authorize("media_read")
      if (!services.media) {
        throw new Error("入站媒体服务未配置")
      }
      services.media.require(id)
    }
    const capabilities: string[] = []
    if (sources.size) {
      capabilities.push("media_read")
    }
    return { mediaIds: [...sources], capabilities }
  }
  const artifacts = new ArtifactStore(config.dataDir, room.id, artifactOwner, undefined, access, (dependency) => {
    reserveMediaSources(sources, dependency.mediaIds)
    access()
  })
  const mcp = createMcpTools(
    config.resources,
    effective.settings,
    input.context.authority.capabilities,
    artifacts,
    signal,
    services.jobs
  )
  hostTools.push(artifactTool(artifacts), ...mcp.tools)
  const plugins = createPluginTools(
    services.plugins,
    { config, room, input, services, origin: "tool" },
    signal,
    services.jobs
  )
  hostTools.push(...plugins.tools)
  const execution = config.bot.agent.execution
  const executionInfo = executionStatus(execution)
  let workspaceTools: ReturnType<typeof createWorkspaceTools> | undefined
  if (execution.backend === "shipyard") {
    workspaceTools = createWorkspaceTools(
      execution,
      config.dataDir,
      input.context.workspaceScope ?? room.id,
      signal,
      (sandbox) => {
        callbacks.trace({
          kind: "started",
          title: "沙盒工作区已连接",
          detail: "Shipyard " + sandbox.id + " · /workspace · 文件持久化到独立 Cargo"
        })
      }
    )
    hostTools.push(...workspaceTools.tools)
    hostTools.push(
      publishArtifactTool(artifacts, workspaceTools.download, () => {
        services.authorize("artifact_publish")
      })
    )
  }
  const skills = createSkillTools(config.resources, config.dataDir, input, artifacts, workspaceTools?.upload)
  if (services.media) {
    const media = services.media
    hostTools.push(
      mediaTool(
        {
          ...media,
          validate: () => {
            access()
          },
          async content(reference, signal) {
            if (reference.source === "media") {
              reserveMediaSources(sources, [reference.id])
            }
            const content = await media.content(reference, signal)
            reserveMediaSources(sources, content.metadata.access?.mediaIds ?? [])
            access()
            return content
          }
        },
        signal,
        services.authorize,
        workspaceTools?.upload
      )
    )
  }
  hostTools.push(...skills.tools)
  if (!input.context.jobId || input.context.conversationId === input.context.rootConversationId) {
    hostTools = hostTools.filter((tool) => {
      return tool.name !== "job_wait"
    })
  }
  function capabilityFor(name: string) {
    return plugins.capabilityFor(skills.capabilityFor(mcp.capabilityFor(name)))
  }
  hostTools = authorizedTools(hostTools, input.context.authority, services.authorize, capabilityFor)
  const exposure = {
    ...effective.settings.resources,
    permanentTools: hostTools
      .filter((tool) => {
        return effective.settings.resources.permanentTools.includes(capabilityFor(tool.name))
      })
      .map((tool) => {
        return tool.name
      })
  }
  hostTools = exposedDefinitions(hostTools, exposure)
  const deferred = effective.settings.resources.toolExposure === "deferred"
  const searchAllowed = deferred && hostTools.length > 0 && input.context.authority.capabilities.includes("tool_search")
  const names = hostTools.map((tool) => {
    return tool.name
  })
  if (searchAllowed) {
    names.push("tool_search")
  }
  if (new Set(names).size !== names.length) {
    throw new Error("能力目录包含重复的模型工具别名")
  }
  let context: Promise<string | undefined> | undefined

  return {
    pluginContext() {
      context ??= pluginContext(services.plugins, { config, room, input, services }, signal, (trace) => {
        callbacks.trace({
          kind: "plugin",
          title: trace.point + " · " + trace.handler + " · " + trace.outcome,
          detail: trace.error ?? "",
          durationMs: trace.elapsedMs
        })
      })
      return context
    },
    tools: hostTools,
    effective,
    searchAllowed,
    executionInfo,
    skillsPrompt: skills.prompt,
    hasSkills: skills.tools.length > 0,
    capabilityFor,
    async close() {
      await mcp.close()
      await workspaceTools?.close()
    }
  }
}
