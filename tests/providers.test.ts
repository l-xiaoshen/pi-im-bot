import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import { normalizeContext } from '@earendil-works/pi-ai'
import { ProvidersConfigSchema } from '@pi-im-bot/providers/schema'
import { ProviderCatalog } from '@pi-im-bot/providers/catalog'
import { ProviderPool } from '@pi-im-bot/providers/pool'
import { createResponsesStream, type ProviderAttempt } from '@pi-im-bot/providers/responses'
import { mergeBody, mergeHeaders } from '@pi-im-bot/providers/body'
import { BotConfigSchema } from '@pi-im-bot/config/schema'
import { RoomSchema } from '@pi-im-bot/contracts/message'
import { runPi } from '@pi-im-bot/agent/pi-runner'
import { agentInput, testFramework, testResources } from './agent-input'
import { responsesReply } from './responses-fixture'

const directories: string[] = []
const servers: Array<ReturnType<typeof Bun.serve>> = []
afterEach(async () => {
  for (const server of servers.splice(0)) {
    await server.stop(true)
  }
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true })
  }
})

async function setup(handler: (request: Request) => Response | Promise<Response>) {
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: handler })
  servers.push(server)
  const directory = await mkdtemp(join(tmpdir(), 'pi-im-provider-tests-'))
  directories.push(directory)
  const config = ProvidersConfigSchema.parse({
    defaultGroup: 'main',
    providers: [
      {
        id: 'first',
        baseUrl: `http://127.0.0.1:${server.port}/first/v1`,
        apiKey: 'test-secret-one',
        headers: { 'X-Shared': 'provider', 'X-Only-Provider': 'yes' },
        body: { reasoning: { effort: 'low', summary: 'auto' }, service_tier: 'auto' },
        models: [
          {
            id: 'first-model',
            headers: { 'x-shared': 'model' },
            body: { reasoning: { effort: 'high' }, service_tier: 'priority', vendor_extra: { flag: true } }
          }
        ]
      },
      {
        id: 'second',
        baseUrl: `http://127.0.0.1:${server.port}/second/v1`,
        apiKey: 'test-secret-two',
        models: [{ id: 'second-model' }]
      }
    ],
    groups: [
      {
        id: 'main',
        candidates: [
          { provider: 'first', model: 'first-model' },
          { provider: 'second', model: 'second-model' }
        ],
        cooldownMs: 60000
      }
    ]
  })
  const catalog = await ProviderCatalog.create(config, directory)
  return { catalog, directory }
}

