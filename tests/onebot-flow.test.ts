import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import { BotConfigSchema } from '@pi-im-bot/config/schema'
import { ProviderCatalog } from '@pi-im-bot/providers/catalog'
import { ProvidersConfigSchema } from '@pi-im-bot/providers/schema'
import { OneBotAdapter } from '@pi-im-bot/channels/onebot/adapter'
import { tokenRevision } from '@pi-im-bot/channels/onebot/auth'
import { ChannelRegistry } from '@pi-im-bot/channels/registry'
import { Coordinator } from '@pi-im-bot/runtime/coordinator'
import { DeliveryService } from '@pi-im-bot/runtime/delivery'
import { EventHub, type AppEvent } from '@pi-im-bot/contracts/events'
import { addressKey } from '@pi-im-bot/contracts/message'
import { extractPrompt } from '@pi-im-bot/runtime/trigger'
import { MemoryState } from './memory-state'
import { testFramework, testResources } from './agent-input'
import { localIdentity } from '@pi-im-bot/permissions/identity'
import { pluginFixture } from './plugin-fixture'
import { PluginService } from '@pi-im-bot/plugins/service'
import { ResourceLibrary } from '@pi-im-bot/resources/library'
import { ResourcesConfigSchema } from '@pi-im-bot/resources/schema'

const directories: string[] = []
afterEach(async () => {
  for (const path of directories.splice(0)) {
    await rm(path, { recursive: true, force: true })
  }
})

