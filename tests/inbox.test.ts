import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
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
import { MemoryState } from './memory-state'
import { testFramework, testResources } from './agent-input'
import { responsesReply } from './responses-fixture'

async function fixture() {
  const root = await mkdtemp('/tmp/pi-inbox-')
  const requests: Array<{ at: number; body: string }> = []
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      requests.push({ at: Date.now(), body: await request.text() })
      return responsesReply({ kind: 'text', text: 'batch answer' })
    }
  })
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
  Object.assign(config.framework.defaults.behavior, {
    batchQuietMs: 50,
    batchMaxHoldMs: 80,
    batchMaxRequests: 3,
    batchMaxChars: 1000
  })
  const store = new MemoryState()
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
  coordinator.attachDurable(await new DurableAgentRuntime().open(new MemoryStorage()))
  const room = coordinator.createMockRoom('group', 'group')
  store.saveRoom({ ...room, mode: 'live' })
  return {
    config,
    store,
    coordinator,
    room,
    requests,
    async close() {
      await coordinator.shutdown()
      await server.stop(true)
      await rm(root, { recursive: true, force: true })
    }
  }
}

test('one shared batch retains speakers and message links, intersects privileges, and stop bypasses the window', async () => {
  const env = await fixture()
  try {
    env.config.framework.defaults.permissions = {
      default: 'deny',
      rules: [
        { effect: 'allow', capabilities: ['chat_history', 'command:stop'], subjects: [{ kind: 'everyone' }] },
        {
          effect: 'allow',
          capabilities: ['chat_send'],
          subjects: [{ kind: 'platform-user', channel: 'mock', accountId: 'mock-bot', actorId: 'admin' }]
        }
      ]
    }
    for (const actor of ['admin', 'member-b', 'member-c']) {
      await env.coordinator.receiveIncoming(
        env.room.id,
        {
          address: env.room.address,
          actorId: actor,
          actorName: actor,
          externalId: actor,
          text: actor + ' question',
          attachments: [],
          receivedAt: Date.now()
        },
        actor + ' question'
      )
    }
    for (let i = 0; i < 100 && !env.store.listRuns()[0]?.finishedAt; i++) {
      await Bun.sleep(10)
    }
    const run = env.store.listRuns()[0]
    expect(env.store.listRuns()).toHaveLength(1)
    expect(env.requests).toHaveLength(1)
    expect(run.input?.parts).toHaveLength(3)
    expect(run.context?.authority.capabilities).not.toContain('chat_send')
    for (const actor of ['admin', 'member-b', 'member-c']) {
      expect(env.requests[0].body).toContain(actor + ' question')
    }
    expect(
      env.store.listMessages(env.room.id).filter((message) => {
        return message.role === 'user' && message.runId === run.id
      })
    ).toHaveLength(3)
    const queued = (await env.coordinator.receive(env.room.id, 'cancel this batch'))!
    await env.coordinator.receive(env.room.id, '/stop')
    await Bun.sleep(100)
    expect(env.store.getRun(queued.id)?.status).toBe('cancelled')
    expect(env.requests).toHaveLength(1)
  } finally {
    await env.close()
  }
})

test('continuous arrivals cannot extend a batch past its hold bound and a configuration change starts a separate batch', async () => {
  const env = await fixture()
  try {
    env.config.framework.defaults.behavior.batchMaxRequests = 20
    const start = Date.now()
    for (let i = 0; i < 6; i++) {
      await env.coordinator.receive(env.room.id, 'question-' + i, 'member-' + i, 'Member ' + i)
      await Bun.sleep(30)
    }
    expect(env.requests[0].at - start).toBeLessThan(140)
    for (
      let i = 0;
      i < 100 &&
      env.store.listRuns().some((run) => {
        return !run.finishedAt
      });
      i++
    ) {
      await Bun.sleep(10)
    }
    const first = (await env.coordinator.receive(env.room.id, 'before config change'))!
    env.config.framework.defaults.preferences.replyStyle = 'new style'
    const second = (await env.coordinator.receive(env.room.id, 'after config change'))!
    expect(second.id).not.toBe(first.id)
    for (let i = 0; i < 100 && !env.store.getRun(second.id)?.finishedAt; i++) {
      await Bun.sleep(10)
    }
    expect(env.store.getRun(first.id)?.context?.effective.settings.preferences.replyStyle).toBe('')
    expect(env.store.getRun(second.id)?.context?.effective.settings.preferences.replyStyle).toBe('new style')
  } finally {
    await env.close()
  }
})
