import { z } from 'zod'
import type { CallToolResult } from '@earendil-works/pi-mcp'
import { McpServerSchema } from '@pi-im-bot/resources/mcp/schema'
import type { McpRemoteTask } from '@pi-im-bot/resources/mcp/task-schema'
import { McpTaskCapabilitiesSchema } from '@pi-im-bot/resources/mcp/task-schema'

const RpcSchema = z.object({
  id: z.union([z.string(), z.number()]).optional(),
  method: z.string(),
  params: z.record(z.string(), z.unknown()).optional()
})
interface FixtureTask {
  task: McpRemoteTask
  session: string
  result: CallToolResult
}

export function mcpTaskFixture() {
  const state = {
    sessions: new Map<string, Set<string>>(),
    tasks: new Map<string, FixtureTask>(),
    initializes: 0,
    submissions: 0,
    syncCalls: 0,
    taskSupport: 'required' as 'required' | 'optional',
    polls: 0,
    results: 0,
    cancels: 0,
    deletes: 0,
    duplicateIds: 0,
    retainAcrossSessions: false,
    holdSubmit: false,
    failPolls: 0,
    loseCancel: false,
    completeOnCancel: false,
    canCancel: true,
    rejectSubmit: false,
    failResult: false,
    ttl: 60000,
    calls: [] as string[]
  }
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      if (request.headers.get('authorization') !== 'Bearer task-fixture-key') {
        return new Response('Unauthorized', { status: 401 })
      }
      const session = request.headers.get('mcp-session-id')
      if (request.method === 'DELETE') {
        state.deletes += 1
        state.sessions.delete(session ?? '')
        for (const value of state.tasks.values()) {
          if (value.session === session && value.task.status === 'working') {
            value.task.status = 'cancelled'
          }
        }
        return new Response(null, { status: 204 })
      }
      if (request.method !== 'POST') {
        return new Response(null, { status: 405 })
      }
      const rpc = RpcSchema.parse(await request.json())
      state.calls.push(rpc.method)
      if (rpc.method === 'initialize') {
        state.initializes += 1
        const id = 'PRIVATE_MCP_SESSION_' + crypto.randomUUID()
        state.sessions.set(id, new Set([String(rpc.id)]))
        const tasks = McpTaskCapabilitiesSchema.parse({ requests: { tools: { call: {} } } })
        if (state.canCancel) {
          tasks.cancel = {}
        }
        return Response.json(
          {
            jsonrpc: '2.0',
            id: rpc.id,
            result: {
              protocolVersion: '2025-11-25',
              serverInfo: { name: 'task-fixture', version: '1' },
              capabilities: { tools: {}, tasks }
            }
          },
          { headers: { 'mcp-session-id': id } }
        )
      }
      if (!session || !state.sessions.has(session)) {
        return new Response('Session expired', { status: 404 })
      }
      if (rpc.id === undefined) {
        return new Response(null, { status: 202 })
      }
      const ids = state.sessions.get(session)!
      if (ids.has(String(rpc.id))) {
        state.duplicateIds += 1
      }
      ids.add(String(rpc.id))
      function ok(result: object) {
        return Response.json({ jsonrpc: '2.0', id: rpc.id, result })
      }
      function invalid() {
        return Response.json({ jsonrpc: '2.0', id: rpc.id, error: { code: -32602, message: 'Invalid task' } })
      }
      if (rpc.method === 'tools/list') {
        return ok({
          tools: [
            {
              name: 'render',
              description: 'Generate a media result asynchronously',
              inputSchema: {
                type: 'object',
                properties: { prompt: { type: 'string' } },
                required: ['prompt'],
                additionalProperties: false
              },
              execution: { taskSupport: state.taskSupport }
            }
          ]
        })
      }
      if (rpc.method === 'tools/call') {
        const input = z
          .object({ task: z.object({ ttl: z.number() }).optional(), name: z.literal('render') })
          .parse(rpc.params)
        if (!input.task) {
          if (state.taskSupport === 'required') {
            return invalid()
          }
          state.syncCalls += 1
          return ok({ content: [{ type: 'text', text: 'FAST_DIRECT_RESULT' }] })
        }
        if (state.rejectSubmit) {
          return invalid()
        }
        state.submissions += 1
        const task: McpRemoteTask = {
          taskId: crypto.randomUUID(),
          status: 'working',
          statusMessage: 'running in ' + session,
          createdAt: new Date().toISOString(),
          lastUpdatedAt: new Date().toISOString(),
          ttl: state.ttl,
          pollInterval: 250
        }
        state.tasks.set(task.taskId, {
          task,
          session,
          result: { content: [{ type: 'text', text: 'EXTERNAL_RESULT' }] }
        })
        if (state.holdSubmit) {
          return new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(new TextEncoder().encode(': pending\n\n'))
              }
            }),
            { headers: { 'content-type': 'text/event-stream' } }
          )
        }
        return ok({ task })
      }
      const { taskId } = z.object({ taskId: z.string() }).parse(rpc.params)
      const value = state.tasks.get(taskId)
      if (!value || (!state.retainAcrossSessions && value.session !== session)) {
        return invalid()
      }
      if (rpc.method === 'tasks/get') {
        state.polls += 1
        if (state.failPolls > 0) {
          state.failPolls -= 1
          return new Response('Retry later', { status: 503 })
        }
        return ok(value.task)
      }
      if (rpc.method === 'tasks/result') {
        state.results += 1
        if (state.failResult) {
          return Response.json({
            jsonrpc: '2.0',
            id: rpc.id,
            error: { code: -32000, message: 'REMOTE_WORK_REJECTED' }
          })
        }
        return ok(value.result)
      }
      if (rpc.method === 'tasks/cancel') {
        state.cancels += 1
        if (state.completeOnCancel) {
          value.task.status = 'completed'
          return invalid()
        }
        if (['completed', 'failed', 'cancelled'].includes(value.task.status)) {
          return invalid()
        }
        value.task.status = 'cancelled'
        if (state.loseCancel) {
          return new Response('Connection lost', { status: 503 })
        }
        return ok(value.task)
      }
      return invalid()
    }
  })
  return {
    state,
    server,
    config: McpServerSchema.parse({
      id: 'rendering',
      name: 'Rendering',
      enabled: true,
      url: `http://127.0.0.1:${server.port}/mcp`,
      headers: { Authorization: 'Bearer task-fixture-key' },
      timeoutMs: 1000,
      tasks: { pollIntervalMs: 250, maxPending: 1 }
    }),
    complete(
      id = [...state.tasks.keys()][0],
      result: CallToolResult = { content: [{ type: 'text', text: 'EXTERNAL_RESULT' }] }
    ) {
      const value = state.tasks.get(id)!
      value.task.status = 'completed'
      value.task.lastUpdatedAt = new Date().toISOString()
      value.result = result
    }
  }
}
