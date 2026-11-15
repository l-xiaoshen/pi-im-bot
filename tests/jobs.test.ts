import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { z } from 'zod'
import { MemoryStorage } from '@earendil-works/pi-durable'
import { DurableAgentRuntime } from '@pi-im-bot/agent/durable/runtime'
import { Coordinator } from '@pi-im-bot/runtime/coordinator'
import { EventHub } from '@pi-im-bot/contracts/events'
import { ChannelRegistry } from '@pi-im-bot/channels/registry'
import { createMockAdapter } from '@pi-im-bot/channels/mock'
import { DeliveryService } from '@pi-im-bot/runtime/delivery'
import { BotConfigSchema } from '@pi-im-bot/config/schema'
import { ProvidersConfigSchema } from '@pi-im-bot/providers/schema'
import { ProviderCatalog } from '@pi-im-bot/providers/catalog'
import { JobService } from '@pi-im-bot/jobs/service'
import { ResourceLibrary } from '@pi-im-bot/resources/library'
import { ResourcesConfigSchema } from '@pi-im-bot/resources/schema'
import { inspectMcp } from '@pi-im-bot/resources/mcp/client'
import { mcpToolName } from '@pi-im-bot/resources/mcp/identity'
import { MemoryState } from './memory-state'
import { testFramework } from './agent-input'
import { responsesReply } from './responses-fixture'
import { ArtifactStore } from '@pi-im-bot/artifacts/store'
import { mcpFixture } from './mcp-fixture'
import { createFakeShipyard } from './shipyard-fixture'

const RequestSchema = z.object({
  input: z.array(z.object({ role: z.string().optional(), content: z.unknown().optional() }).passthrough())
})
async function until(check: () => boolean | Promise<boolean>, label: string) {
  for (let i = 0; i < 400; i++) {
    if (await check()) {
      return
    }
    await Bun.sleep(10)
  }
  throw new Error(label)
}

test('background agent keeps its own context while another member uses the shared root; only its compact result returns', async () => {
  const root = await mkdtemp('/tmp/pi-jobs-')
  const mcp = mcpFixture()
  let release: (() => void) | undefined
  const slow = new Promise<void>((resolve) => {
    release = resolve
  })
  let launch = 0
  let child = 0
  let childWaiting = false
  let active = 0
  let peak = 0
  const rootRequests: string[] = []
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      const raw = await request.text()
      const body = RequestSchema.parse(JSON.parse(raw))
      const user = JSON.stringify(
        body.input.findLast((item) => {
          return item.role === 'user'
        })?.content
      )
      active += 1
      peak = Math.max(peak, active)
      try {
        if (user.includes('slow-research')) {
          child += 1
          if (child === 1) {
            return responsesReply({
              kind: 'tool',
              name: mcpToolName('reports', 'long-result'),
              arguments: { query: 'private background research' }
            })
          }
          childWaiting = true
          await slow
          return responsesReply({ kind: 'text', text: 'PUBLIC_RESEARCH_SUMMARY' })
        }
        rootRequests.push(raw)
        if (user.includes('launch-work')) {
          launch += 1
          if (launch === 1) {
            return responsesReply({
              kind: 'tool',
              name: 'delegate_task',
              arguments: { title: 'Research', prompt: 'slow-research' }
            })
          }
          return responsesReply({ kind: 'text', text: 'Background accepted' })
        }
        return responsesReply({ kind: 'text', text: 'Fast shared answer' })
      } finally {
        active -= 1
      }
    }
  })
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
            baseUrl: `http://127.0.0.1:${server.port}/v1`,
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
    config.framework.defaults.behavior.batchQuietMs = 0
    const store = new MemoryState()
    const events = new EventHub()
    const channels = new ChannelRegistry()
    channels.register(createMockAdapter())
    coordinator = new Coordinator(
      () => {
        return config
      },
      store,
      events,
      new DeliveryService(channels, store, events, (roomId) => {
        return new ArtifactStore(root, roomId)
      })
    )
    const runtime = new DurableAgentRuntime()
    coordinator.attachDurable(runtime)
    const jobs = new JobService(runtime, coordinator)
    coordinator.attachJobs(jobs)
    await runtime.open(new MemoryStorage())
    const room = coordinator.createMockRoom('group', 'group')
    store.saveRoom({ ...room, mode: 'live' })
    const first = (await coordinator.receive(room.id, 'launch-work', 'alice', 'Alice'))!
    await until(() => {
      return store.getRun(first.id)?.status === 'completed' && childWaiting
    }, 'Root did not release the background child')
    const second = (await coordinator.receive(room.id, 'fast-question', 'bob', 'Bob'))!
    await until(() => {
      return store.getRun(second.id)?.status === 'completed'
    }, 'Fast question blocked behind child')
    const pending = (await jobs.repository.list(room.id))[0]
    expect(pending.state).toBe('running')
    expect(peak).toBe(2)
    expect(
      store.listMessages(room.id).some((message) => {
        return message.text === 'Fast shared answer'
      })
    ).toBe(true)
    release!()
    await until(async () => {
      return (await jobs.repository.list(room.id))[0].delivery === 'sent'
    }, 'Background result not delivered')
    const third = (await coordinator.receive(room.id, 'follow-up', 'bob', 'Bob'))!
    await until(() => {
      return store.getRun(third.id)?.status === 'completed'
    }, 'Follow-up failed')
    expect(rootRequests.at(-1)).toContain('PUBLIC_RESEARCH_SUMMARY')
    expect(rootRequests.join('\n')).not.toContain('report-body-report-body')
    expect(
      store.listMessages(room.id).filter((message) => {
        return message.text.includes('PUBLIC_RESEARCH_SUMMARY')
      })
    ).toHaveLength(1)
    const saved = await jobs.repository.get(pending.id, room.id)
    expect(saved.revisions['1'].context.authority.identities[0].actorId).toBe('alice')
    expect(store.getRoom(room.id)?.currentConversationId).toBe(first.context?.rootConversationId)
  } finally {
    release?.()
    await coordinator?.shutdown()
    await server.stop(true)
    await mcp.server.stop(true)
    await rm(root, { recursive: true, force: true })
  }
})

