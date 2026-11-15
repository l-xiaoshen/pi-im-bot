import { McpSessionExpiredError } from '@earendil-works/pi-mcp'
import { connectMcp } from '@pi-im-bot/resources/mcp/client'
import { McpRemoteTaskSchema, type McpRemoteTask } from '@pi-im-bot/resources/mcp/task-schema'
import { rememberSession, type ExternalContext } from './context'

export async function openExternalStatus(value: ExternalContext, signal: AbortSignal) {
  const remote = value.execution.remote
  if (!remote || !value.execution.session) {
    throw new Error('外部任务没有可核对的回执')
  }
  let connection = await connectMcp(value.entry.server, signal, {
    persistent: true,
    resume: value.execution.session
  })
  let renewed = false
  try {
    let current: McpRemoteTask
    try {
      current = McpRemoteTaskSchema.parse(
        await connection.client.request('tasks/get', { taskId: remote.taskId }, { signal })
      )
    } catch (error) {
      if (!(error instanceof McpSessionExpiredError)) {
        throw error
      }
      await connection.close()
      connection = await connectMcp(value.entry.server, signal, { persistent: true })
      rememberSession(value.execution, connection.snapshot())
      current = McpRemoteTaskSchema.parse(
        await connection.client.request('tasks/get', { taskId: remote.taskId }, { signal })
      )
      renewed = true
    }
    if (current.taskId !== remote.taskId) {
      throw new Error('远端任务 ID 不匹配')
    }
    rememberSession(value.execution, connection.snapshot())
    value.execution.remote = current
    return { connection, current, renewed }
  } catch (error) {
    await connection.close()
    throw error
  }
}
