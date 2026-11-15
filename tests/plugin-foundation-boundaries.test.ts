import { expect, test } from 'bun:test'
import { join } from 'node:path'
import { Hono } from 'hono'
import { z } from 'zod'
import { jobHarness } from './job-harness'
import { responsesReply } from './responses-fixture'
import { pluginFixture } from './plugin-fixture'
import { PluginHostServices } from '@pi-im-bot/plugins/rpc/services'
import { registerPluginMedia } from '@pi-im-bot/plugins/media-rpc'
import { pluginHostServices } from '@pi-im-bot/plugins/host'
import { ArtifactStore } from '@pi-im-bot/artifacts/store'
import { assertArtifactAccess } from '@pi-im-bot/plugins/artifact-access'
import { ResourceLibrary } from '@pi-im-bot/resources/library'
import { ResourcesConfigSchema } from '@pi-im-bot/resources/schema'
import { localIdentity } from '@pi-im-bot/permissions/identity'
import { PluginService } from '@pi-im-bot/plugins/service'
import { registerArtifactRoutes } from '@pi-im-bot/bot/http/artifact-routes'
import { createToolkit } from '@pi-im-bot/agent/toolkit'
import { mcpFixture } from './mcp-fixture'
import { inspectMcp } from '@pi-im-bot/resources/mcp/client'

async function boundaryFixture() {
  const app = await jobHarness(() => {
    return responsesReply({ kind: 'text', text: 'unused' })
  })
  const worker = await pluginFixture()
  const binding = await worker.register('boundaries', 'export default {}', {
    operations: [
      {
        id: 'echo',
        title: 'Boundaries',
        description: 'authored',
        inputSchema: { type: 'object' },
        grants: ['media.read', 'artifact.read', 'artifact.write']
      }
    ]
  })
  binding.instance.grants = ['media.read', 'artifact.read', 'artifact.write']
  app.config.resources = new ResourceLibrary(
    ResourcesConfigSchema.parse({ plugins: [binding.instance] }),
    [],
    [],
    [binding.bundle]
  )
  const invocation = app.coordinator.jobInvocation(app.room.id, localIdentity('mock', 'mock-bot'), 'review')
  const path = join(app.config.dataDir, 'source.txt')
  await Bun.write(path, 'real source')
  const file = Bun.file(path)
  let recalled = false
  let downloads = 0
  const gate = Promise.withResolvers<void>()
  const media = {
    visionEnabled: false,
    async preview(): Promise<never> {
      throw new Error('unused')
    },
    async content() {
      downloads += 1
      await gate.promise
      return {
        metadata: {
          id: crypto.randomUUID(),
          roomId: app.room.id,
          name: 'source.txt',
          mimeType: 'text/plain',
          bytes: file.size,
          createdAt: 0,
          source: 'fixture',
          sha256: ''
        },
        file
      }
    },
    require() {
      if (recalled) {
        throw new Error('source recalled')
      }
    }
  }
  const services = {
    authorize: invocation.authorize,
    history() {
      return []
    },
    async send() {
      throw new Error('unused')
    },
    media
  }
  const view = worker.context(binding, 30000)
  view.grants = binding.instance.grants
  const check = (grant: string) => {
    if (!binding.instance.grants.includes(grant)) {
      throw new Error('grant revoked')
    }
  }
  return {
    app,
    worker,
    binding,
    invocation: { ...invocation, services },
    view,
    check,
    gate,
    get downloads() {
      return downloads
    },
    set recalled(value: boolean) {
      recalled = value
    },
    async close() {
      gate.resolve()
      await app.close()
      await worker.close()
    }
  }
}

test('concurrent media reads reserve distinct IDs before I/O, reuse same-ID slots, and retain failed/cancelled reservations and byte budgets', async () => {
  const env = await boundaryFixture()
  try {
    const sources = new Set<string>()
    const host = new PluginHostServices()
    registerPluginMedia(host, env.invocation, () => {}, sources)
    const call = host.bind(env.binding, env.view, env.view.grants, env.check)
    const ids = Array.from({ length: 20 }, () => {
      return crypto.randomUUID()
    })
    const reads = ids.map((mediaId) => {
      return call('media.read', { mediaId, limit: 1 }, new AbortController().signal)
    })
    const results = Promise.allSettled(reads)
    expect(sources.size).toBe(16)
    expect(env.downloads).toBe(16)
    const same = call('media.read', { mediaId: ids[0], limit: 1 }, new AbortController().signal)
    env.gate.resolve()
    expect(
      (await results).filter((item) => {
        return item.status === 'fulfilled'
      })
    ).toHaveLength(16)
    await same
    expect(sources.size).toBe(16)
    const before = env.downloads
    await expect(
      call('media.read', { mediaId: ids[0], limit: 196609 }, new AbortController().signal)
    ).rejects.toThrow()
    expect(env.downloads).toBe(before)
    for (let i = 0; i < 44; i++) {
      await call('media.read', { mediaId: ids[0], limit: 196608 }, new AbortController().signal).catch(
        () => {}
      )
    }
    expect(env.downloads - before).toBeLessThanOrEqual(42)
    const cancel = new AbortController()
    const otherSources = new Set<string>()
    const other = new PluginHostServices()
    registerPluginMedia(other, env.invocation, () => {}, otherSources)
    const otherCall = other.bind(env.binding, env.view, env.view.grants, env.check)
    const pending = otherCall('media.read', { mediaId: ids[0], limit: 1 }, cancel.signal)
    cancel.abort()
    await expect(pending).rejects.toThrow()
    expect(otherSources.size).toBe(1)
  } finally {
    await env.close()
  }
})

