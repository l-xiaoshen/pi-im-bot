import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { BotConfigSchema } from '@pi-im-bot/config/schema'
import { ProvidersConfigSchema } from '@pi-im-bot/providers/schema'
import { ProviderCatalog } from '@pi-im-bot/providers/catalog'
import { EventHub } from '@pi-im-bot/contracts/events'
import { Coordinator } from '@pi-im-bot/runtime/coordinator'
import { ChannelRegistry } from '@pi-im-bot/channels/registry'
import { createMockAdapter } from '@pi-im-bot/channels/mock'
import { DeliveryService } from '@pi-im-bot/runtime/delivery'
import { MemoryState } from './memory-state'
import { responsesReply } from './responses-fixture'
import { initialFramework, resolveSettings } from '@pi-im-bot/settings/resolve'
import { captureAuthority, assertCapability } from '@pi-im-bot/permissions/authorize'
import { localIdentity, type TriggerIdentity } from '@pi-im-bot/permissions/identity'
import { migrateRoom } from '@pi-im-bot/conversations/migration'
import { projectHistory, projectOutput } from '@pi-im-bot/messages/projection'
import { SettingsPatchSchema } from '@pi-im-bot/settings/schema'
import { testResources } from './agent-input'
import { DurableAgentRuntime } from '@pi-im-bot/agent/durable/runtime'
import { MemoryStorage } from '@earendil-works/pi-durable'

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) {
    await close()
  }
})

async function fixture(reply: (body: string, index: number) => Response) {
  const root = await mkdtemp('/tmp/pi-framework-test-')
  cleanup.push(async () => {
    await rm(root, { recursive: true, force: true })
  })
  const requests: string[] = []
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      const body = await request.text()
      requests.push(body)
      return reply(body, requests.length)
    }
  })
  cleanup.push(async () => {
    await server.stop(true)
  })
  const bot = BotConfigSchema.parse({})
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
    bot,
    catalog,
    framework: initialFramework(bot, 'main'),
    resources: testResources(),
    dataDir: root,
    configDir: root,
    projectDir: root
  }
  const state = new MemoryState()
  const events = new EventHub()
  const channels = new ChannelRegistry()
  channels.register(createMockAdapter())
  const delivery = new DeliveryService(channels, state, events)
  const coordinator = new Coordinator(
    () => {
      return config
    },
    state,
    events,
    delivery
  )
  coordinator.attachDurable(await new DurableAgentRuntime().open(new MemoryStorage()))
  cleanup.push(async () => {
    await coordinator.shutdown()
  })
  let room = coordinator.createMockRoom('共享测试群', 'group')
  state.saveRoom({ ...room, mode: 'live' })
  room = coordinator.requireRoom(room.id)
  async function wait(id: string) {
    for (let i = 0; i < 500; i++) {
      const run = state.getRun(id)!
      if (!['batching', 'queued', 'running'].includes(run.status)) {
        return run
      }
      await Bun.sleep(10)
    }
    throw new Error('Run did not settle')
  }
  return { root, requests, state, config, coordinator, room, wait }
}