test('QQ messages reach the conversation, bare help replies, self echoes deduplicate, and switching targets blocks old delivery', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-onebot-flow-'))
  directories.push(root)
  const bot = BotConfigSchema.parse({
    onebot: { targets: [{ selfId: '11', chatId: '33', name: 'First', enabled: true }] }
  })
  const catalog = await ProviderCatalog.create(
    ProvidersConfigSchema.parse({
      defaultGroup: 'main',
      providers: [],
      groups: [{ id: 'main', candidates: [] }]
    }),
    root
  )
  const config = {
    bot,
    catalog,
    framework: testFramework(),
    resources: testResources(),
    dataDir: root,
    configDir: root,
    projectDir: root
  }
  const store = new MemoryState()
  const events = new EventHub()
  const updates: AppEvent[] = []
  events.subscribe((event) => {
    updates.push(event)
  })
  const channels = new ChannelRegistry()
  const delivery = new DeliveryService(channels, store, events)
  const coordinator = new Coordinator(
    () => {
      return config
    },
    store,
    events,
    delivery
  )
  const adapter = new OneBotAdapter(
    () => {
      return bot.onebot
    },
    events,
    async (message) => {
      const room = store.listRooms().find((room) => {
        return addressKey(room.address) === addressKey(message.address)
      })
      if (!room) {
        return 'unmatched'
      }
      return coordinator.receiveIncoming(room.id, message, extractPrompt(message.text, '!pi', '11'))
    }
  )
  let outputId = 500
  let sends = 0
  const socket = {
    send(raw: string) {
      const action = z
        .object({
          action: z.string(),
          params: z.object({ message: z.array(z.object({ data: z.object({ text: z.string() }) })) }),
          echo: z.string()
        })
        .parse(JSON.parse(raw))
      sends += 1
      const id = ++outputId
      queueMicrotask(async () => {
        await adapter.message(
          '11',
          JSON.stringify({
            post_type: 'message_sent',
            message_type: 'group',
            self_id: 11,
            user_id: 11,
            group_id: 33,
            message_id: id,
            message: action.params.message,
            sender: { nickname: 'Bot' }
          }),
          socket
        )
        await adapter.message(
          '11',
          JSON.stringify({ retcode: 0, echo: action.echo, data: { message_id: id } }),
          socket
        )
      })
      return raw.length
    },
    close() {}
  }
  channels.register(adapter)
  adapter.connect('11', socket, tokenRevision(''))
  coordinator.syncOneBotRooms()
  const room = store.listRooms()[0]
  async function receive(id: number, text: string, actor = 22, group = 33) {
    await adapter.message(
      '11',
      JSON.stringify({
        post_type: 'message',
        message_type: 'group',
        self_id: 11,
        user_id: actor,
        group_id: group,
        message_id: id,
        time: 1700000000 + id,
        message: [{ type: 'text', data: { text } }],
        sender: { nickname: 'Member' }
      }),
      socket
    )
  }
  await receive(1, '普通消息')
  expect(store.listMessages(room.id)[0]).toMatchObject({
    text: '普通消息',
    actorName: 'Member',
    platformMessageIds: ['1'],
    createdAt: 1700000001000
  })
  expect(store.listRuns()).toHaveLength(0)
  expect(sends).toBe(0)
  expect(
    updates.some((event) => {
      return event.type === 'message' && event.message.text === '普通消息'
    })
  ).toBe(true)
  await receive(2, '/help')
  expect(sends).toBe(1)
  expect(store.listRuns()).toHaveLength(0)
  expect(store.listMessages(room.id)).toHaveLength(3)
  expect(store.listMessages(room.id)[2].text).toContain('/help')
  await receive(2, '/help')
  expect(sends).toBe(1)
  await receive(3, '!pi 不要执行自身消息', 11)
  expect(store.listRuns()).toHaveLength(0)
  expect(store.listMessages(room.id).at(-1)?.role).toBe('assistant')

  const queued = coordinator.enqueue({
    roomId: room.id,
    text: 'queued task',
    actorId: '22',
    actorName: 'Member',
    source: 'im',
    receivedAt: Date.now(),
    identities: [localIdentity('mock', 'test')]
  })
  bot.onebot.targets[0].enabled = false
  bot.onebot.targets.push({ selfId: '11', chatId: '44', name: 'Second', enabled: true })
  coordinator.syncOneBotRooms()
  await coordinator.waitRun(queued.id)
  expect(store.getRun(queued.id)?.status).toBe('cancelled')
  await expect(adapter.send(room.address, 'late result')).rejects.toThrow('未启用')
  await receive(4, '/help')
  expect(sends).toBe(1)
  expect(store.getRoom(room.id)).toBeDefined()
  expect(store.listMessages(room.id)).toHaveLength(4)
  const next = store.listRooms().find((item) => {
    return item.address.chatId === '44'
  })!
  await receive(5, '新群消息', 22, 44)
  expect(store.listMessages(next.id)[0].text).toBe('新群消息')
  bot.onebot.targets[0].enabled = true
  coordinator.syncOneBotRooms()
  expect(store.listRooms()).toHaveLength(2)
  expect(store.getRoom(room.id)).toBeDefined()
  const plugins = await pluginFixture()
  try {
    const binding = await plugins.register(
      'qq-command',
      `export default { operations: { echo(input, ctx) { return { text: 'QQ_PLUGIN:' + ctx.invocation.actors[0].id + ':' + input.text } } } }`,
      {
        commands: [{ id: 'echo', names: ['qqecho'], operation: 'echo', description: 'QQ plugin command' }]
      }
    )
    bot.plugins = plugins.manager.config
    config.resources = new ResourceLibrary(
      ResourcesConfigSchema.parse({ plugins: [binding.instance] }),
      [],
      [],
      [binding.bundle]
    )
    coordinator.plugins = new PluginService(() => {
      return config
    }, plugins.manager)
    await receive(70, '/qqecho direct-platform-command', 22, 44)
    expect(
      store.listMessages(next.id).some((message) => {
        return message.text === 'QQ_PLUGIN:22:direct-platform-command'
      })
    ).toBe(true)
    const sent = sends
    await receive(70, '/qqecho direct-platform-command', 22, 44)
    expect(sends).toBe(sent)
    config.framework.defaults.permissions.rules = [
      {
        effect: 'deny',
        capabilities: ['plugin:qq-command/*'],
        subjects: [{ kind: 'platform-user', channel: 'onebot-v11', accountId: '11', actorId: '23' }]
      }
    ]
    await receive(71, '/qqecho forbidden', 23, 44)
    expect(
      store.listMessages(next.id).some((message) => {
        return message.text === 'QQ_PLUGIN:23:forbidden'
      })
    ).toBe(false)
  } finally {
    await plugins.close()
  }
  await coordinator.shutdown()
})
