import type { BotTool } from '@pi-im-bot/capabilities/tool'
import { z } from 'zod'
import { compile } from '@earendil-works/pi-schema'
import type { ResourceLibrary } from '../library'
import type { Settings } from '@pi-im-bot/settings/schema'
import type { ArtifactStore } from '@pi-im-bot/artifacts/store'
import { connectMcp, redactMcp, redactMcpText } from './client'
import { McpToolSchema, type McpServer } from './schema'
import { mcpToolRevision } from './identity'
import { projectMcpResult } from './result'
import { usesMcpTask } from './tasks'
import type { JobToolServices } from '@pi-im-bot/jobs/tools'

const ArgumentsSchema = z.record(z.string(), z.unknown())

export function createMcpTools(
  library: ResourceLibrary,
  settings: Settings,
  allowed: readonly string[],
  artifacts: ArtifactStore,
  signal: AbortSignal,
  jobs?: Pick<JobToolServices, 'operation'>,
  readOnly = false
) {
  const entries = library.mcpTools(settings).filter((entry) => {
    return allowed.includes(entry.id)
  })
  const clients = new Map<string, Promise<Awaited<ReturnType<typeof connectMcp>>>>()
  const ids = new Map(
    entries.map((entry) => {
      return [entry.name, entry.id]
    })
  )
  const tools: BotTool[] = entries.map((entry) => {
    const parameters = entry.tool.inputSchema
    const validator = compile(parameters)
    const asynchronous = usesMcpTask(entry.server, entry.tool, library.manifest(entry.server.id))
    let replay: 'safe' | 'unsafe' = 'unsafe'
    if (asynchronous) {
      replay = 'safe'
    }
    let description = `${entry.tool.name}: ${entry.tool.description ?? 'MCP tool'}\nCapability ID: ${entry.id}`
    if (asynchronous) {
      description +=
        '\nRuns as a persistent background operation. Returns an accepted Job ID immediately, not the final result. The host reports completion; do not repeatedly poll from the root conversation.'
    } else if (usesMcpTask(entry.server, entry.tool, library.manifest(entry.server.id), true)) {
      description +=
        '\nFor a long operation, start_job can use this capability ID for persistent remote polling. A direct call waits for its result.'
    }
    return {
      name: entry.name,
      label: `${entry.server.name} / ${entry.tool.title ?? entry.tool.name}`,
      description,
      parameters,
      replay,
      executionMode: 'sequential',
      namespace: { name: 'mcp__' + entry.server.id, description: entry.server.name },
      async execute(callId, input, toolSignal, update) {
        const args = ArgumentsSchema.parse(input)
        if (!validator.check(args)) {
          throw new Error('MCP 工具参数与登记的 schema 不匹配')
        }
        if (asynchronous) {
          signal.throwIfAborted()
          toolSignal?.throwIfAborted()
          if (!jobs) {
            throw new Error('此工具需要已启用的持久后台任务运行时')
          }
          const job = await jobs.operation(
            (entry.tool.title ?? entry.tool.name).slice(0, 100),
            entry.id,
            z.record(z.string(), z.json()).parse(args),
            callId
          )
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  accepted: true,
                  jobId: job.id,
                  state: job.state,
                  message: '后台操作已受理；完成后由宿主交付，不是已生成结果。'
                })
              }
            ],
            details: { jobId: job.id }
          }
        }
        let connection = clients.get(entry.server.id)
        if (!connection) {
          connection = connectMcp(entry.server, signal)
          clients.set(entry.server.id, connection)
        }
        const controller = new AbortController()
        const timer = setTimeout(() => {
          controller.abort(new Error('MCP 工具超过执行期限；结果可能不确定，未自动重试'))
        }, entry.server.timeoutMs)
        const signals = [signal, controller.signal]
        if (toolSignal) {
          signals.push(toolSignal)
        }
        const deadline = AbortSignal.any(signals)
        let dispatched = false
        try {
          const { client } = await connection
          deadline.throwIfAborted()
          const current = McpToolSchema.array().parse(await client.listTools({ signal: deadline }))
          const tool = current.find((item) => {
            return item.name === entry.tool.name
          })
          if (!tool || mcpToolRevision(tool) !== mcpToolRevision(entry.tool)) {
            throw new Error('MCP 工具定义已变化，请刷新能力目录后重试')
          }
          if (readOnly && tool.annotations?.readOnlyHint !== true) {
            throw new Error('此切入点要求 MCP 工具仍声明为只读')
          }
          deadline.throwIfAborted()
          dispatched = true
          const result = await client.callTool(entry.tool.name, args, {
            signal: deadline,
            timeoutMs: entry.server.timeoutMs,
            onProgress(progress) {
              update?.({
                content: [
                  {
                    type: 'text',
                    text: redactMcpText(progress.message ?? String(progress.progress), entry.server)
                  }
                ],
                details: { capabilityId: entry.id }
              })
            }
          })
          deadline.throwIfAborted()
          const output = await projectMcpResult(result, entry.id, artifacts, entry.server)
          return {
            content: output.content,
            details: {
              capabilityId: entry.id,
              summary: output.summary,
              artifactId: output.artifactId,
              artifactIds: output.artifactIds
            },
            isError: result.isError
          }
        } catch (error) {
          let cause = error
          if (deadline.aborted) {
            cause = deadline.reason
          }
          let message = redactMcp(cause, entry.server)
          if (dispatched) {
            message = 'MCP 调用结果可能不确定，未自动重试。' + message
          }
          throw new Error(message)
        } finally {
          clearTimeout(timer)
        }
      }
    }
  })
  return {
    tools,
    capabilityFor(name: string) {
      return ids.get(name) ?? name
    },
    async close() {
      await Promise.allSettled(
        [...clients.values()].map(async (client) => {
          await (await client).close()
        })
      )
    }
  }
}