test('artifact copies retain indirect media sources, recheck after async reads, and archived reads survive producer removal', async () => {
  const env = await boundaryFixture()
  try {
    env.gate.resolve()
    const sourceId = crypto.randomUUID()
    const store = new ArtifactStore(env.app.config.dataDir, env.app.room.id, undefined, 'fixture', () => {
      return { mediaIds: [sourceId], capabilities: ['media_read'] }
    })
    const original = await store.save('original.txt', 'text/plain', 'fixture', 'real source')
    const host = pluginHostServices(env.invocation, env.binding, 'copy', env.check)
    const call = host.bind(env.binding, env.view, env.view.grants, env.check)
    const read = z
      .object({ base64: z.string() })
      .parse(await call('artifact.read', { id: original.id }, new AbortController().signal))
    const copied = z
      .object({ id: z.uuid() })
      .parse(
        await call(
          'artifact.write',
          { name: 'copy.txt', mimeType: 'text/plain', encoding: 'base64', data: read.base64 },
          new AbortController().signal
        )
      )
    const copy = await store.metadata(copied.id)
    expect(copy.access?.mediaIds).toEqual([sourceId])
    env.recalled = true
    expect(() => {
      assertArtifactAccess(env.app.config, copy.access!, env.invocation.services.media.require)
    }).toThrow('recalled')
    await expect(call('artifact.read', { id: copy.id }, new AbortController().signal)).rejects.toThrow(
      'recalled'
    )
    env.recalled = false
    const pending = call('artifact.read', { id: copy.id }, new AbortController().signal)
    queueMicrotask(() => {
      env.recalled = true
    })
    await expect(pending).rejects.toThrow('recalled')
    env.recalled = false
    const plainHost = pluginHostServices(env.invocation, env.binding, 'plain', env.check)
    const plainCall = plainHost.bind(env.binding, env.view, env.view.grants, env.check)
    const plain = z
      .object({ id: z.uuid() })
      .parse(
        await plainCall(
          'artifact.write',
          { name: 'plain.txt', mimeType: 'text/plain', encoding: 'text', data: 'archived ordinary output' },
          new AbortController().signal
        )
      )
    const http = new Hono()
    http.onError((_error, c) => {
      return c.text('blocked', 409)
    })
    registerArtifactRoutes(http, env.app.coordinator, () => {
      return env.app.config
    })
    env.app.config.resources.config.plugins = []
    const url = '/api/rooms/' + env.app.room.id + '/artifacts/' + plain.id + '/content'
    expect(await (await http.request(url)).text()).toBe('archived ordinary output')
    const toolkit = createToolkit(
      env.app.config,
      env.app.room,
      env.invocation.input,
      new AbortController().signal,
      env.invocation.services,
      { trace() {}, preview() {}, provider() {}, tool() {} }
    )
    try {
      env.recalled = true
      const reader = toolkit.tools.find((tool) => {
        return tool.name === 'artifact_read'
      })!
      await expect(
        reader.execute('read', { id: copy.id }, new AbortController().signal, undefined)
      ).rejects.toThrow('recalled')
    } finally {
      await toolkit.close()
    }
  } finally {
    await env.close()
  }
})

