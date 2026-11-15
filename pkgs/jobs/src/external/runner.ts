import { z } from "zod"
import { compile } from "@earendil-works/pi-schema"
import { McpError, McpHttpError } from "@earendil-works/pi-mcp"
import type { Context } from "@earendil-works/chord/context"
import type { JobService } from "../service"
import type { ActiveJobTask, JobTaskRuntime } from "../task"
import type { Configuration } from "@pi-im-bot/config/load"
import type { JobRevision } from "../schema"
import { connectMcp } from "@pi-im-bot/resources/mcp/client"
import { usesMcpTask, CreateMcpTaskResultSchema, McpCallResultSchema } from "@pi-im-bot/resources/mcp/tasks"
import { McpRemoteTaskSchema, type McpRemoteTask } from "@pi-im-bot/resources/mcp/task-schema"
import { McpToolSchema } from "@pi-im-bot/resources/mcp/schema"
import { mcpToolRevision } from "@pi-im-bot/resources/mcp/identity"
import { externalContext, externalError, resultRedactionServer, rememberSession, type ExternalContext } from "./context"
import { claimExternal, saveExternal, finishExternal } from "./state"
import { externalResult } from "./result"
import { cancelExternal } from "./cancel"
import { openExternalStatus } from "./connection"

export class ExternalJobRunner {
  constructor(readonly service: JobService) {}

  supports(config: Configuration, value: JobRevision) {
    if (value.spec.kind !== "tool") {
      return false
    }
    const capability = value.spec.capability
    const entry = config.resources.mcpTools(value.context.effective.settings).find((entry) => {
      return entry.id === capability
    })
    return Boolean(entry && usesMcpTask(entry.server, entry.tool, config.resources.manifest(entry.server.id), true))
  }

  private authorize(value: ExternalContext, signal: AbortSignal, submitted: boolean) {
    signal.throwIfAborted()
    if (value.job.currentRevision !== value.value.revision || value.value.cancelRequested) {
      throw new Error("外部任务版本已停止")
    }
    if (submitted) {
      this.service.coordinator.authorizeExternalContext(
        value.job.roomId,
        value.value.mode,
        value.value.context,
        value.entry.id,
        value.entry.server.id
      )
    } else {
      this.service.coordinator.authorizeContext(value.job.roomId, value.value.mode, value.value.context, value.entry.id)
    }
  }

  async start(task: ActiveJobTask, runtime: JobTaskRuntime, context: Context) {
    const value = await externalContext(this.service, task.input)
    const server = value.entry.server
    const signal = AbortSignal.any([
      runtime.signal,
      AbortSignal.timeout(Math.max(1, Math.min(server.timeoutMs, value.value.deadlineAt - Date.now())))
    ])
    let connection: Awaited<ReturnType<typeof connectMcp>> | undefined
    let dispatched = false
    try {
      this.authorize(value, signal, false)
      if (!compile(value.entry.tool.inputSchema).check(value.spec.arguments)) {
        throw new Error("后台操作参数与登记的 schema 不匹配")
      }
      if (
        !(await claimExternal(
          this.service,
          task,
          server.id,
          this.service.coordinator.externalTaskLimit(server.id),
          context
        ))
      ) {
        await runtime.commit(async (tx) => {
          await this.service.repository.change(tx, value.job.id, value.value.revision, (revision) => {
            revision.state = "queued"
            revision.external = { status: "waiting_capacity", attempts: 0, hasReceipt: false }
          })
          return undefined
        }, context)
        this.service.changed(await this.service.repository.get(value.job.id))
        await runtime.sleepUntil(Math.min(value.value.deadlineAt, Date.now() + 1000), { phase: "work" }, context)
        return
      }
      connection = await connectMcp(server, signal, { persistent: true })
      rememberSession(value.execution, connection.snapshot())
      if (!connection.initialization.capabilities.tasks?.requests?.tools?.call) {
        throw new Error("服务没有声明 tools/call 的 MCP Tasks 能力，请刷新目录")
      }
      const current = McpToolSchema.array()
        .parse(await connection.client.listTools({ signal }))
        .find((tool) => {
          return tool.name === value.entry.tool.name
        })
      if (!current || mcpToolRevision(current) !== mcpToolRevision(value.entry.tool)) {
        throw new Error("MCP 工具定义已变化，请刷新目录")
      }
      rememberSession(value.execution, connection.snapshot())
      value.execution.submittedAt = Date.now()
      await runtime.commit(async (tx) => {
        await saveExternal(tx, value.key, value.execution)
        await this.service.repository.change(tx, value.job.id, value.value.revision, (revision) => {
          revision.state = "waiting_external"
          revision.external = { status: "submitting", attempts: 0, hasReceipt: false }
        })
        return { status: "running", checkpoint: { phase: "dispatching" } }
      }, context)
      this.authorize(value, signal, false)
      dispatched = true
      const result = CreateMcpTaskResultSchema.parse(
        await connection.client.request(
          "tools/call",
          {
            name: value.entry.tool.name,
            arguments: value.spec.arguments,
            task: { ttl: Math.max(1000, value.value.deadlineAt - Date.now()) }
          },
          { signal }
        )
      )
      await this.remember(task, runtime, context, value, result.task)
    } catch (error) {
      if (runtime.signal.aborted) {
        throw error
      }
      let state: "failed" | "outcome_unknown" = "failed"
      if (dispatched && !(error instanceof McpError)) {
        state = "outcome_unknown"
      }
      await finishExternal(this.service, task, runtime, context, {
        state,
        error: externalError(error, server, value.execution)
      })
    } finally {
      await connection?.close()
    }
  }

