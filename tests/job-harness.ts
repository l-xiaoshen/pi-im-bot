import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
export { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import { openNodeJsonlStorage } from '@earendil-works/pi-durable/storage/jsonl/node'
import { DurableAgentRuntime } from '@pi-im-bot/agent/durable/runtime'
import { Coordinator } from '@pi-im-bot/runtime/coordinator'
import { EventHub } from '@pi-im-bot/contracts/events'
import { ChannelRegistry } from '@pi-im-bot/channels/registry'
import { createMockAdapter } from '@pi-im-bot/channels/mock'
import { DeliveryService } from '@pi-im-bot/runtime/delivery'
import { JobService } from '@pi-im-bot/jobs/service'
import { BotConfigSchema } from '@pi-im-bot/config/schema'
import { ProviderCatalog } from '@pi-im-bot/providers/catalog'
import { ProvidersConfigSchema } from '@pi-im-bot/providers/schema'
import { ResourceLibrary } from '@pi-im-bot/resources/library'
import { MemoryState } from './memory-state'
import { testFramework } from './agent-input'
import { ArtifactStore } from '@pi-im-bot/artifacts/store'
import { MediaService } from '@pi-im-bot/media/service'
import { Scheduler } from '@pi-im-bot/scheduler/service'
import type { Configuration } from '@pi-im-bot/config/load'

const RequestSchema = z.object({
  input: z.array(z.object({ role: z.string().optional(), content: z.unknown().optional() }).passthrough())
})
export function latestUser(raw: string) {
  return JSON.stringify(
    RequestSchema.parse(JSON.parse(raw)).input.findLast((item) => {
      return item.role === 'user'
    })?.content
  )
}
export async function untilJob(check: () => boolean | Promise<boolean>, message: string) {
  for (let i = 0; i < 400; i++) {
    if (await check()) {
      return
    }
    await Bun.sleep(10)
  }
  throw new Error(message)
}

export async function jobHarness(
  reply: (raw: string, call: number) => Response | Promise<Response>,
  resources = ResourceLibrary.empty(),
  setup?: (coordinator: Coordinator, config: Configuration) => void
) {
  const root = await mkdtemp('/tmp/pi-job-lifecycle-')
  const requests: string[] = []
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      const raw = await request.text()
      requests.push(raw)
      return reply(raw, requests.length)
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
    resources,
    dataDir: root,
    configDir: root,
    projectDir: root
  }
  config.framework.defaults.behavior.batchQuietMs = 0
  const store = new MemoryState()
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
      new DeliveryService(channels, store, events, (roomId) => {
        return new ArtifactStore(root, roomId)
      })
    )
    const runtime = new DurableAgentRuntime()
    setup?.(coordinator, config)
    const media = new MediaService(root, store, channels)
    coordinator.attachMedia(media)
    coordinator.attachDurable(runtime)
    const jobs = new JobService(runtime, coordinator)
    coordinator.attachJobs(jobs)
    const scheduler = new Scheduler(store, coordinator)
    coordinator.attachScheduler(scheduler)
    await coordinator.prepareRecovery()
    await runtime.open(await openNodeJsonlStorage(join(root, 'journal'), BACKGROUND_CONTEXT))
    coordinator.resumeRecovery()
    return { coordinator, jobs, runtime, media, channels, scheduler }
  }
  let current = await open()
  const room = current.coordinator.createMockRoom('Lifecycle group', 'group')
  store.saveRoom({ ...room, mode: 'live' })
  return {
    config,
    store,
    requests,
    room,
    get coordinator() {
      return current.coordinator
    },
    get media() {
      return current.media
    },
    get channels() {
      return current.channels
    },
    get runtime() {
      return current.runtime
    },
    get scheduler() {
      return current.scheduler
    },
    get jobs() {
      return current.jobs
    },
    async restart(beforeOpen?: () => Promise<void>) {
      await current.scheduler.stop()
      await current.coordinator.shutdown()
      await beforeOpen?.()
      current = await open()
    },
    async close() {
      await current.scheduler.stop()
      await current.coordinator.shutdown()
      await server.stop(true)
      await rm(root, { recursive: true, force: true })
    }
  }
}

export function pendingResponse() {
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(': waiting\n\n'))
      }
    }),
    { headers: { 'content-type': 'text/event-stream' } }
  )
}
