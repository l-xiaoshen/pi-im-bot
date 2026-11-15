import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import { runPi } from '@pi-im-bot/agent/pi-runner'
import { agentInput, testFramework, testResources } from './agent-input'
import { BotConfigSchema } from '@pi-im-bot/config/schema'
import { RoomSchema } from '@pi-im-bot/contracts/message'
import { ProviderCatalog } from '@pi-im-bot/providers/catalog'
import { ProvidersConfigSchema } from '@pi-im-bot/providers/schema'
import { ShipyardConfigSchema } from '@pi-im-bot/execution/config'
import { SandboxSession } from '@pi-im-bot/execution/session'
import { createFakeShipyard } from './shipyard-fixture'
import { responsesReply } from './responses-fixture'

const roots: string[] = []
const cleanup: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const close of cleanup.splice(0)) {
    await close()
  }
  for (const root of roots.splice(0)) {
    await rm(root, { recursive: true, force: true })
  }
})

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'pi-shipyard-test-'))
  roots.push(root)
  const bay = createFakeShipyard()
  cleanup.push(bay.close)
  const execution = ShipyardConfigSchema.parse({
    backend: 'shipyard',
    endpoint: bay.endpoint,
    apiKey: 'test-bay-key'
  })
  return { root, bay, execution }
}

test('Pi files and bash share a persistent remote container; absolute guest paths cannot modify host files', async () => {
  const { root, bay, execution } = await setup()
  const marker = join(root, 'host-only.txt')
  bay.output('remote-line\n'.repeat(2100))
  const secret = 'host-only-' + crypto.randomUUID()
  await writeFile(marker, secret)
  const steps = [
    { name: 'read', arguments: { path: marker } },
    { name: 'write', arguments: { path: marker, content: 'remote first' } },
    { name: 'edit', arguments: { path: marker, edits: [{ oldText: 'first', newText: 'edited' }] } },
    { name: 'read', arguments: { path: marker } },
    { name: 'ls', arguments: { path: root } },
    { name: 'bash', arguments: { command: 'printf example > ' + marker } },
    { name: 'codemode', arguments: { code: 'forbidden' } }
  ]
  let index = 0
  let second = false
  const toolSets: string[][] = []
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      const input = z
        .object({ input: z.unknown(), tools: z.array(z.object({ name: z.string() })) })
        .parse(await request.json())
      expect(JSON.stringify(input.input)).not.toContain(secret)
      toolSets.push(
        input.tools
          .map((tool) => {
            return tool.name
          })
          .sort()
      )
      const step = steps[index++]
      if (step) {
        return responsesReply({ kind: 'tool', ...step })
      }
      if (second && index === steps.length + 2) {
        return responsesReply({ kind: 'tool', name: 'read', arguments: { path: marker } })
      }
      return responsesReply({ kind: 'text', text: 'remote workflow complete' })
    }
  })
  cleanup.push(async () => {
    await server.stop(true)
  })
  const catalog = await ProviderCatalog.create(
    ProvidersConfigSchema.parse({
      providers: [
        {
          id: 'test',
          baseUrl: 'http://127.0.0.1:' + server.port + '/v1',
          apiKey: 'test',
          models: [{ id: 'test' }]
        }
      ],
      defaultGroup: 'main',
      groups: [{ id: 'main', candidates: [{ provider: 'test', model: 'test' }] }]
    }),
    root
  )
  const room = RoomSchema.parse({
    id: 'sandbox-room',
    name: 'sandbox',
    address: { channel: 'mock', accountId: 'test', kind: 'group', chatId: 'test' },
    mode: 'live',
    providerGroup: 'main',
    createdAt: Date.now(),
    updatedAt: Date.now()
  })
  const traces: string[] = []
  async function run() {
    return runPi(
      {
        bot: BotConfigSchema.parse({ agent: { execution } }),
        catalog,
        framework: testFramework(),
        resources: testResources(),
        dataDir: root,
        configDir: root,
        projectDir: process.cwd()
      },
      room,
      agentInput(room, 'test'),
      new AbortController().signal,
      {
        authorize() {},
        history() {
          return []
        },
        async send() {
          throw new Error('Unexpected send')
        }
      },
      {
        trace(event) {
          traces.push(event.detail)
        },
        provider() {},
        preview() {},
        tool() {}
      }
    )
  }
  expect(await run()).toBe('remote workflow complete')
  second = true
  expect(await run()).toBe('remote workflow complete')
  expect(bay.creations).toBe(1)
  expect(await readFile(marker, 'utf8')).toBe(secret)
  expect(bay.files.get('sbx-1')?.get(marker)?.toString()).toBe('remote edited')
  expect(
    [...bay.files.get('sbx-1')!.keys()].some((path) => {
      return path.startsWith('/workspace/.pi-output/')
    })
  ).toBe(true)
  expect(traces.join('\n')).toContain('remote edited')
  expect(traces.join('\n')).toContain('Tool codemode not found')
  for (const tools of toolSets) {
    expect(tools).toEqual([
      'artifact_publish',
      'artifact_read',
      'bash',
      'chat_history',
      'chat_send',
      'edit',
      'ls',
      'read',
      'write'
    ])
  }
  expect(
    bay.requests.some((request) => {
      return request.body.includes('printf example')
    })
  ).toBe(true)
  expect(JSON.stringify(bay.requests)).not.toContain('PI_SESSION_FILE')
  expect(JSON.stringify(bay.requests)).not.toContain(secret)
})

test('cancellation stops the dedicated remote sandbox before closing the run', async () => {
  const { root, bay, execution } = await setup()
  const controller = new AbortController()
  const session = new SandboxSession(execution, root, 'cancel-room', controller.signal, () => {})
  const task = session.execute('wait-for-cancel')
  void bay.shellStarted.then(() => {
    controller.abort('user')
  })
  await expect(task).rejects.toThrow()
  await session.close()
  expect(bay.stops).toBe(1)
  expect(bay.interrupts).toBe(1)
  expect(bay.files.size).toBe(1)
})

test('a remote execution failure never falls back to a host command', async () => {
  const { root, bay, execution } = await setup()
  const marker = join(root, 'must-not-exist')
  bay.fail()
  const session = new SandboxSession(execution, root, 'failed-room', new AbortController().signal, () => {})
  await expect(session.execute('touch ' + marker)).rejects.toThrow('HTTP 503')
  await session.close()
  expect(await Bun.file(marker).exists()).toBe(false)
  expect(bay.stops).toBe(1)
})
