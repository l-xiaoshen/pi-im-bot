import { afterEach, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import { SessionManager, createCodingTools } from '@earendil-works/pi-coding-agent'
import { toToolDeclaration } from '@earendil-works/pi-ai'
import { ProviderCatalog } from '@pi-im-bot/providers/catalog'
import { ProvidersConfigSchema } from '@pi-im-bot/providers/schema'
import { BotConfigSchema } from '@pi-im-bot/config/schema'
import { RoomSchema } from '@pi-im-bot/contracts/message'
import { runPi } from '@pi-im-bot/agent/pi-runner'
import { responsesReply } from './responses-fixture'
import { agentInput, testFramework, testResources } from './agent-input'

const roots: string[] = []
const servers: Array<ReturnType<typeof Bun.serve>> = []
afterEach(async () => {
  for (const server of servers.splice(0)) {
    await server.stop(true)
  }
  for (const root of roots.splice(0)) {
    await rm(root, { recursive: true, force: true })
  }
})

test('restored sessions cannot read, write or execute on the host, while scoped bot tools remain usable', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-execution-boundary-'))
  roots.push(root)
  const marker = join(root, 'host-only.txt')
  const secret = `host-sentinel-${crypto.randomUUID()}`
  await writeFile(marker, secret)
  const room = RoomSchema.parse({
    id: 'restricted-room',
    name: 'restricted',
    address: { channel: 'mock', accountId: 'test', kind: 'group', chatId: 'test' },
    mode: 'live',
    providerGroup: 'main',
    createdAt: Date.now(),
    updatedAt: Date.now()
  })
  const workspaceId = createHash('sha256').update(room.id).digest('hex').slice(0, 24)
  const sessionId = createHash('sha256').update(`${room.id}:0:live`).digest('hex').slice(0, 24)
  const workspace = join(root, 'workspaces', workspaceId)
  const sessionDir = join(root, 'pi-sessions', sessionId)
  const agentDir = join(root, 'pi-agent')
  await mkdir(workspace, { recursive: true })
  await mkdir(sessionDir, { recursive: true })
  // These files would alter only the test sentinel if an extension/MCP discovery path were reopened.
  for (const configDir of [join(workspace, '.pi'), agentDir]) {
    await mkdir(join(configDir, 'extensions'), { recursive: true })
    await writeFile(
      join(configDir, 'extensions', 'unsafe.ts'),
      `import { writeFileSync } from 'node:fs'\nwriteFileSync(${JSON.stringify(marker)}, 'extension-loaded')\nexport default function () {}\n`
    )
    await writeFile(
      join(configDir, 'mcp.json'),
      JSON.stringify({
        mcpServers: {
          unsafe: {
            command: process.execPath,
            args: ['-e', `await Bun.write(${JSON.stringify(marker)}, 'mcp-started')`]
          }
        }
      })
    )
  }
  const manager = SessionManager.create(workspace, sessionDir)
  manager.appendMessage({
    role: 'system',
    content: 'Legacy local tools were enabled.',
    toolsAdded: createCodingTools(workspace).map(toToolDeclaration),
    timestamp: Date.now()
  })
  manager.appendMessage({ role: 'user', content: 'A previous conversation', timestamp: Date.now() })

  const attempts = [
    { name: 'read', arguments: { path: marker } },
    { name: 'write', arguments: { path: marker, content: 'overwritten' } },
    { name: 'bash', arguments: { command: `printf changed > '${marker}'` } },
    { name: 'codemode', arguments: { code: `text(await tools.read({path: ${JSON.stringify(marker)}}))` } },
    { name: 'chat_history', arguments: { limit: 1 } }
  ]
  let calls = 0
  let historyCalls = 0
  const requestedTools: string[][] = []
  const toolResults: string[] = []
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      const body = z
        .object({ tools: z.array(z.object({ name: z.string() })).default([]), input: z.unknown() })
        .parse(await request.json())
      requestedTools.push(
        body.tools.map((tool) => {
          return tool.name
        })
      )
      expect(JSON.stringify(body.input)).not.toContain(secret)
      const attempt = attempts[calls]
      calls += 1
      if (attempt) {
        return responsesReply({ kind: 'tool', ...attempt })
      }
      return responsesReply({ kind: 'text', text: 'restricted run complete' })
    }
  })
  servers.push(server)
  const providerConfig = ProvidersConfigSchema.parse({
    defaultGroup: 'main',
    providers: [
      {
        id: 'test',
        baseUrl: `http://127.0.0.1:${server.port}/v1`,
        apiKey: 'test-only',
        models: [{ id: 'test-model' }]
      }
    ],
    groups: [{ id: 'main', candidates: [{ provider: 'test', model: 'test-model' }] }]
  })
  const catalog = await ProviderCatalog.create(providerConfig, root)
  const result = await runPi(
    {
      bot: BotConfigSchema.parse({}),
      catalog,
      framework: testFramework(),
      resources: testResources(),
      dataDir: root,
      configDir: root,
      projectDir: process.cwd()
    },
    room,
    agentInput(room, 'Controlled boundary test'),
    new AbortController().signal,
    {
      authorize() {},
      history() {
        historyCalls += 1
        return []
      },
      async send() {
        throw new Error('Unexpected send')
      }
    },
    {
      trace(event) {
        if (event.kind === 'tool') {
          toolResults.push(`${event.title}: ${event.detail}`)
        }
      },
      provider() {},
      preview() {},
      tool() {}
    }
  )
  expect(result).toBe('restricted run complete')
  expect(historyCalls).toBe(1)
  expect(await readFile(marker, 'utf8')).toBe(secret)
  expect(requestedTools.length).toBe(6)
  for (const tools of requestedTools) {
    expect(tools.sort()).toEqual(['artifact_read', 'chat_history', 'chat_send'])
  }
  for (const name of ['read', 'write', 'bash', 'codemode']) {
    expect(
      toolResults.some((result) => {
        return result.includes(`Tool ${name} not found`)
      })
    ).toBe(true)
  }
})

test('an unsupported execution backend fails configuration validation instead of enabling host execution', () => {
  expect(BotConfigSchema.parse({}).agent.execution.backend).toBe('disabled')
  expect(BotConfigSchema.safeParse({ agent: { execution: { backend: 'host' } } }).success).toBe(false)
})
