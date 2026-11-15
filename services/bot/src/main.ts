import { resolve, join } from 'node:path'
import { mkdir } from 'node:fs/promises'
import { loadConfiguration } from '@pi-im-bot/config/load'
import { StateStore } from '@pi-im-bot/storage/state'
import { EventHub } from '@pi-im-bot/contracts/events'
import { ChannelRegistry } from '@pi-im-bot/channels/registry'
import { createMockAdapter } from '@pi-im-bot/channels/mock'
import { OneBotAdapter } from '@pi-im-bot/channels/onebot/adapter'
import { DeliveryService } from '@pi-im-bot/runtime/delivery'
import { Coordinator } from '@pi-im-bot/runtime/coordinator'
import { Scheduler } from '@pi-im-bot/scheduler/service'
import { createHttpApp } from './http/app'
import { addressKey } from '@pi-im-bot/contracts/message'
import { ProviderEditor } from '@pi-im-bot/providers/editor'
import { OneBotSettings } from '@pi-im-bot/channels/onebot/settings'
import { extractPrompt } from '@pi-im-bot/runtime/trigger'
import { FrameworkEditor, providerReferences } from '@pi-im-bot/settings/editor'
import { ConfigurationMutations } from '@pi-im-bot/config/mutations'
import { ResourceEditor } from '@pi-im-bot/resources/editor'
import { resourceReferences } from '@pi-im-bot/resources/references'
import { RuntimeOwner } from '@pi-im-bot/storage/owner'
import { DurableAgentRuntime } from '@pi-im-bot/agent/durable/runtime'
import { BunSqliteDatabase } from '@pi-im-bot/agent/durable/bun-sqlite'
import { SqliteStorage } from '@earendil-works/pi-durable/storage/sqlite'
import { JobService } from '@pi-im-bot/jobs/service'
import { ArtifactStore } from '@pi-im-bot/artifacts/store'
import { MediaService } from '@pi-im-bot/media/service'
import { PluginWorkerManager } from '@pi-im-bot/plugins/runtime/manager'
import { PluginService } from '@pi-im-bot/plugins/service'
import { PluginEditor } from '@pi-im-bot/plugins/editor'
import { revision } from '@pi-im-bot/settings/resolve'
import { configureArtifacts } from '@pi-im-bot/artifacts/quota'
import { PluginInstaller } from '@pi-im-bot/plugins/install/service'
import { PluginRuntimeEditor } from '@pi-im-bot/plugins/runtime/editor'
import { parseWebOrigins, webOriginAllowed } from './web-origin'

interface UiSocketData {
  kind: 'ui'
  unsubscribe?: () => void
}
interface OneBotSocketData {
  kind: 'onebot'
  selfId: string
  revision: string
}
type SocketData = UiSocketData | OneBotSocketData

const projectDir = resolve(import.meta.dir, '../../..')
const webOrigins = parseWebOrigins(process.env.BOT_WEB_ORIGINS)
const dataDir = resolve(process.env.BOT_DATA_DIR ?? join(projectDir, 'data'))
await mkdir(dataDir, { recursive: true })
const owner = new RuntimeOwner(dataDir)
let configuration = await loadConfiguration(projectDir)
configureArtifacts(configuration.dataDir, configuration.bot.artifacts)
process.env.PI_CODING_AGENT_DIR = join(configuration.dataDir, 'pi-agent')
const store = new StateStore(configuration.dataDir)
const events = new EventHub()
const channels = new ChannelRegistry()
channels.register(createMockAdapter())
const delivery = new DeliveryService(channels, store, events, (roomId) => {
  return new ArtifactStore(configuration.dataDir, roomId)
})
const coordinator = new Coordinator(
  () => {
    return configuration
  },
  store,
  events,
  delivery
)
const media = new MediaService(configuration.dataDir, store, channels)
const pluginWorkers = new PluginWorkerManager(
  projectDir,
  configuration.bot.plugins,
  undefined,
  configuration.dataDir
)
await pluginWorkers.start()
coordinator.plugins = new PluginService(() => {
  return configuration
}, pluginWorkers)
coordinator.attachMedia(media)
const scheduler = new Scheduler(store, coordinator)
coordinator.attachScheduler(scheduler)
const onebot = new OneBotAdapter(
  () => {
    return configuration.bot.onebot
  },
  events,
  async (message) => {
    const room = store.listRooms().find((candidate) => {
      return addressKey(candidate.address) === addressKey(message.address)
    })
    if (!room) {
      return 'unmatched'
    }
    return coordinator.receiveIncoming(
      room.id,
      message,
      extractPrompt(message.text, configuration.bot.onebot.commandPrefix, message.address.accountId)
    )
  },
  (address, platformId) => {
    coordinator.receiveRecall(address, platformId)
  }
)
channels.register(onebot)
coordinator.syncOneBotRooms()
coordinator.ensureMockRoom()
const durable = new DurableAgentRuntime(() => {
  return configuration.bot.agent.maxConcurrentRuns
})
coordinator.attachDurable(durable)
const jobs = new JobService(durable, coordinator)
coordinator.attachJobs(jobs)
await coordinator.prepareRecovery()
await durable.open(
  await SqliteStorage.open(new BunSqliteDatabase(join(configuration.dataDir, 'agent.sqlite')))
)
coordinator.resumeRecovery()
scheduler.start()
const configMutations = new ConfigurationMutations()
const providerEditor = new ProviderEditor(
  {
    configuration: () => {
      return configuration
    },
    apply(catalog) {
      configuration = { ...configuration, catalog }
    },
    groupUsage() {
      return providerReferences(configuration.framework, store.listRooms(), store.listConversations())
    }
  },
  configMutations
)
const frameworkEditor = new FrameworkEditor(
  () => {
    return configuration
  },
  store,
  (framework) => {
    configuration = { ...configuration, framework }
  },
  configMutations
)
frameworkEditor.validate(configuration.framework)
const resourceEditor = new ResourceEditor(
  () => {
    return configuration
  },
  (resources) => {
    configuration = { ...configuration, resources }
    coordinator.plugins?.configurationChanged()
  },
  configMutations,
  (kind, id) => {
    return resourceReferences(configuration, store, kind, id)
  }
)
const onebotSettings = new OneBotSettings(configuration.configDir, (bot) => {
  const previous = configuration.bot.onebot
  configuration = { ...configuration, bot }
  configureArtifacts(configuration.dataDir, bot.artifacts)
  onebot.reconfigure(previous)
  coordinator.syncOneBotRooms()
  events.emit({ type: 'config' })
})
const pluginEditor = new PluginEditor(
  () => {
    return configuration
  },
  (resources) => {
    configuration = { ...configuration, resources }
    coordinator.plugins?.configurationChanged()
  },
  configMutations,
  (resources) => {
    frameworkEditor.validate(configuration.framework, undefined, undefined, configuration.catalog, resources)
  },
  (id) => {
    return resourceReferences(configuration, store, 'plugin', id)
  }
)
const pluginInstaller = new PluginInstaller(pluginEditor, () => {
  events.emit({ type: 'config' })
})
await pluginEditor.initializeGsviConfiguration()
const app = createHttpApp({
  webOrigins,
  configuration: () => {
    return configuration
  },
  coordinator,
  scheduler,
  onebot,
  onebotSettings,
  providerEditor,
  frameworkEditor,
  resourceEditor,
  pluginEditor,
  pluginInstaller,
  pluginRuntimeEditor: new PluginRuntimeEditor(
    () => {
      return configuration
    },
    coordinator.plugins,
    configMutations
  ),
  jobs,
  media,
  async reload() {
    await onebotSettings.exclusive(async () => {
      await configMutations.exclusive(async () => {
        const previous = configuration.bot.onebot
        const next = await loadConfiguration(projectDir)
        if (revision(next.bot.plugins) !== revision(configuration.bot.plugins)) {
          throw new Error('插件执行后端配置已变化，需要重启 Bot 后应用')
        }
        frameworkEditor.validate(next.framework, undefined, undefined, next.catalog, next.resources)
        configuration = next
        configureArtifacts(configuration.dataDir, configuration.bot.artifacts)
        coordinator.plugins?.configurationChanged()
        onebot.reconfigure(previous)
        coordinator.syncOneBotRooms()
      })
    })
  }
})