test('cancelling a background shell job stops only its sandbox and leaves root files usable', async () => {
  const root = await mkdtemp('/tmp/pi-job-cancel-')
  const bay = createFakeShipyard()
  let launch = 0
  let write = 0
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      const body = RequestSchema.parse(await request.json())
      const user = JSON.stringify(
        body.input.findLast((item) => {
          return item.role === 'user'
        })?.content
      )
      if (user.includes('launch-shell')) {
        launch += 1
        if (launch === 1) {
          return responsesReply({
            kind: 'tool',
            name: 'start_job',
            arguments: { title: 'Slow shell', capability: 'bash', arguments: { command: 'wait-for-cancel' } }
          })
        }
        return responsesReply({ kind: 'text', text: 'Shell accepted' })
      }
      write += 1
      if (write === 1) {
        return responsesReply({
          kind: 'tool',
          name: 'write',
          arguments: { path: '/workspace/root.txt', content: 'root-preserved' }
        })
      }
      if (write === 3) {
        return responsesReply({ kind: 'tool', name: 'read', arguments: { path: '/workspace/root.txt' } })
      }
      return responsesReply({ kind: 'text', text: 'Root is available' })
    }
  })
  let coordinator: Coordinator | undefined
  try {
    const catalog = await ProviderCatalog.create(
      ProvidersConfigSchema.parse({
        defaultGroup: 'main',
        providers: [
          {
            id: 'test',
            baseUrl: `http://127.0.0.1:${server.port}/v1`,
            apiKey: 'test',
            models: [{ id: 'test' }]
          }
        ],
        groups: [{ id: 'main', candidates: [{ provider: 'test', model: 'test' }] }]
      }),
      root
    )
    const config = {
      bot: BotConfigSchema.parse({
        agent: { execution: { backend: 'shipyard', endpoint: bay.endpoint, apiKey: 'test-bay-key' } }
      }),
      catalog,
      framework: testFramework(),
      resources: ResourceLibrary.empty(),
      dataDir: root,
      configDir: root,
      projectDir: root
    }
    config.framework.defaults.behavior.batchQuietMs = 0
    const store = new MemoryState()
    const events = new EventHub()
    const channels = new ChannelRegistry()
    channels.register(createMockAdapter())
    coordinator = new Coordinator(
      () => {
        return config
      },
      store,
      events,
      new DeliveryService(channels, store, events, (roomId) => {
        return new ArtifactStore(root, roomId)
      })
    )
    const runtime = new DurableAgentRuntime()
    coordinator.attachDurable(runtime)
    const jobs = new JobService(runtime, coordinator)
    coordinator.attachJobs(jobs)
    await runtime.open(new MemoryStorage())
    const room = coordinator.createMockRoom('group', 'group')
    store.saveRoom({ ...room, mode: 'live' })
    await coordinator.receive(room.id, 'launch-shell')
    await bay.shellStarted
    const run = (await coordinator.receive(room.id, 'write-root', 'bob', 'Bob'))!
    await until(() => {
      return store.getRun(run.id)?.status === 'completed'
    }, 'Root blocked by shell')
    const job = (await jobs.repository.list(room.id))[0]
    await jobs.cancel(job.id, room.id)
    await until(async () => {
      return (await jobs.repository.list(room.id))[0].state === 'outcome_unknown'
    }, 'Cancellation did not settle')
    expect(bay.creations).toBe(2)
    expect(bay.stops).toBe(1)
    const check = (await coordinator.receive(room.id, 'read-root'))!
    await until(() => {
      return store.getRun(check.id)?.status === 'completed'
    }, 'Root sandbox was affected')
    expect(
      [...bay.files.values()].some((files) => {
        return files.get('/workspace/root.txt')?.toString() === 'root-preserved'
      })
    ).toBe(true)
  } finally {
    await coordinator?.shutdown()
    await server.stop(true)
    await bay.close()
    await rm(root, { recursive: true, force: true })
  }
})
