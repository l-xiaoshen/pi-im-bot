import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context"
import type { JobService } from "../service"
import type { JobTaskInput } from "../task"
import { ExternalExecutions, ExternalExecutionSchema, externalKey } from "./documents"
import { usesMcpTask } from "@pi-im-bot/resources/mcp/tasks"
import { redactMcp } from "@pi-im-bot/resources/mcp/client"
import type { McpServer } from "@pi-im-bot/resources/mcp/schema"
import type { ExternalExecution } from "./documents"
import type { McpSessionSnapshot } from "@pi-im-bot/resources/mcp/task-schema"

export async function externalContext(service: JobService, input: JobTaskInput) {
  const job = await service.repository.get(input.jobId)
  const value = job.revisions[String(input.revision)]
  if (!value || value.spec.kind !== "tool") {
    throw new Error("任务不属于外部操作")
  }
  const spec = value.spec
  const config = await service.coordinator.loadConfigurationSnapshot(value.configSnapshot)
  const entry = config.resources.mcpTools(value.context.effective.settings).find((entry) => {
    return entry.id === spec.capability
  })
  if (!entry || !usesMcpTask(entry.server, entry.tool, config.resources.manifest(entry.server.id), true)) {
    throw new Error("此任务没有固定的 MCP Tasks 定义")
  }
  const key = externalKey(job.id, input.revision)
  const document = await service.runtime.native.snapshot(ExternalExecutions, key, BACKGROUND_CONTEXT)
  let execution: ExternalExecution = {
    serverId: entry.server.id,
    failures: 0,
    cancelDispatched: false,
    sessionRedactions: []
  }
  if (document?.value) {
    execution = ExternalExecutionSchema.parse(document.value)
  }
  return { job, value, spec: value.spec, config, entry, key, execution }
}
export type ExternalContext = Awaited<ReturnType<typeof externalContext>>

export function externalError(error: unknown, server: McpServer, execution: ExternalExecution) {
  let message = redactMcp(error, server)
  for (const id of [...execution.sessionRedactions, execution.session?.sessionId]) {
    if (id) {
      message = message.replaceAll(id, "[session]")
    }
  }
  return message
}

export function resultRedactionServer(context: ExternalContext): McpServer {
  const server = context.entry.server
  if (!context.execution.session?.sessionId) {
    return server
  }
  const headers: Record<string, string> = {
    ...server.headers,
    "Mcp-Session-Id": context.execution.session.sessionId
  }
  for (const [index, id] of context.execution.sessionRedactions.entries()) {
    headers["Mcp-Previous-Session-" + index] = id
  }
  return { ...server, headers }
}

export function rememberSession(execution: ExternalExecution, snapshot: McpSessionSnapshot) {
  const ids = [
    ...new Set(
      [...execution.sessionRedactions, execution.session?.sessionId, snapshot.sessionId].filter((id): id is string => {
        return Boolean(id)
      })
    )
  ]
  execution.sessionRedactions = ids
  if (ids.length > 64) {
    execution.sessionRedactions = [ids[0], ...ids.slice(-63)]
  }
  execution.session = snapshot
}