  private async remember(
    task: ActiveJobTask,
    runtime: JobTaskRuntime,
    context: Context,
    value: ExternalContext,
    remote: McpRemoteTask
  ) {
    if (value.execution.remote && value.execution.remote.taskId !== remote.taskId) {
      throw new Error("远端返回了不同的任务 ID")
    }
    value.execution.remote = remote
    value.execution.failures = 0
    if (remote.ttl !== null) {
      value.execution.expiresAt = (value.execution.submittedAt ?? Date.now()) + remote.ttl
    }
    const interval = remote.pollInterval ?? value.entry.server.tasks.pollIntervalMs
    let nextPollAt = Date.now() + Math.max(250, interval)
    if (["completed", "failed", "cancelled"].includes(remote.status)) {
      nextPollAt = Date.now()
    }
    nextPollAt = Math.min(nextPollAt, value.value.deadlineAt)
    if (value.execution.expiresAt && value.execution.expiresAt > Date.now()) {
      nextPollAt = Math.min(nextPollAt, value.execution.expiresAt)
    }
    await runtime.commit(async (tx) => {
      await saveExternal(tx, value.key, value.execution)
      await this.service.repository.change(tx, value.job.id, value.value.revision, (revision) => {
        revision.state = "waiting_external"
        if (remote.status === "input_required") {
          revision.state = "waiting_input"
        }
        revision.external = {
          status: remote.status,
          message: externalError(remote.statusMessage ?? "", value.entry.server, value.execution),
          nextPollAt,
          attempts: (revision.external?.attempts ?? 0) + 1,
          hasReceipt: true
        }
      })
      return { status: "running", checkpoint: { phase: "poll" } }
    }, context)
    this.service.changed(await this.service.repository.get(value.job.id))
    await runtime.sleepUntil(nextPollAt, { phase: "poll" }, context)
  }