describe('Responses configuration and native Pi transport', () => {
  test('image requests skip text-only candidates instead of silently dropping pixels', async () => {
    const paths: string[] = []
    const { catalog } = await setup((request) => {
      paths.push(new URL(request.url).pathname)
      return responsesReply({ kind: 'text', text: 'image model' })
    })
    const candidates = catalog.forGroup('main')
    candidates[0].config.images = false
    const stream = createResponsesStream(catalog, 'main', { attempt() {}, preview() {} })(
      candidates[0].model,
      normalizeContext({
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'look' },
              { type: 'image', mimeType: 'image/png', data: 'aGVsbG8=' }
            ],
            timestamp: Date.now()
          }
        ]
      }),
      {}
    )
    expect((await stream.result()).stopReason).toBe('stop')
    expect(paths).toEqual(['/second/v1/responses'])
  })
  test('custom headers and nested body reach /responses with model precedence', async () => {
    let seen = false
    const { catalog } = await setup(async (request) => {
      expect(new URL(request.url).pathname).toBe('/first/v1/responses')
      expect(request.headers.get('authorization')).toBe('Bearer test-secret-one')
      expect(request.headers.get('x-shared')).toBe('model')
      expect(request.headers.get('x-only-provider')).toBe('yes')
      const body = z
        .object({
          model: z.string(),
          reasoning: z.object({ effort: z.string(), summary: z.string() }),
          service_tier: z.string(),
          vendor_extra: z.object({ flag: z.boolean() }),
          stream: z.boolean()
        })
        .parse(await request.json())
      expect(body.model).toBe('first-model')
      expect(body.reasoning).toEqual({ effort: 'high', summary: 'auto' })
      expect(body.service_tier).toBe('priority')
      expect(body.vendor_extra.flag).toBe(true)
      expect(body.stream).toBe(true)
      seen = true
      return responsesReply({ kind: 'text', text: 'configured' })
    })
    const candidate = catalog.forGroup('main')[0]
    const stream = await createResponsesStream(catalog, 'main', { attempt() {}, preview() {} })(
      candidate.model,
      normalizeContext({ messages: [{ role: 'user', content: 'hello', timestamp: Date.now() }] }),
      {}
    )
    const result = await stream.result()
    expect(seen).toBe(true)
    expect(result.stopReason).toBe('stop')
    expect(result.usage.cacheRead).toBe(4)
  })

  test('failed partial output is discarded before trying the next provider', async () => {
    const attempts: ProviderAttempt[] = []
    const { catalog } = await setup((request) => {
      if (new URL(request.url).pathname.startsWith('/first/')) {
        return responsesReply({ kind: 'text', text: 'discard me' }, false)
      }
      return responsesReply({ kind: 'text', text: 'backup result' })
    })
    const stream = await createResponsesStream(catalog, 'main', {
      attempt(event) {
        attempts.push(event)
      },
      preview() {}
    })(
      catalog.forGroup('main')[0].model,
      normalizeContext({ messages: [{ role: 'user', content: 'hello', timestamp: Date.now() }] }),
      {}
    )
    const deltas: string[] = []
    for await (const event of stream) {
      if (event.type === 'text_delta') {
        deltas.push(event.delta)
      }
    }
    expect(deltas.join('')).toBe('backup result')
    expect((await stream.result()).provider).toBe('second')
    expect(
      attempts.filter((event) => {
        return event.status === 'failed'
      })
    ).toHaveLength(1)
  })

  test('fallback inside a Pi run does not repeat a completed tool', async () => {
    let primary = 0
    let backup = 0
    let sends = 0
    const { catalog, directory } = await setup((request) => {
      if (new URL(request.url).pathname.startsWith('/first/')) {
        primary += 1
        if (primary === 1) {
          return responsesReply({ kind: 'tool', name: 'chat_send', arguments: { text: 'one notification' } })
        }
        return Response.json(
          { error: { message: 'Unavailable', type: 'server_error', code: 'unavailable' } },
          { status: 503 }
        )
      }
      backup += 1
      return responsesReply({ kind: 'text', text: 'finished' })
    })
    const bot = BotConfigSchema.parse({})
    const room = RoomSchema.parse({
      id: 'test',
      name: 'test',
      address: { channel: 'mock', accountId: 'test', kind: 'group', chatId: 'test' },
      mode: 'live',
      providerGroup: 'main',
      createdAt: Date.now(),
      updatedAt: Date.now()
    })
    const text = await runPi(
      {
        bot,
        catalog,
        framework: testFramework(),
        resources: testResources(),
        dataDir: directory,
        configDir: directory,
        projectDir: process.cwd()
      },
      room,
      agentInput(room, 'send one notification'),
      new AbortController().signal,
      {
        authorize() {},
        history() {
          return []
        },
        async send(text) {
          sends += 1
          return {
            id: 'sent',
            roomId: room.id,
            role: 'assistant',
            actorId: 'bot',
            actorName: 'Pi',
            text,
            attachments: [],
            platformMessageIds: ['one'],
            createdAt: Date.now(),
            recalled: false
          }
        }
      },
      { trace() {}, preview() {}, provider() {}, tool() {} }
    )
    expect(text).toBe('finished')
    expect(primary).toBe(2)
    expect(backup).toBe(1)
    expect(sends).toBe(1)
  })

  test('a timed-out provider falls back within the same model request', async () => {
    const { catalog } = await setup((request) => {
      if (new URL(request.url).pathname.startsWith('/first/')) {
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode(': waiting\n\n'))
            }
          }),
          { headers: { 'content-type': 'text/event-stream' } }
        )
      }
      return responsesReply({ kind: 'text', text: 'after timeout' })
    })
    catalog.forGroup('main')[0].provider.timeoutMs = 1000
    const stream = await createResponsesStream(catalog, 'main', { attempt() {}, preview() {} })(
      catalog.forGroup('main')[0].model,
      normalizeContext({ messages: [{ role: 'user', content: 'hello', timestamp: Date.now() }] }),
      {}
    )
    const result = await stream.result()
    expect(result.provider).toBe('second')
    expect(result.stopReason).toBe('stop')
  })

  test('explicit cancellation does not fall back to another provider', async () => {
    const started = Promise.withResolvers<void>()
    let requests = 0
    const { catalog } = await setup(() => {
      requests += 1
      started.resolve()
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(': waiting\n\n'))
          }
        }),
        { headers: { 'content-type': 'text/event-stream' } }
      )
    })
    const controller = new AbortController()
    const stream = await createResponsesStream(catalog, 'main', { attempt() {}, preview() {} })(
      catalog.forGroup('main')[0].model,
      normalizeContext({ messages: [{ role: 'user', content: 'hello', timestamp: Date.now() }] }),
      { signal: controller.signal }
    )
    await started.promise
    controller.abort()
    expect((await stream.result()).stopReason).toBe('aborted')
    expect(requests).toBe(1)
  })

  test('cooldown skips the failed primary and later allows failback', async () => {
    const { catalog } = await setup(() => {
      return responsesReply({ kind: 'text', text: 'ok' })
    })
    let now = 1000
    const pool = new ProviderPool(() => {
      return now
    })
    const candidates = catalog.forGroup('main')
    pool.failed(candidates[0], catalog.group('main'), 'failure')
    expect(pool.order(candidates)[0].key).toBe(candidates[1].key)
    now = 62000
    expect(pool.order(candidates)[0].key).toBe(candidates[0].key)
  })

  test('reserved body fields are rejected and headers merge case-insensitively', () => {
    expect(
      mergeBody(
        { reasoning: { effort: 'low', summary: 'auto' }, tags: ['a'] },
        { reasoning: { effort: 'high' }, tags: ['b'] }
      )
    ).toEqual({ reasoning: { effort: 'high', summary: 'auto' }, tags: ['b'] })
    expect(mergeHeaders({ Authorization: 'first' }, { authorization: null })).toEqual({ authorization: null })
    expect(
      ProvidersConfigSchema.safeParse({
        defaultGroup: 'main',
        providers: [
          { id: 'p', baseUrl: 'http://localhost/v1', models: [{ id: 'm' }], body: { input: 'override' } }
        ],
        groups: [{ id: 'main', candidates: [{ provider: 'p', model: 'm' }] }]
      }).success
    ).toBe(false)
  })
})
