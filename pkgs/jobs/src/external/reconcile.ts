import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context"
import { McpError } from "@earendil-works/pi-mcp"
import type { JobService } from "../service"
import { jobTerminal, jobSummary } from "../schema"
import { externalContext, externalError, resultRedactionServer } from "./context"
import { openExternalStatus } from "./connection"
import { McpCallResultSchema } from "@pi-im-bot/resources/mcp/tasks"
import { cancelExternal, type ExternalCancellation } from "./cancel"
import { externalResult } from "./result"
import { releaseExternal, saveExternal, type ExternalOutcome } from "./state"
import { mergeExternalOutcome } from "./outcome"

/** Explicit local operator action: inspect/cancel an existing receipt; never submit work or resend chat output. */
export async function reconcileExternal(service: JobService, roomId: string, jobId: string, cancel: boolean) {
  const job = await service.repository.get(jobId, roomId)
  const revision = job.currentRevision
  const value = job.revisions[String(revision)]
  if (!jobTerminal(value.state) || value.delivery === "pending") {
    throw new Error("任务仍由运行时处理，请使用停止任务或等待其收尾")
  }
  if (!value.external?.hasReceipt) {
    throw new Error("没有远端任务回执，不能核对，也不会重新提交")
  }
  if (value.state !== "outcome_unknown") {
    return jobSummary(job)
  }
  const context = await externalContext(service, { jobId, revision })
  let operation: ExternalCancellation | undefined
  let committed = false
  try {
    if (cancel) {
      operation = await cancelExternal(service, { jobId, revision }, BACKGROUND_CONTEXT, true)
    } else {
      const signal = AbortSignal.timeout(Math.min(30000, context.entry.server.timeoutMs))
      const opened = await openExternalStatus(context, signal)
      let terminal = false
      let outcome: ExternalOutcome = {
        state: "outcome_unknown",
        error: "远端仍在处理；自动等待已结束。本次仅核对状态。"
      }
      operation = {
        outcome,
        async close(saved) {
          await opened.connection.close(saved && terminal)
        }
      }
      if (opened.current.status === "completed" || opened.current.status === "failed") {
        try {
          const result = McpCallResultSchema.parse(
            await opened.connection.client.request("tasks/result", { taskId: opened.current.taskId }, { signal })
          )
          const projected = await externalResult(
            result,
            resultRedactionServer(context),
            context.entry.id,
            context.config.dataDir,
            context.job,
            revision
          )
          let state: "succeeded" | "failed" = "succeeded"
          if (result.isError || opened.current.status === "failed") {
            state = "failed"
          }
          outcome = { state, result: projected }
        } catch (error) {
          if (opened.current.status !== "failed" || !(error instanceof McpError)) {
            throw error
          }
          outcome = { state: "failed", error: externalError(error, context.entry.server, context.execution) }
        }
        terminal = true
      } else if (opened.current.status === "cancelled") {
        outcome = { state: "cancelled", error: "远端已确认取消" }
        terminal = true
      }
      operation.outcome = outcome
    }
    if (!operation) {
      throw new Error("此任务没有持久外部操作记录")
    }
    let outcome = operation.outcome
    await service.runtime.native.commit(async (tx) => {
      if (!cancel) {
        await saveExternal(tx, context.key, context.execution)
      }
      await service.repository.change(tx, jobId, revision, (current) => {
        if (!jobTerminal(current.state) || current.delivery === "pending") {
          throw new Error("任务状态已变化，请重新读取")
        }
        if (current.state !== "outcome_unknown" && outcome.state === "outcome_unknown") {
          return
        }
        outcome = mergeExternalOutcome(current.result, outcome)
        current.state = outcome.state
        current.result = outcome.result
        current.error = outcome.error
        if (outcome.state === "failed" && !current.error) {
          current.error = outcome.result?.summary ?? "远端失败"
        }
        current.finishedAt ??= Date.now()
        current.external = {
          status: outcome.state,
          message: "已手动核对远端状态；未再次提交或发送聊天消息",
          attempts: (current.external?.attempts ?? 0) + 1,
          hasReceipt: true
        }
      })
      await releaseExternal(tx, context.key)
    }, BACKGROUND_CONTEXT)
    committed = true
    const updated = await service.repository.get(jobId, roomId)
    await service.recordReconciledFacts(updated)
    service.changed(updated)
    return jobSummary(updated)
  } catch (error) {
    throw new Error(externalError(error, context.entry.server, context.execution))
  } finally {
    await operation?.close(committed)
  }
}
