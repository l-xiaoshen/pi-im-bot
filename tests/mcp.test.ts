import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { z } from 'zod'
import { runPi } from '@pi-im-bot/agent/pi-runner'
import { BotConfigSchema } from '@pi-im-bot/config/schema'
import { RoomSchema } from '@pi-im-bot/contracts/message'
import { ProviderCatalog } from '@pi-im-bot/providers/catalog'
import { ProvidersConfigSchema } from '@pi-im-bot/providers/schema'
import { ResourceLibrary } from '@pi-im-bot/resources/library'
import { ResourcesConfigSchema } from '@pi-im-bot/resources/schema'
import { inspectMcp } from '@pi-im-bot/resources/mcp/client'
import { mcpCapabilityId, mcpToolName } from '@pi-im-bot/resources/mcp/identity'
import { ArtifactStore } from '@pi-im-bot/artifacts/store'
import { captureAuthority, assertCapability } from '@pi-im-bot/permissions/authorize'
import { agentInput, testFramework } from './agent-input'
import { responsesReply } from './responses-fixture'
import { mcpFixture } from './mcp-fixture'
import { Coordinator } from '@pi-im-bot/runtime/coordinator'
import { MemoryState } from './memory-state'
import { EventHub } from '@pi-im-bot/contracts/events'
import { ChannelRegistry } from '@pi-im-bot/channels/registry'
import { createMockAdapter } from '@pi-im-bot/channels/mock'
import { DeliveryService } from '@pi-im-bot/runtime/delivery'

test('HTTP MCP uses Pi discovery and execution, archives long outputs, and never exposes host paths or private metadata', async () => {
  const root = await mkdtemp('/tmp/pi-mcp-test-')
  const mcp = mcpFixture()
  const modelName = mcpToolName(mcp.config.id, 'long-result')
  let calls = 0
  let artifactId = ''
  const requests: string[] = []
  const model = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      requests.push(await request.text())
      calls += 1
      if (calls === 1) {
        return responsesReply({
          kind: 'tool',
          name: 'tool_search',
          arguments: { query: 'long-result', limit: 1 }
        })
      }
      if (calls === 2) {
        return responsesReply({ kind: 'tool', name: modelName, arguments: { query: 'report' } })
      }
      if (calls === 3) {
        artifactId = z
          .uuid()
          .parse(requests.at(-1)?.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/)?.[0])
        return responsesReply({
          kind: 'tool',
          name: 'tool_search',
          arguments: { query: 'artifact_read', limit: 1 }
        })
      }
      if (calls === 4) {
        return responsesReply({
          kind: 'tool',
          name: 'artifact_read',
          arguments: { id: artifactId, offset: 20000, limit: 8000 }
        })
      }
      return responsesReply({ kind: 'text', text: 'complete' })
    }
  })
  try {
    const manifest = await inspectMcp(mcp.config, new AbortController().signal)
    expect(mcp.state.calls).toBe(0)
    const library = new ResourceLibrary(ResourcesConfigSchema.parse({ mcp: [mcp.config] }), [manifest])
    const room = RoomSchema.parse({
      id: 'scope',
      name: 'Scope',
      address: { channel: 'mock', accountId: 'mock-bot', kind: 'group', chatId: 'scope' },
      mode: 'live',
      createdAt: 1,
      updatedAt: 1
    })
    const input = agentInput(room, 'Read the report')
    input.context.effective.settings.resources.toolExposure = 'deferred'
    input.context.authority = captureAuthority(
      input.context.effective,
      input.identities,
      undefined,
      library.capabilityIds(input.context.effective.settings)
    )
    const catalog = await ProviderCatalog.create(
      ProvidersConfigSchema.parse({
        defaultGroup: 'main',
        providers: [
          {
            id: 'test',
            baseUrl: `http://127.0.0.1:${model.port}/v1`,
            apiKey: 'test',
            models: [{ id: 'test' }]
          }
        ],
        groups: [{ id: 'main', candidates: [{ provider: 'test', model: 'test' }] }]
      }),
      root
    )
    const result = await runPi(
      {
        bot: BotConfigSchema.parse({}),
        catalog,
        framework: testFramework(),
        resources: library,
        dataDir: root,
        configDir: root,
        projectDir: root
      },
      room,
      input,
      new AbortController().signal,
      {
        authorize(id) {
          assertCapability(input.context.authority, input.context.effective.settings, id)
        },
        history() {
          return []
        },
        async send() {
          throw new Error('Unexpected send')
        }
      },
      {
        trace() {},
        provider() {},
        preview() {},
        tool() {}
      }
    )
    expect(result).toBe('complete')
    expect(mcp.state.calls).toBe(1)
    expect(
      mcp.state.headers.every((header) => {
        return header === '!this-is-literal'
      })
    ).toBe(true)
    expect(requests[0]).not.toContain(modelName)
    expect(requests[1]).toContain(modelName)
    expect(requests[2]).not.toContain('TAIL_EVIDENCE')
    expect(requests[4]).toContain('TAIL_EVIDENCE')
    expect(requests.join('\n')).not.toContain('PRIVATE_META_SENTINEL')
    expect(requests.join('\n')).not.toContain('CONTENT_META_SENTINEL')
    expect(requests.join('\n')).not.toContain('fixture-secret')
    expect(requests.join('\n')).not.toContain(root)
    await expect(new ArtifactStore(root, 'other-scope').readText(artifactId, 0, 100)).rejects.toThrow(
      '不存在'
    )
    await expect(
      new ArtifactStore(root, room.id).readText('../config/providers.json', 0, 100)
    ).rejects.toThrow()
    expect(input.context.authority.capabilities).toContain(mcpCapabilityId('reports', 'long-result'))
  } finally {
    await model.stop(true)
    await mcp.server.stop(true)
    await rm(root, { recursive: true, force: true })
  }
})

