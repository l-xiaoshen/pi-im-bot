import { z } from 'zod'
import { McpServerSchema, type McpTool } from '@pi-im-bot/resources/mcp/schema'
import type { CallToolResult } from '@earendil-works/pi-mcp'

const RequestSchema = z.object({
  id: z.union([z.string(), z.number()]).optional(),
  method: z.string(),
  params: z.record(z.string(), z.unknown()).optional()
})

export function mcpFixture(toolResult?: CallToolResult) {
  const state = {
    calls: 0,
    cancellations: 0,
    fail: false,
    wait: false,
    headers: [] as string[],
    tools: [
      {
        name: 'long-result',
        description: 'Fetch a long report',
        inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] }
      }
    ] as McpTool[]
  }
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      if (request.method === 'DELETE') {
        return new Response(null, { status: 200 })
      }
      if (request.method !== 'POST') {
        return new Response(null, { status: 405 })
      }
      state.headers.push(request.headers.get('X-Literal') ?? '')
      const input = RequestSchema.parse(await request.json())
      if (input.method === 'notifications/cancelled') {
        state.cancellations += 1
      }
      if (input.id === undefined) {
        return new Response(null, { status: 202 })
      }
      let result: object = {}
      if (input.method === 'initialize') {
        result = {
          protocolVersion: '2025-03-26',
          serverInfo: { name: 'fixture', version: '1' },
          capabilities: { tools: {} },
          instructions: 'Fixture reports'
        }
      }
      if (input.method === 'tools/list') {
        result = { tools: state.tools }
      }
      if (input.method === 'tools/call') {
        state.calls += 1
        if (state.fail) {
          return new Response('upstream failure', { status: 503 })
        }
        if (state.wait) {
          return new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(new TextEncoder().encode(': waiting\n\n'))
              }
            }),
            { headers: { 'content-type': 'text/event-stream' } }
          )
        }
        result = toolResult ?? {
          content: [
            {
              type: 'text',
              text: 'report-body-'.repeat(1800) + 'TAIL_EVIDENCE',
              _meta: { private: 'CONTENT_META_SENTINEL' }
            }
          ],
          _meta: { mustNotReachModel: 'PRIVATE_META_SENTINEL' }
        }
      }
      return Response.json({ jsonrpc: '2.0', id: input.id, result })
    }
  })
  return {
    state,
    server,
    config: McpServerSchema.parse({
      id: 'reports',
      name: 'Reports',
      enabled: true,
      url: `http://127.0.0.1:${server.port}/mcp?token=fixture-url-secret`,
      headers: { 'X-Literal': '!this-is-literal', Authorization: 'Bearer fixture-secret' },
      timeoutMs: 1000
    })
  }
}