test('members share one Pi history and Persona; /new and switching only change the shared pointer', async () => {
  const env = await fixture((_body, index) => {
    return responsesReply({ kind: 'text', text: `  answer-${index}  ` })
  })
  env.config.framework.personas[0].prompt = 'SHARED_PERSONA_V1'
  const first = (await env.coordinator.receive(env.room.id, 'Alice shared fact', 'a', 'Alice'))!
  expect((await env.wait(first.id)).status).toBe('completed')
  env.config.framework.personas[0].prompt = 'SHARED_PERSONA_V2'
  const second = (await env.coordinator.receive(env.room.id, 'Bob follows up', 'b', 'Bob'))!
  expect((await env.wait(second.id)).status).toBe('completed')
  expect(first.context?.conversationId).toBe(second.context?.conversationId)
  expect(first.context?.authority.identities[0].actorId).toBe('a')
  expect(second.context?.authority.identities[0].actorId).toBe('b')
  expect(first.context?.effective.persona.prompt).toBe('SHARED_PERSONA_V1')
  expect(second.context?.effective.persona.prompt).toBe('SHARED_PERSONA_V2')
  expect(env.requests[1]).toContain('Alice shared fact')
  expect(env.requests[1]).toContain('Bob follows up')
  expect(env.requests[1]).toContain('SHARED_PERSONA_V2')
  expect(env.state.listMessages(env.room.id).at(-1)?.text).toBe('answer-2')
  expect(env.state.getRun(second.id)?.rawReply).toBe('  answer-2  ')
  const previousId = second.context!.conversationId
  await env.coordinator.receive(env.room.id, '/new', 'b', 'Bob')
  const third = (await env.coordinator.receive(env.room.id, 'Fresh shared context', 'a', 'Alice'))!
  expect((await env.wait(third.id)).status).toBe('completed')
  expect(third.context?.conversationId).not.toBe(previousId)
  expect(env.requests[2]).not.toContain('Alice shared fact')
  env.coordinator.switchConversation(env.room.id, previousId)
  const fourth = (await env.coordinator.receive(env.room.id, 'Continue old context', 'b', 'Bob'))!
  expect((await env.wait(fourth.id)).status).toBe('completed')
  expect(env.requests[3]).toContain('Alice shared fact')
  expect(env.requests[3]).not.toContain('Fresh shared context')
  expect(env.state.listConversations(env.room.id)).toHaveLength(2)
})

test('tool privilege from one member is not restored for the next member, and live revocation blocks execution', async () => {
  let revoke: (() => void) | undefined
  const env = await fixture((_body, index) => {
    if (index % 2 === 1) {
      revoke?.()
      return responsesReply({
        kind: 'tool',
        name: 'chat_send',
        arguments: { text: 'privileged notification' }
      })
    }
    return responsesReply({ kind: 'text', text: 'done' })
  })
  env.config.framework.defaults.permissions = {
    default: 'deny',
    rules: [
      {
        effect: 'allow',
        capabilities: ['chat_send'],
        subjects: [{ kind: 'platform-user', channel: 'mock', accountId: 'mock-bot', actorId: 'admin' }]
      }
    ]
  }
  async function trigger(actorId: string) {
    await env.coordinator.receiveIncoming(
      env.room.id,
      {
        address: env.room.address,
        externalId: crypto.randomUUID(),
        actorId,
        actorName: actorId,
        text: 'run',
        attachments: [],
        receivedAt: Date.now()
      },
      'run'
    )
    const run = env.state.listRuns().at(-1)!
    return env.wait(run.id)
  }
  expect((await trigger('admin')).status).toBe('completed')
  expect((await trigger('member')).status).toBe('completed')
  expect(
    env.state.listMessages(env.room.id).filter((message) => {
      return message.text === 'privileged notification'
    })
  ).toHaveLength(1)
  const tools = z
    .object({ tools: z.array(z.object({ name: z.string() })).default([]) })
    .parse(JSON.parse(env.requests[2])).tools
  expect(
    tools.some((tool) => {
      return tool.name === 'chat_send'
    })
  ).toBe(false)
  revoke = () => {
    env.config.framework.defaults.behavior.allowProactive = false
  }
  expect((await trigger('admin')).status).toBe('completed')
  expect(
    env.state.listMessages(env.room.id).filter((message) => {
      return message.text === 'privileged notification'
    })
  ).toHaveLength(1)
  expect(
    env.state.listTraces().some((trace) => {
      return trace.detail.includes('无权执行：chat_send')
    })
  ).toBe(true)
})