  async poll(task: ActiveJobTask, runtime: JobTaskRuntime, context: Context) {
    const value = await externalContext(this.service, task.input)
    const server = value.entry.server
    const remote = value.execution.remote
    if (!remote || !value.execution.session) {
      await finishExternal(this.service, task, runtime, context, {
        state: "outcome_unknown",
        error: "外部任务回执缺失，未重新提交"
      })
      return
    }
    const signal = AbortSignal.any([runtime.signal, AbortSignal.timeout(Math.min(server.timeoutMs, 30000))])
    let connection: Awaited<ReturnType<typeof connectMcp>> | undefined
    let terminal = false
    try {
      this.authorize(value, signal, true)
      if (Date.now() >= value.value.deadlineAt) {
        const cancelled = await cancelExternal(this.service, task.input, context)
        let committed = false
        try {
          await finishExternal(
            this.service,
            task,
            runtime,
            context,
            cancelled?.outcome ?? { state: "outcome_unknown", error: "已超过等待期限；远端状态无法确认" }
          )
          committed = true
        } finally {
          await cancelled?.close(committed)
        }
        return
      }
      const opened = await openExternalStatus(value, signal)
      connection = opened.connection
      const current = opened.current
      if (opened.renewed) {
        await runtime.commit(async (tx) => {
          await saveExternal(tx, value.key, value.execution)
          return undefined
        }, context)
      }
      if (current.taskId !== remote.taskId) {
        throw new Error("远端任务 ID 不匹配")
      }
      value.execution.remote = current
      if (current.status === "working") {
        await this.remember(task, runtime, context, value, current)
        return
      }
      if (current.status === "input_required") {
        await runtime.commit(async (tx) => {
          await saveExternal(tx, value.key, value.execution)
          await this.service.repository.change(tx, value.job.id, value.value.revision, (revision) => {
            revision.state = "waiting_input"
            revision.external = {
              status: current.status,
              message: "远端需要输入；当前连接未声明采样或交互确认能力",
              attempts: (revision.external?.attempts ?? 0) + 1,
              hasReceipt: true
            }
          })
          return undefined
        }, context)
        this.service.changed(await this.service.repository.get(value.job.id))
      }
      if (current.status === "cancelled") {
        await finishExternal(this.service, task, runtime, context, {
          state: "cancelled",
          error: "远端任务已取消"
        })
        terminal = true
        return
      }
      // input_required may deliver reverse requests over this result stream. We do not advertise sampling/elicitation.
      const raw = await connection.client.request("tasks/result", { taskId: remote.taskId }, { signal })
      const result = McpCallResultSchema.parse(raw)
      this.authorize(value, signal, true)
      const projected = await externalResult(
        result,
        resultRedactionServer(value),
        value.entry.id,
        value.config.dataDir,
        value.job,
        value.value.revision
      )
      let state: "succeeded" | "failed" = "succeeded"
      if (result.isError || current.status === "failed") {
        state = "failed"
      }
      await finishExternal(this.service, task, runtime, context, { state, result: projected })
      terminal = true
    } catch (error) {
      if (runtime.signal.aborted) {
        throw error
      }
      value.execution.failures += 1
      if (value.execution.remote?.status === "failed" && error instanceof McpError) {
        await finishExternal(this.service, task, runtime, context, {
          state: "failed",
          error: externalError(error, server, value.execution)
        })
        terminal = true
        return
      }
      let retry = Date.now() < value.value.deadlineAt && value.execution.failures < server.tasks.maxPollFailures
      if (
        (error instanceof McpHttpError && [401, 403, 404].includes(error.status)) ||
        (error instanceof McpError && [-32601, -32602].includes(error.code))
      ) {
        retry = false
      }
      let revoked = false
      try {
        this.authorize(value, runtime.signal, true)
      } catch {
        retry = false
        revoked = true
      }
      if (revoked) {
        await runtime.commit(async (tx) => {
          await this.service.repository.change(tx, value.job.id, value.value.revision, (revision) => {
            revision.cancelRequested = true
          })
          return undefined
        }, context)
        const cancelled = await cancelExternal(this.service, task.input, context)
        let committed = false
        try {
          await finishExternal(
            this.service,
            task,
            runtime,
            context,
            cancelled?.outcome ?? { state: "outcome_unknown", error: "调用权限已撤销，远端状态无法确认" }
          )
          committed = true
        } finally {
          await cancelled?.close(committed)
        }
        return
      }
      const message = externalError(error, server, value.execution)
      if (!retry) {
        let state: "failed" | "outcome_unknown" = "outcome_unknown"
        if (value.execution.remote?.status === "failed" && error instanceof McpError) {
          state = "failed"
        }
        await finishExternal(this.service, task, runtime, context, { state, error: message })
        if (state === "failed") {
          terminal = true
        }
        return
      }
      const delay = Math.max(
        remote.pollInterval ?? server.tasks.pollIntervalMs,
        Math.min(300000, 1000 * 2 ** value.execution.failures)
      )
      const nextPollAt = Math.min(Date.now() + delay, value.value.deadlineAt)
      await runtime.commit(async (tx) => {
        await saveExternal(tx, value.key, value.execution)
        await this.service.repository.change(tx, value.job.id, value.value.revision, (revision) => {
          revision.external = {
            status: remote.status,
            message,
            nextPollAt,
            attempts: (revision.external?.attempts ?? 0) + 1,
            hasReceipt: true
          }
        })
        return undefined
      }, context)
      this.service.changed(await this.service.repository.get(value.job.id))
      await runtime.sleepUntil(nextPollAt, { phase: "poll" }, context)
    } finally {
      await connection?.close(terminal)
    }
  }
}
