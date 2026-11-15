import { McpClient, StreamableHttpTransport, type ClientCapabilities } from '@earendil-works/pi-mcp'
import { compile } from '@earendil-works/pi-schema'
import { McpManifestSchema, McpToolSchema, type McpServer, type McpManifest } from './schema'
import { mcpServerRevision } from './identity'
import { McpInitializationSchema, McpSessionSnapshotSchema, type McpSessionSnapshot } from './task-schema'
import { PersistentMcpTransport } from './session-transport'
import { boundedMcpFetch } from './fetch'

export function redactMcpText(value: string, server: McpServer) {
  let text = value
  const values = [
    ...Object.values(server.headers),
    ...Object.values(server.headerEnv).map((name) => {
      return process.env[name] ?? ''
    }),
    ...new URL(server.url).searchParams.values()
  ]
  const credentials = values.flatMap((value) => {
    const token = /^(?:Bearer|Basic)\s+(.+)$/i.exec(value)?.[1]
    if (token) {
      return [value, token]
    }
    return [value]
  })
  for (const value of credentials) {
    if (value) {
      text = text.replaceAll(value, '[redacted]')
    }
  }
  return text
}

export function redactMcp(error: unknown, server: McpServer) {
  return redactMcpText(String(error), server).slice(0, 2000)
}

export async function connectMcp(
  server: McpServer,
  signal: AbortSignal,
  options: { persistent?: boolean; resume?: McpSessionSnapshot } = {}
) {
  signal.throwIfAborted()
  const headers = { ...server.headers }
  for (const [header, name] of Object.entries(server.headerEnv)) {
    const value = process.env[name]
    if (value === undefined) {
      throw new Error(`MCP ${server.id} 缺少配置的环境变量 ${name}`)
    }
    headers[header] = value
  }
  if (
    options.persistent &&
    Object.keys(headers).some((name) => {
      return name.toLowerCase() === 'mcp-session-id'
    })
  ) {
    throw new Error('MCP Tasks 的会话 ID 由运行时管理，不能配置在 Headers 中')
  }
  const capabilities: ClientCapabilities & { tasks: Record<string, never> } = { tasks: {} }
  const client = new McpClient({
    name: 'pi-im-bot',
    version: '0.1.0',
    requestTimeoutMs: server.timeoutMs,
    capabilities
  })
  let persistent: PersistentMcpTransport | undefined
  if (options.persistent) {
    persistent = new PersistentMcpTransport(server.url, headers, options.resume)
  }
  const transport =
    persistent ??
    new StreamableHttpTransport({
      url: server.url,
      headers,
      fetch: boundedMcpFetch,
      maxMessageBytes: 8 * 1024 * 1024,
      openGetStream: false,
      reconnect: { maxRetries: 0 }
    })
  function abort() {
    void client.close().catch(() => {})
  }
  function sessionId() {
    if (persistent) {
      return persistent.transport.sessionId
    }
    if (transport instanceof StreamableHttpTransport) {
      return transport.sessionId
    }
    return undefined
  }
  function redactConnection(error: unknown) {
    let message = redactMcp(error, server)
    const id = sessionId()
    if (id) {
      message = message.replaceAll(id, '[session]')
    }
    return message
  }
  signal.addEventListener('abort', abort, { once: true })
  let initialization
  try {
    initialization = McpInitializationSchema.parse(await client.connect(transport))
    signal.throwIfAborted()
  } catch (error) {
    const message = redactConnection(error)
    signal.removeEventListener('abort', abort)
    if (!options.resume) {
      persistent?.terminateSession()
    }
    await client.close().catch(() => {})
    throw new Error(message)
  }
  return {
    client,
    initialization,
    redact: redactConnection,
    snapshot(): McpSessionSnapshot {
      const { instructions: _instructions, ...protocol } = initialization
      return McpSessionSnapshotSchema.parse({ sessionId: sessionId(), initialization: protocol })
    },
    async close(terminateSession = false) {
      signal.removeEventListener('abort', abort)
      if (terminateSession) {
        persistent?.terminateSession()
      }
      await client.close()
    }
  }
}

export async function inspectMcp(server: McpServer, signal: AbortSignal): Promise<McpManifest> {
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(server.timeoutMs)])
  const connection = await connectMcp(server, deadline)
  try {
    const tools = McpToolSchema.array()
      .max(500)
      .parse(await connection.client.listTools({ signal: deadline }))
    if (
      new Set(
        tools.map((tool) => {
          return tool.name
        })
      ).size !== tools.length
    ) {
      throw new Error('MCP 返回重复工具名')
    }
    for (const tool of tools) {
      compile(tool.inputSchema)
    }
    return McpManifestSchema.parse({
      serverId: server.id,
      configRevision: mcpServerRevision(server),
      fetchedAt: Date.now(),
      instructions: connection.client.instructions ?? '',
      tools,
      protocolVersion: connection.initialization.protocolVersion,
      taskCapabilities: connection.initialization.capabilities.tasks
    })
  } catch (error) {
    throw new Error(redactMcp(error, server))
  } finally {
    await connection.close()
  }
}
