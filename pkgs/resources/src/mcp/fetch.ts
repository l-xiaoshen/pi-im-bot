import type { McpFetch } from '@earendil-works/pi-mcp'

export const mcpResponseBudget = 8 * 1024 * 1024

// Pi limits each SSE event. Bound non-SSE bodies before its response.json() allocation too.
export async function boundedMcpFetch(input: Parameters<McpFetch>[0], init?: Parameters<McpFetch>[1]) {
  const response = await fetch(input, init)
  const type = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase()
  if (!response.body || (response.ok && type === 'text/event-stream')) {
    return response
  }
  if (Number(response.headers.get('content-length')) > mcpResponseBudget) {
    await response.body.cancel()
    throw new Error('MCP 超过 8 MiB 响应预算')
  }
  let bytes = 0
  const body = response.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        bytes += chunk.byteLength
        if (bytes > mcpResponseBudget) {
          throw new Error('MCP 超过 8 MiB 响应预算')
        }
        controller.enqueue(chunk)
      }
    })
  )
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers
  })
}
