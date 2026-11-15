import { McpError } from "@earendil-works/pi-mcp"
import { BACKGROUND_CONTEXT, type Context } from "@earendil-works/chord/context"
import type { JobService } from "../service"
import type { JobTaskInput } from "../task"
import { connectMcp } from "@pi-im-bot/resources/mcp/client"
import { McpRemoteTaskSchema } from "@pi-im-bot/resources/mcp/task-schema"
import { McpCallResultSchema } from "@pi-im-bot/resources/mcp/tasks"
import { ExternalExecutions, externalKey, ExternalExecutionSchema } from "./documents"
import { externalContext, externalError, resultRedactionServer } from "./context"
import { saveExternal, type ExternalOutcome } from "./state"
import { externalResult } from "./result"
import { openExternalStatus } from "./connection"

export interface ExternalCancellation {
  outcome: ExternalOutcome
  close(committed: boolean): Promise<void>
}

export async function cancelExternal(
  service: JobService,
  input: JobTaskInput,
  context: Context,
  explicitRetry = false
): Promise<ExternalCancellation | undefined> {
  const stored = await service.runtime.native.snapshot(
    ExternalExecutions,
    externalKey(input.jobId, input.revision),
    BACKGROUND_CONTEXT
  )
  if (!stored?.value) {
    return undefined
  }
  const value = await externalContext(service, input)
  let connection: Awaited<ReturnType<typeof connectMcp>> | undefined
  let terminal = false
  let outcome: ExternalOutcome = { state: "outcome_unknown", error: "已停止等待，远端取消尚未确认" }
  const remote = value.execution.remote
  try {
    if (remote && value.execution.session) {
      const signals = [AbortSignal.timeout(Math.min(10000, value.entry.server.timeoutMs))]
      if (context.abortSignal) {
        signals.push(context.abortSignal)
      }
      const signal = AbortSignal.any(signals)
      const opened = await openExternalStatus(value, signal)
      connection = opened.connection
      let current = opened.current
      if (
        ["working", "input_required"].includes(current.status) &&
        connection.initialization.capabilities.tasks?.cancel
      ) {
        const dispatch = await service.runtime.native.commit(async (tx) => {
          const document = await tx.doc(ExternalExecutions, value.key, null)
          const state = ExternalExecutionSchema.parse(document.value)
          if (state.cancelDispatched && !explicitRetry) {
            return false
          }
          state.cancelDispatched = true
          state.session = value.execution.session
          state.sessionRedactions = value.execution.sessionRedactions
          await saveExternal(tx, value.key, state)
          return true
        }, context)
        if (dispatch) {
          try {
            current = McpRemoteTaskSchema.parse(
              await connection.client.request("tasks/cancel", { taskId: remote.taskId }, { signal })
            )
          } catch (error) {
            if (!(error instanceof McpError) || error.code !== -32602) {
              throw error
            }
            current = McpRemoteTaskSchema.parse(
              await connection.client.request("tasks/get", { taskId: remote.taskId }, { signal })
            )
          }
          if (current.taskId !== remote.taskId) {
            throw new Error("远端取消回执不匹配")
          }
        }
      }
      await service.runtime.native.commit(async (tx) => {
        const document = await tx.doc(ExternalExecutions, value.key, null)
        const state = ExternalExecutionSchema.parse(document.value)
        state.session = value.execution.session
        state.sessionRedactions = value.execution.sessionRedactions
        state.remote = current
        await saveExternal(tx, value.key, state)
      }, context)
      if (current.status === "cancelled") {
        outcome = { state: "cancelled", error: "远端已确认取消" }
        terminal = true
      } else if (current.status === "completed" || current.status === "failed") {
        const result = McpCallResultSchema.parse(
          await connection.client.request("tasks/result", { taskId: remote.taskId }, { signal })
        )
        const projected = await externalResult(
          result,
          resultRedactionServer(value),
          value.entry.id,
          value.config.dataDir,
          value.job,
          value.value.revision
        )
        let state: "succeeded" | "failed" = "succeeded"
        if (current.status === "failed" || result.isError) {
          state = "failed"
        }
        outcome = { state, result: projected }
        terminal = true
      }
    }
  } catch (error) {
    if (context.abortSignal?.aborted) {
      await connection?.close()
      throw error
    }
    outcome = { state: "outcome_unknown", error: externalError(error, value.entry.server, value.execution) }
    if (value.execution.remote?.status === "failed" && error instanceof McpError) {
      outcome.state = "failed"
      terminal = true
    }
  }
  return {
    outcome,
    async close(committed) {
      await connection?.close(committed && terminal)
    }
  }
}