test('service synthesis requires artifact.write declared by the operation even when the instance has it, before any POST', async () => {
  const env = await boundaryFixture()
  let posts = 0
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch() {
      posts += 1
      return Response.json({})
    }
  })
  try {
    const binding = await env.worker.register(
      'narrow',
      `export default { operations: { async echo(_input, ctx) { return await ctx.host('service:speech', { action: 'synthesize', text: 'test', voice: 'voice' }) } } }`,
      {
        connections: [{ alias: 'speech', title: 'speech', kind: 'service', service: 'gsvi@1' }],
        operations: [
          {
            id: 'echo',
            title: 'narrow',
            description: '',
            inputSchema: { type: 'object' },
            grants: ['service:speech']
          }
        ]
      }
    )
    binding.instance.grants = ['service:speech', 'artifact.write']
    binding.instance.services = { speech: 'test' }
    env.app.config.resources = new ResourceLibrary(
      ResourcesConfigSchema.parse({
        plugins: [binding.instance],
        services: [
          { id: 'test', name: 'test', kind: 'gsvi', url: 'http://127.0.0.1:' + server.port, enabled: true }
        ]
      }),
      [],
      [],
      [binding.bundle]
    )
    env.app.config.bot.plugins = env.worker.manager.config
    const service = new PluginService(() => {
      return env.app.config
    }, env.worker.manager)
    const invocation = env.app.coordinator.jobInvocation(
      env.app.room.id,
      localIdentity('mock', 'mock-bot'),
      'synth'
    )
    await expect(
      service.execute(
        { ...invocation, services: { ...env.invocation.services, authorize: invocation.authorize } },
        'plugin:narrow/echo',
        {},
        'once',
        AbortSignal.timeout(3000)
      )
    ).rejects.toThrow('未声明')
    expect(posts).toBe(0)
  } finally {
    await server.stop(true)
    await env.close()
  }
})

test('cross-plugin reads propagate sources to caller writes and subsequent MCP-produced artifacts', async () => {
  const env = await boundaryFixture()
  const mcp = mcpFixture({
    content: [
      {
        type: 'resource',
        resource: {
          uri: 'file:///authored.bin',
          mimeType: 'application/octet-stream',
          blob: Buffer.from('real upstream result').toString('base64')
        }
      }
    ]
  })
  try {
    const sourceId = crypto.randomUUID()
    const original = await new ArtifactStore(
      env.app.config.dataDir,
      env.app.room.id,
      undefined,
      undefined,
      () => {
        return { mediaIds: [sourceId], capabilities: ['media_read'] }
      }
    ).save('input.txt', 'text/plain', 'fixture', 'real input')
    const reader = await env.worker.register(
      'reader',
      `export default { operations: { async echo(input, ctx) { const read = await ctx.host('artifact.read', { id: input.id }); return { text: read.base64 } } } }`,
      {
        operations: [
          {
            id: 'echo',
            title: 'read',
            description: '',
            inputSchema: { type: 'object' },
            grants: ['artifact.read', 'media.read']
          }
        ]
      }
    )
    reader.instance.grants = ['artifact.read', 'media.read']
    const caller = await env.worker.register(
      'caller',
      `export default { operations: { async echo(input, ctx) {
      const result = await ctx.host('operation:backend/echo', { arguments: input })
      const copy = await ctx.host('artifact.write', { name: 'copy.txt', mimeType: 'text/plain', encoding: 'base64', data: result.result.text })
      const remote = await ctx.host('connector:reports', { tool: 'long-result', arguments: { query: 'bounded' } })
      return { text: 'done', artifactIds: [copy.id, ...remote.artifactIds] }
    } } }`,
      {
        operations: [
          {
            id: 'echo',
            title: 'forward',
            description: '',
            inputSchema: { type: 'object' },
            grants: ['operation:backend/echo', 'artifact.write', 'connector:reports']
          }
        ]
      }
    )
    caller.instance.grants = ['operation:backend/echo', 'artifact.write', 'connector:reports']
    caller.instance.dependencies = { backend: 'reader' }
    caller.instance.connectors = { reports: mcp.config.id }
    env.app.config.resources = new ResourceLibrary(
      ResourcesConfigSchema.parse({ plugins: [caller.instance, reader.instance], mcp: [mcp.config] }),
      [await inspectMcp(mcp.config, AbortSignal.timeout(3000))],
      [],
      [caller.bundle, reader.bundle]
    )
    env.app.config.bot.plugins = env.worker.manager.config
    const service = new PluginService(() => {
      return env.app.config
    }, env.worker.manager)
    const invocation = env.app.coordinator.jobInvocation(
      env.app.room.id,
      localIdentity('mock', 'mock-bot'),
      'chain'
    )
    const outcome = await service.execute(
      { ...invocation, services: { ...env.invocation.services, authorize: invocation.authorize } },
      'plugin:caller/echo',
      { id: original.id },
      'chain',
      AbortSignal.timeout(4000)
    )
    expect(outcome.status).toBe('done')
    if (outcome.status !== 'done') {
      throw new Error('missing chain result')
    }
    expect(outcome.result.artifactIds).toHaveLength(2)
    env.recalled = true
    for (const id of outcome.result.artifactIds) {
      const copy = await new ArtifactStore(env.app.config.dataDir, env.app.room.id).metadata(id)
      expect(copy.access?.mediaIds).toEqual([sourceId])
      expect(() => {
        assertArtifactAccess(env.app.config, copy.access!, env.invocation.services.media.require)
      }).toThrow('recalled')
    }
    expect(mcp.state.calls).toBe(1)
  } finally {
    await mcp.server.stop(true)
    await env.close()
  }
})
