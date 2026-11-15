import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { BotConfigSchema } from '@pi-im-bot/config/schema'
import { ProviderCatalog } from '@pi-im-bot/providers/catalog'
import { ProvidersConfigSchema } from '@pi-im-bot/providers/schema'
import { Coordinator } from '@pi-im-bot/runtime/coordinator'
import { DeliveryService } from '@pi-im-bot/runtime/delivery'
import { EventHub } from '@pi-im-bot/contracts/events'
import { ChannelRegistry } from '@pi-im-bot/channels/registry'
import { createMockAdapter } from '@pi-im-bot/channels/mock'
import { OneBotAdapter } from '@pi-im-bot/channels/onebot/adapter'
import { OneBotConfigSchema } from '@pi-im-bot/channels/onebot/config'
import { tokenRevision } from '@pi-im-bot/channels/onebot/auth'
import { MemoryState } from './memory-state'
import { testFramework, testResources } from './agent-input'

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) {
    await close()
  }
})

async function fixture() {
  const root = await mkdtemp('/tmp/pi-inbound-admission-')
  const config = {
    bot: BotConfigSchema.parse({ agent: { maxQueuedRuns: 1 } }),
    catalog: await ProviderCatalog.create(
      ProvidersConfigSchema.parse({
        defaultGroup: 'main',
        providers: [],
        groups: [{ id: 'main', candidates: [] }]
      }),
      root
    ),
    framework: testFramework(),
    resources: testResources(),
    dataDir: root,
    projectDir: root,
    configDir: root
  }
  const store = new MemoryState()
  const channels = new ChannelRegistry()
  channels.register(createMockAdapter())
  function open() {
    const events = new EventHub()
    const coordinator = new Coordinator(
      () => {
        return config
      },
      store,
      events,
      new DeliveryService(channels, store, events)
    )
    cleanup.push(async () => {
      await coordinator.shutdown()
    })
    return coordinator
  }
  cleanup.push(async () => {
    await rm(root, { recursive: true, force: true })
  })
  const coordinator = open()
  const room = coordinator.createMockRoom('inbound', 'group')
  function incoming(externalId: string, text = '/review respond') {
    return {
      address: room.address,
      externalId,
      actorId: 'member',
      actorName: 'Member',
      text,
      attachments: [],
      receivedAt: Date.now()
    }
  }
  return { config, store, channels, coordinator, room, incoming, open }
}

test('queue rejection keeps the archived input retryable and concurrent retries admit exactly one run', async () => {
  const env = await fixture()
  await env.coordinator.receive(env.room.id, 'fill batching slot')
  const message = env.incoming('retry')
  await expect(env.coordinator.receiveIncoming(env.room.id, message, message.text)).rejects.toThrow(
    '队列已满'
  )
  expect(env.store.findPlatformMessage(env.room.id, 'retry')?.inbound?.state).toBe('pending')
  env.config.bot.agent.maxQueuedRuns = 2
  const results = await Promise.all([
    env.coordinator.receiveIncoming(env.room.id, message, message.text),
    env.coordinator.receiveIncoming(env.room.id, message, message.text)
  ])
  expect(results.sort()).toEqual(['agent', 'duplicate'])
  const archived = env.store.findPlatformMessage(env.room.id, 'retry')!
  expect(archived.inbound).toEqual({ state: 'accepted', outcome: 'agent' })
  expect(
    env.store.listRuns().filter((run) => {
      return run.input?.identities.some((identity) => {
        return identity.messageIds.includes(archived.id)
      })
    })
  ).toHaveLength(1)
})

test('recovery accepts an archived input after a failure before atomic run admission', async () => {
  const env = await fixture()
  const save = env.store.saveRunAdmission.bind(env.store)
  env.store.saveRunAdmission = () => {
    throw new Error('authored pre-commit crash')
  }
  const message = env.incoming('crash')
  await expect(env.coordinator.receiveIncoming(env.room.id, message, message.text)).rejects.toThrow(
    'pre-commit'
  )
  expect(env.store.listRuns()).toHaveLength(0)
  env.store.saveRunAdmission = save
  const restored = env.open()
  restored.resumeRecovery()
  await Bun.sleep(10)
  expect(env.store.findPlatformMessage(env.room.id, 'crash')?.inbound?.state).toBe('accepted')
  expect(env.store.listRuns()).toHaveLength(1)
})

