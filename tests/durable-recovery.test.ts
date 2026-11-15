import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import { openNodeJsonlStorage } from '@earendil-works/pi-durable/storage/jsonl/node'
import { DurableAgentRuntime } from '@pi-im-bot/agent/durable/runtime'
import { Coordinator } from '@pi-im-bot/runtime/coordinator'
import { EventHub } from '@pi-im-bot/contracts/events'
import { ChannelRegistry } from '@pi-im-bot/channels/registry'
import { createMockAdapter } from '@pi-im-bot/channels/mock'
import { DeliveryService } from '@pi-im-bot/runtime/delivery'
import { BotConfigSchema } from '@pi-im-bot/config/schema'
import { ProvidersConfigSchema } from '@pi-im-bot/providers/schema'
import { ProviderCatalog } from '@pi-im-bot/providers/catalog'
import { MemoryState } from './memory-state'
import { testFramework, testResources } from './agent-input'
import { responsesReply } from './responses-fixture'

test('host shutdown resumes an admitted durable run with its pinned Persona and never repeats a completed send tool', async () => {
  const root = await mkdtemp('/tmp/pi-durable-recovery-')
  const store = new MemoryState()
  let calls = 0
  const requests: string[] = []
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      requests.push(await request.text())
      calls += 1
      if (calls === 1) {
        return responsesReply({ kind: 'tool', name: 'chat_send', arguments: { text: 'already sent once' } })
      }
      if (calls === 2) {
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode(': pending\n\n'))
            }
          }),
          { headers: { 'content-type': 'text/event-stream' } }
        )
      }
      return responsesReply({ kind: 'text', text: 'resumed answer' })
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
      bot: BotConfigSchema.parse({}),
      catalog,
      framework: testFramework(),
      resources: testResources(),
      dataDir: root,
      configDir: root,
      projectDir: root
    }
    config.framework.personas[0].prompt = 'PINNED_PERSONA'
    async function open() {
      const events = new EventHub()
      const channels = new ChannelRegistry()
      channels.register(createMockAdapter())
      const coordinator = new Coordinator(
        () => {
          return config
        },
        store,
        events,
        new DeliveryService(channels, store, events)
      )
      const runtime = new DurableAgentRuntime()
      coordinator.attachDurable(runtime)
      await coordinator.prepareRecovery()
      await runtime.open(await openNodeJsonlStorage(join(root, 'journal'), BACKGROUND_CONTEXT))
      coordinator.resumeRecovery()
      return coordinator
    }
    coordinator = await open()
    const room = coordinator.createMockRoom('recovery', 'group')
    store.saveRoom({ ...room, mode: 'live' })
    const run = (await coordinator.receive(room.id, 'Continue this task'))!
    for (let i = 0; i < 300 && calls < 2; i++) {
      await Bun.sleep(10)
    }
    expect(calls).toBe(2)
    expect(
      store.listMessages(room.id).filter((message) => {
        return message.text === 'already sent once'
      })
    ).toHaveLength(1)
    await coordinator.shutdown()
    expect(store.getRun(run.id)?.status).toBe('interrupted')
    config.framework.personas[0].prompt = 'NEW_PERSONA_FOR_NEW_REQUESTS'
    coordinator = await open()
    for (let i = 0; i < 300; i++) {
      if (store.getRun(run.id)?.status === 'completed' || store.getRun(run.id)?.status === 'failed') {
        break
      }
      await Bun.sleep(10)
    }
    expect(store.getRun(run.id)?.status).toBe('completed')
    expect(store.getRun(run.id)?.error).toBeUndefined()
    expect(calls).toBe(3)
    expect(requests[2]).toContain('PINNED_PERSONA')
    expect(requests[2]).not.toContain('NEW_PERSONA_FOR_NEW_REQUESTS')
    expect(
      store.listMessages(room.id).filter((message) => {
        return message.text === 'already sent once'
      })
    ).toHaveLength(1)
    expect(
      store.listMessages(room.id).filter((message) => {
        return message.text === 'resumed answer'
      })
    ).toHaveLength(1)
    expect(store.getRun(run.id)?.modelCalls).toBe(3)
  } finally {
    await coordinator?.shutdown()
    await server.stop(true)
    await rm(root, { recursive: true, force: true })
  }
})