const server = Bun.serve<SocketData>({
  hostname: configuration.bot.server.host,
  port: configuration.bot.server.port,
  idleTimeout: 120,
  fetch(request, server) {
    const path = new URL(request.url).pathname
    if (path === '/api/events') {
      if (!uiOriginAllowed(request)) {
        return new Response('Web origin is not allowed', { status: 403 })
      }
      if (server.upgrade(request, { data: { kind: 'ui' } })) {
        return
      }
      return new Response('WebSocket upgrade required', { status: 426 })
    }
    if (path === configuration.bot.onebot.path) {
      const auth = onebot.authorize(request)
      if (!auth.ok) {
        return new Response(auth.reason, { status: auth.status })
      }
      if (
        server.upgrade(request, { data: { kind: 'onebot', selfId: auth.selfId, revision: auth.revision } })
      ) {
        return
      }
      return new Response('WebSocket upgrade required', { status: 426 })
    }
    return app.fetch(request)
  },
  websocket: {
    maxPayloadLength: 1024 * 1024,
    open(socket) {
      if (socket.data.kind === 'onebot') {
        onebot.connect(socket.data.selfId, socket, socket.data.revision)
      } else {
        socket.data.unsubscribe = events.subscribe((event) => {
          if (socket.getBufferedAmount() > 1024 * 1024) {
            socket.close(1013, 'Client too slow')
            return
          }
          socket.send(JSON.stringify(event))
        })
      }
    },
    message(socket, data) {
      if (socket.data.kind === 'onebot') {
        void onebot.message(socket.data.selfId, String(data), socket).catch((error) => {
          console.warn('OneBot event rejected:', configuration.catalog.redact(String(error)))
        })
      }
    },
    close(socket) {
      if (socket.data.kind === 'onebot') {
        onebot.disconnect(socket.data.selfId, socket)
      } else {
        socket.data.unsubscribe?.()
      }
    }
  }
})
console.log(`Pi IM Bot listening: ${configuration.bot.server.host}:${server.port}`)
console.log(`Bot API: http://localhost:${server.port}`)
console.log(`Provider configuration: ${join(configuration.configDir, 'providers.json')}`)

function uiOriginAllowed(request: Request) {
  return webOriginAllowed(request.headers.get('Origin'), webOrigins)
}

let closing = false
async function shutdown() {
  if (closing) {
    return
  }
  closing = true
  await scheduler.stop()
  onebot.close()
  await coordinator.shutdown()
  await pluginInstaller.close()
  await pluginEditor.gsviRefresh.close()
  await coordinator.plugins?.manager.close()
  await server.stop(true)
  store.close()
  owner.close()
  process.exit(0)
}
process.on('SIGINT', () => {
  void shutdown()
})
process.on('SIGTERM', () => {
  void shutdown()
})