test('a direct command with an uncertain delivery is never executed again on duplicate or recovery', async () => {
  const env = await fixture()
  env.channels.register({
    ...createMockAdapter(),
    async send() {
      throw new Error('authored delivery failure')
    }
  })
  const message = env.incoming('new', '/new')
  await expect(env.coordinator.receiveIncoming(env.room.id, message, message.text)).rejects.toThrow('回执')
  expect(env.store.listConversations(env.room.id)).toHaveLength(2)
  expect(await env.coordinator.receiveIncoming(env.room.id, message, message.text)).toBe('uncertain')
  const archived = env.store.findPlatformMessage(env.room.id, 'new')!
  expect(archived.inbound?.state).toBe('unknown')
  // A process exit between dispatch claim and effect is also conservative.
  env.store.saveMessage({
    ...archived,
    inbound: {
      state: 'dispatching',
      control: true,
      prompt: '/new',
      epoch: 0,
      expiresAt: Date.now() + 10000,
      identity: {
        origin: 'platform',
        actorId: 'member',
        actorName: 'Member',
        channel: 'mock',
        accountId: 'mock-bot',
        messageIds: [archived.id]
      }
    }
  })
  env.open().resumeRecovery()
  await Bun.sleep(10)
  expect(env.store.getMessage(archived.id)?.inbound?.state).toBe('unknown')
  expect(env.store.listConversations(env.room.id)).toHaveLength(2)
})

test('pending admission is bounded and expired inputs are retained without execution', async () => {
  const env = await fixture()
  await env.coordinator.receive(env.room.id, 'fill batching slot')
  const message = env.incoming('pending')
  await expect(env.coordinator.receiveIncoming(env.room.id, message, message.text)).rejects.toThrow(
    '队列已满'
  )
  const overflow = env.incoming('overflow')
  await expect(env.coordinator.receiveIncoming(env.room.id, overflow, overflow.text)).rejects.toThrow(
    '受理队列已满'
  )
  expect(env.store.findPlatformMessage(env.room.id, 'overflow')).toBeUndefined()
  const pending = env.store.findPlatformMessage(env.room.id, 'pending')!
  if (pending.inbound?.state !== 'pending') {
    throw new Error('expected pending')
  }
  env.store.saveMessage({ ...pending, inbound: { ...pending.inbound, expiresAt: Date.now() - 1 } })
  expect(await env.coordinator.receiveIncoming(env.room.id, message, message.text)).toBe('recorded')
  expect(env.store.getMessage(pending.id)?.inbound?.state).toBe('expired')
  expect(env.store.getMessage(pending.id)?.runId).toBeUndefined()
})

test('OneBot releases failed receives so the platform can retry', async () => {
  const config = OneBotConfigSchema.parse({
    enabled: true,
    targets: [{ selfId: '11', chatId: '33', name: 'fixture', enabled: true }]
  })
  let attempts = 0
  const adapter = new OneBotAdapter(
    () => {
      return config
    },
    new EventHub(),
    async () => {
      attempts += 1
      if (attempts === 1) {
        throw new Error('authored rejection')
      }
      return 'agent'
    }
  )
  const socket = {
    send() {
      return 0
    },
    close() {}
  }
  adapter.connect('11', socket, tokenRevision(''))
  const event = JSON.stringify({
    post_type: 'message',
    message_type: 'group',
    self_id: 11,
    user_id: 22,
    group_id: 33,
    message_id: 44,
    message: [{ type: 'text', data: { text: '!pi hello' } }]
  })
  await expect(adapter.message('11', event, socket)).rejects.toThrow('authored rejection')
  await adapter.message('11', event, socket)
  await adapter.message('11', event, socket)
  expect(attempts).toBe(2)
})
