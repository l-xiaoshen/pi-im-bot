import { expect, test } from 'bun:test'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { MemoryStorage } from '@earendil-works/pi-durable'
import { SessionManager, createCodingTools } from '@earendil-works/pi-coding-agent'
import { toToolDeclaration } from '@earendil-works/pi-ai'
import { DurableAgentRuntime } from '@pi-im-bot/agent/durable/runtime'
import { RoomSchema } from '@pi-im-bot/contracts/message'
import { BotConfigSchema } from '@pi-im-bot/config/schema'
import { ProviderCatalog } from '@pi-im-bot/providers/catalog'
import { ProvidersConfigSchema } from '@pi-im-bot/providers/schema'
import { agentInput, testFramework, testResources } from './agent-input'
import { responsesReply } from './responses-fixture'

test('durable imports legacy context without loading host tools, shares it across members and keeps request fallback local', async () => {
  const root = await mkdtemp('/tmp/pi-durable-run-')
  const runtime = await new DurableAgentRuntime().open(new MemoryStorage())
  const requests: string[] = []
  let primary = 0
  let backup = 0
  let sends = 0
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      const body = await request.text()
      requests.push(body)
      if (new URL(request.url).pathname.startsWith('/primary')) {
        primary += 1
        if (primary === 1) {
          return responsesReply({ kind: 'tool', name: 'read', arguments: { path: root + '/host-secret' } })
        }
        if (primary === 2) {
          return responsesReply({ kind: 'tool', name: 'chat_send', arguments: { text: 'one notification' } })
        }
        return new Response('unavailable', { status: 503 })
      }
      backup += 1
      return responsesReply({ kind: 'text', text: 'backup answer' })
    }
  })
  try {
    const room = RoomSchema.parse({
      id: 'scope',
      name: 'Scope',
      address: { channel: 'mock', accountId: 'mock-bot', kind: 'group', chatId: 'scope' },
      mode: 'live',
      createdAt: 1,
      updatedAt: 1
    })
    const input = agentInput(room, 'Alice new request')
    const workspace = join(
      root,
      'workspaces',
      createHash('sha256').update(room.id).digest('hex').slice(0, 24)
    )
    const sessionDir = join(
      root,
      'pi-sessions',
      createHash('sha256')
        .update(input.context.sessionKey + ':live')
        .digest('hex')
        .slice(0, 24)
    )
    await mkdir(workspace, { recursive: true })
    await mkdir(sessionDir, { recursive: true })
    await Bun.write(root + '/host-secret', 'HOST_SECRET_SENTINEL')
    const legacy = SessionManager.create(workspace, sessionDir)
    legacy.appendMessage({
      role: 'system',
      content: 'Old host tools',
      toolsAdded: createCodingTools(workspace).map(toToolDeclaration),
      timestamp: Date.now()
    })
    legacy.appendMessage({ role: 'user', content: 'LEGACY_SHARED_FACT', timestamp: Date.now() })
    const catalog = await ProviderCatalog.create(
      ProvidersConfigSchema.parse({
        defaultGroup: 'main',
        providers: [
          {
            id: 'primary',
            baseUrl: `http://127.0.0.1:${server.port}/primary/v1`,
            apiKey: 'test',
            models: [{ id: 'test' }]
          },
          {
            id: 'backup',
            baseUrl: `http://127.0.0.1:${server.port}/backup/v1`,
            apiKey: 'test',
            models: [{ id: 'test' }]
          }
        ],
        groups: [
          {
            id: 'main',
            candidates: [
              { provider: 'primary', model: 'test' },
              { provider: 'backup', model: 'test' }
            ]
          }
        ]
      }),
      root
    )
    const config = {
      bot: BotConfigSchema.parse({}),
      catalog,
      framework: testFramework(),
      resources: testResources(),
      dataDir: root,
      configDir: root,
      projectDir: root
    }
    const services = {
      authorize() {},
      history() {
        return []
      },
      async send(text: string) {
        sends += 1
        return {
          id: 'sent',
          roomId: room.id,
          role: 'assistant' as const,
          actorId: 'bot',
          actorName: 'Pi',
          text,
          attachments: [],
          platformMessageIds: [],
          createdAt: Date.now(),
          recalled: false
        }
      }
    }
    const trace: string[] = []
    const callbacks = {
      trace(event: { title: string; detail: string }) {
        trace.push(event.title + event.detail)
      },
      provider() {},
      preview() {},
      tool() {}
    }
    expect(
      await runtime.run('first', config, room, input, new AbortController().signal, services, callbacks)
    ).toBe('backup answer')
    expect(primary).toBe(3)
    expect(backup).toBe(1)
    expect(sends).toBe(1)
    expect(requests[0]).toContain('LEGACY_SHARED_FACT')
    expect(requests.join('\n')).not.toContain('HOST_SECRET_SENTINEL')
    expect(
      trace.some((line) => {
        return line.startsWith('失败 read')
      })
    ).toBe(true)
    const next = agentInput(room, 'Bob follow-up')
    next.actorId = 'bob'
    next.actorName = 'Bob'
    expect(
      await runtime.run('second', config, room, next, new AbortController().signal, services, callbacks)
    ).toBe('backup answer')
    expect(requests.at(-1)).toContain('LEGACY_SHARED_FACT')
    expect(requests.at(-1)).toContain('Alice new request')
    expect(requests.at(-1)).toContain('Bob follow-up')
    const before = requests.length
    expect(
      await runtime.run('second', config, room, next, new AbortController().signal, services, callbacks)
    ).toBe('backup answer')
    expect(requests).toHaveLength(before)
    for (const raw of requests) {
      const tools = z
        .object({ tools: z.array(z.object({ name: z.string() })).default([]) })
        .parse(JSON.parse(raw))
        .tools.map((tool) => {
          return tool.name
        })
      expect(tools).not.toContain('read')
      expect(tools).not.toContain('bash')
    }
  } finally {
    await runtime.close()
    await server.stop(true)
    await rm(root, { recursive: true, force: true })
  }
})
