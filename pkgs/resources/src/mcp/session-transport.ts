import { z } from 'zod'
import {
  StreamableHttpTransport,
  isJsonRpcRequest,
  isJsonRpcResponse,
  type McpTransport,
  type McpTransportSendOptions,
  type McpTransportMessageListener,
  type JsonRpcMessage,
  type JsonRpcId,
  type McpFetch
} from '@earendil-works/pi-mcp'
import type { McpSessionSnapshot } from './task-schema'
import { boundedMcpFetch } from './fetch'

const RpcSchema = z.object({ id: z.union([z.string(), z.number()]).optional(), method: z.string() })

/** A public transport wrapper: preserve remote sessions while releasing local clients. */
export class PersistentMcpTransport implements McpTransport {
  readonly transport: StreamableHttpTransport
  private readonly wireIds = new Map<JsonRpcId, JsonRpcId>()
  private readonly localIds = new Map<JsonRpcId, JsonRpcId>()
  private readonly prefix = crypto.randomUUID() + ':'
  private preserve = true

  constructor(
    url: string,
    headers: Record<string, string>,
    private readonly saved?: McpSessionSnapshot
  ) {
    const fetchSession: McpFetch = async (input, init) => {
      if (init?.method === 'DELETE' && this.preserve) {
        return new Response(null, { status: 204 })
      }
      if (this.saved && typeof init?.body === 'string') {
        const message = RpcSchema.safeParse(JSON.parse(init.body))
        if (message.success && message.data.method === 'initialize') {
          const responseHeaders = new Headers()
          if (this.saved.sessionId) {
            responseHeaders.set('mcp-session-id', this.saved.sessionId)
          }
          return Response.json(
            { jsonrpc: '2.0', id: message.data.id, result: this.saved.initialization },
            { headers: responseHeaders }
          )
        }
        if (message.success && message.data.method === 'notifications/initialized') {
          return new Response(null, { status: 202 })
        }
      }
      return boundedMcpFetch(input, init)
    }
    this.transport = new StreamableHttpTransport({
      url,
      headers,
      fetch: fetchSession,
      maxMessageBytes: 8 * 1024 * 1024,
      openGetStream: false,
      reconnect: { maxRetries: 0 }
    })
  }

  start() {
    return this.transport.start()
  }
  setProtocolVersion(version: string) {
    this.transport.setProtocolVersion(version)
  }
  terminateSession() {
    this.preserve = false
  }
  close() {
    return this.transport.close()
  }
  onError: McpTransport['onError'] = (listener) => {
    return this.transport.onError(listener)
  }
  onClose: McpTransport['onClose'] = (listener) => {
    return this.transport.onClose(listener)
  }
  onMessage(listener: McpTransportMessageListener) {
    return this.transport.onMessage((message) => {
      if (isJsonRpcResponse(message)) {
        const id = this.localIds.get(message.id)
        if (id !== undefined) {
          listener({ ...message, id })
          return
        }
      }
      listener(message)
    })
  }
  send(message: JsonRpcMessage, options?: McpTransportSendOptions) {
    if (isJsonRpcRequest(message)) {
      const id = this.prefix + message.id
      this.wireIds.set(message.id, id)
      this.localIds.set(id, message.id)
      return this.transport.send({ ...message, id }, options)
    }
    if ('method' in message && message.method === 'notifications/cancelled') {
      const input = z
        .object({ requestId: z.union([z.string(), z.number()]) })
        .passthrough()
        .safeParse(message.params)
      if (input.success) {
        return this.transport.send(
          {
            ...message,
            params: {
              ...input.data,
              requestId: this.wireIds.get(input.data.requestId) ?? input.data.requestId
            }
          },
          options
        )
      }
    }
    return this.transport.send(message, options)
  }
}