test('mixed triggers intersect authority; editable mock names never impersonate platform users; queued grants do not widen', () => {
  const room = migrateRoom({
    id: 'room',
    name: 'test',
    address: { channel: 'qq', accountId: 'bot', kind: 'group', chatId: 'g' },
    mode: 'live',
    createdAt: 1,
    updatedAt: 1
  }).room
  const framework = initialFramework(BotConfigSchema.parse({}), 'main')
  framework.defaults.permissions = {
    default: 'deny',
    rules: [
      { effect: 'allow', capabilities: ['chat_history'], subjects: [{ kind: 'everyone' }] },
      {
        effect: 'allow',
        capabilities: ['bash'],
        subjects: [{ kind: 'platform-user', channel: 'qq', accountId: 'bot', actorId: 'admin' }]
      }
    ]
  }
  const effective = resolveSettings(framework, room.address, {})
  const admin: TriggerIdentity = {
    origin: 'platform',
    channel: 'qq',
    accountId: 'bot',
    actorId: 'admin',
    actorName: 'Admin',
    messageIds: []
  }
  const member = { ...admin, actorId: 'member' }
  const batch = captureAuthority(effective, [admin, member])
  expect(batch.capabilities).toEqual(['chat_history'])
  const mock = captureAuthority(effective, [localIdentity('qq', 'bot', 'admin', 'Admin')])
  expect(mock.capabilities).not.toContain('bash')
  const granted = captureAuthority(effective, [admin])
  expect(granted.capabilities).toContain('bash')
  framework.defaults.permissions = { default: 'allow', rules: [] }
  const current = resolveSettings(framework, room.address, {})
  expect(() => {
    assertCapability(batch, current.settings, 'bash')
  }).toThrow('无权')
})

test('layered settings preserve explicit empty selection; legacy room migration preserves Pi history mapping', () => {
  const value = {
    id: 'legacy',
    name: 'old',
    address: { channel: 'qq', accountId: 'bot', kind: 'group', chatId: 'g' },
    mode: 'live',
    generation: 4,
    providerGroup: 'custom',
    createdAt: 1,
    updatedAt: 2
  }
  const { room, conversation } = migrateRoom(value)
  expect(conversation?.sessionKey).toBe('legacy:4')
  expect(room.settings.preferences?.providerGroup).toBe('custom')
  expect(migrateRoom(room).conversation).toBeUndefined()
  const framework = initialFramework(BotConfigSchema.parse({}), 'main')
  framework.accounts = [
    { channel: 'qq', accountId: 'bot', settings: { preferences: { replyStyle: 'account style' } } }
  ]
  const effective = resolveSettings(framework, room.address, room.settings, {
    preferences: { replyStyle: '' },
    resources: { tools: { mode: 'selected', ids: [] } }
  })
  expect(effective.settings.preferences.replyStyle).toBe('')
  expect(effective.settings.preferences.providerGroup).toBe('custom')
  expect(effective.sources['preferences.replyStyle']).toBe('当前对话')
  expect(effective.sources['preferences.providerGroup']).toBe('聊天范围')
  expect(effective.settings.resources.tools).toEqual({ mode: 'selected', ids: [] })
  const cleared = SettingsPatchSchema.parse(
    JSON.parse(
      JSON.stringify({
        preferences: { replyStyle: undefined },
        data: {},
        behavior: {},
        resources: {},
        output: {}
      })
    )
  )
  const inherited = resolveSettings(framework, room.address, room.settings, cleared)
  expect(inherited.settings.preferences.replyStyle).toBe('account style')
  expect(inherited.sources['preferences.replyStyle']).toBe('账号')
  expect(inherited.sources['preferences.providerGroup']).toBe('聊天范围')
  expect(inherited.sources['resources.tools']).toBe('默认')
})

test('history/output projections leave raw records intact and recalled content is not returned to the model', () => {
  const settings = initialFramework(BotConfigSchema.parse({}), 'main').defaults
  const raw = {
    id: 'message',
    roomId: 'room',
    actorId: 'a',
    actorName: 'Alice',
    role: 'user' as const,
    text: 'removed secret',
    recalled: true,
    attachments: [],
    platformMessageIds: [],
    createdAt: 1
  }
  expect(JSON.stringify(projectHistory([raw], settings))).not.toContain('removed secret')
  expect(raw.text).toBe('removed secret')
  expect(projectOutput('  reply  ', settings)).toBe('reply')
})