for (const scenario of ['revoked', 'changed', 'failed', 'timeout'] as const) {
  test(`MCP ${scenario} fails the tool without invoking a changed/revoked capability or replaying side effects`, async () => {
    const root = await mkdtemp('/tmp/pi-mcp-failure-')
    const mcp = mcpFixture()
    let providerCalls = 0
    let beforeTool = () => {}
    const model = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      async fetch() {
        providerCalls += 1
        if (providerCalls === 1) {
          beforeTool()
          return responsesReply({
            kind: 'tool',
            name: mcpToolName('reports', 'long-result'),
            arguments: { query: 'test' }
          })
        }
        return responsesReply({ kind: 'text', text: 'Handled the tool failure' })
      }
    })
    const store = new MemoryState()
    let coordinator: Coordinator | undefined
    try {
      const manifest = await inspectMcp(mcp.config, new AbortController().signal)
      const resources = new ResourceLibrary(ResourcesConfigSchema.parse({ mcp: [mcp.config] }), [manifest])
      const catalog = await ProviderCatalog.create(
        ProvidersConfigSchema.parse({
          defaultGroup: 'main',
          providers: [
            {
              id: 'test',
              baseUrl: `http://127.0.0.1:${model.port}/v1`,
              apiKey: 'test',
              models: [{ id: 'test' }]
            }
          ],
          groups: [{ id: 'main', candidates: [{ provider: 'test', model: 'test' }] }]
        }),
        root
      )
      const config = {
        bot: BotConfigSchema.parse({}),
        catalog,
        framework: testFramework(),
        resources,
        dataDir: root,
        configDir: root,
        projectDir: root
      }
      const channels = new ChannelRegistry()
      channels.register(createMockAdapter())
      const events = new EventHub()
      coordinator = new Coordinator(
        () => {
          return config
        },
        store,
        events,
        new DeliveryService(channels, store, events)
      )
      const room = coordinator.createMockRoom('test', 'group')
      store.saveRoom({ ...room, mode: 'live' })
      beforeTool = () => {
        if (scenario === 'revoked') {
          config.resources = new ResourceLibrary(
            ResourcesConfigSchema.parse({ mcp: [{ ...mcp.config, enabled: false }] }),
            [manifest]
          )
        }
        if (scenario === 'changed') {
          mcp.state.tools[0].inputSchema = {
            type: 'object',
            properties: { different: { type: 'number' } },
            required: ['different']
          }
        }
        if (scenario === 'failed') {
          mcp.state.fail = true
        }
        if (scenario === 'timeout') {
          mcp.state.wait = true
        }
      }
      const start = Date.now()
      const run = (await coordinator.receive(room.id, 'Call the report tool'))!
      for (let i = 0; i < 400; i++) {
        if (store.getRun(run.id)?.finishedAt) {
          break
        }
        await Bun.sleep(10)
      }
      expect(store.getRun(run.id)?.status).toBe('completed')
      expect(providerCalls).toBe(2)
      if (scenario === 'revoked' || scenario === 'changed') {
        expect(mcp.state.calls).toBe(0)
      } else {
        expect(mcp.state.calls).toBe(1)
      }
      if (scenario === 'timeout') {
        expect(Date.now() - start).toBeLessThan(3000)
      }
      expect(
        store.listTraces(room.id).some((trace) => {
          return trace.title.startsWith('失败 mcp__')
        })
      ).toBe(true)
    } finally {
      await coordinator?.shutdown()
      await model.stop(true)
      await mcp.server.stop(true)
      await rm(root, { recursive: true, force: true })
    }
  })
}
