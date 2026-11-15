import { expect, test } from 'bun:test'
import { z } from 'zod'
import { join } from 'node:path'
import { pluginFixture } from './plugin-fixture'
import { jobHarness, untilJob } from './job-harness'
import { responsesReply } from './responses-fixture'
import { ResourceLibrary } from '@pi-im-bot/resources/library'
import { ResourcesConfigSchema } from '@pi-im-bot/resources/schema'
import { PluginService } from '@pi-im-bot/plugins/service'
import { PluginWorkerManager } from '@pi-im-bot/plugins/runtime/manager'
import { pluginToolName } from '@pi-im-bot/plugins/identity'
import { localIdentity } from '@pi-im-bot/permissions/identity'
import { importPlugin } from '@pi-im-bot/plugins/package'
import { mcpFixture } from './mcp-fixture'
import { inspectMcp } from '@pi-im-bot/resources/mcp/client'

test('plugin commands and Pi tools share execution and scoped artifacts, honor member authority, and stop without a late reply', async () => {
  const env = await pluginFixture()
  const binding = await env.register(
    'work',
    `export default { operations: {
    async echo(input, ctx) {
      const result = await ctx.host('artifact.write', { name: 'answer.txt', mimeType: 'text/plain', encoding: 'text', data: input.text })
      return { text: ctx.invocation.actors[0].id + ':' + input.text, value: { voice: ctx.invocation.settings.voice }, artifactIds: [result.id] }
    },
    async slow() { await new Promise((resolve) => { setTimeout(resolve, 5000) })
 return { text: 'LATE_PLUGIN_RESULT' } }
  } }`,
    {
      operations: [
        {
          id: 'echo',
          title: 'Echo',
          description: 'Echo',
          inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
          grants: ['artifact.write']
        },
        { id: 'slow', title: 'Slow', description: 'Slow', inputSchema: { type: 'object' } }
      ],
      commands: [
        { id: 'echo', names: ['echo'], operation: 'echo', description: 'Echo command' },
        { id: 'slow', names: ['slow'], operation: 'slow', description: 'Slow command', arguments: 'none' }
      ]
    }
  )
  binding.instance.grants = ['artifact.write']
  const library = new ResourceLibrary(
    ResourcesConfigSchema.parse({ plugins: [binding.instance] }),
    [],
    [],
    [binding.bundle]
  )
  const app = await jobHarness(
    (_raw, call) => {
      if (call === 1) {
        return responsesReply({
          kind: 'tool',
          name: pluginToolName('work', 'echo'),
          arguments: { text: 'from-tool' }
        })
      }
      return responsesReply({ kind: 'text', text: 'MODEL_FINISHED' })
    },
    library,
    (coordinator, config) => {
      config.bot.plugins = env.manager.config
      coordinator.plugins = new PluginService(() => {
        return config
      }, env.manager)
    }
  )
  try {
    const roomId = app.room.id
    app.config.framework.defaults.extensions.settings = { work: { voice: 'default-voice' } }
    app.store.saveRoom({
      ...app.coordinator.requireRoom(roomId),
      settings: { extensions: { settings: { work: { voice: 'group-voice' } } } }
    })
    app.config.framework.defaults.behavior.agentEnabled = false
    await app.coordinator.receive(roomId, '/echo command-value', 'alice', 'Alice')
    const reply = app.store.listMessages(roomId, 20).find((message) => {
      return message.text.startsWith('alice:command-value')
    })
    expect(reply?.attachments).toHaveLength(1)
    expect(reply?.text).toContain('group-voice')
    expect(reply?.text).not.toContain('default-voice')
    expect(app.requests).toHaveLength(0)
    app.config.framework.defaults.permissions.rules = [
      { effect: 'deny', capabilities: ['plugin:work/*'], subjects: [{ kind: 'mock' }] }
    ]
    await app.coordinator.receive(roomId, '/echo denied-value', 'bob', 'Bob')
    expect(
      app.store.listMessages(roomId, 20).some((message) => {
        return message.text === 'bob:denied-value'
      })
    ).toBe(false)
    app.config.framework.defaults.permissions.rules = []
    app.config.framework.defaults.behavior.agentEnabled = true
    const run = await app.coordinator.receive(roomId, 'use the plugin', 'bob', 'Bob')
    expect((await app.coordinator.waitRun(run!.id)).status).toBe('completed')
    expect(app.requests[1]).toContain('bob:from-tool')
    expect(app.requests[0]).toContain(pluginToolName('work', 'echo'))
    const pending = app.coordinator.receive(roomId, '/slow', 'alice', 'Alice')
    await untilJob(() => {
      return env.manager.status().workers.some((worker) => {
        return worker.busy
      })
    }, 'command did not start')
    await app.coordinator.receive(roomId, '/stop', 'bob', 'Bob')
    await pending
    expect(
      app.store.listMessages(roomId, 40).some((message) => {
        return message.text.includes('LATE_PLUGIN_RESULT')
      })
    ).toBe(false)
  } finally {
    await app.close()
    await env.close()
  }
})

test('plugin jobs release the root, persist opaque handles, resume pinned code after restart, and never resubmit on unknown cancellation', async () => {
  const env = await pluginFixture()
  const source = `
    async function count(key) {
      const file = Bun.file('counts.json')
      let counts = { starts: 0, polls: 0, cancels: 0 }
      if (await file.exists()) { counts = await file.json() }
      counts[key] += 1
      await Bun.write(file, JSON.stringify(counts))
    }
    export default { operations: {
      async echo(input) { await count('starts')
 return { status: 'pending', handle: { secret: 'PRIVATE_TASK_TICKET', due: Date.now() + input.waitMs, unknownCancel: input.unknownCancel ?? false }, pollAfterMs: 250 } },
      async poll(input) { await count('polls')
 if (Date.now() < input.handle.due) { return { status: 'pending', handle: input.handle, pollAfterMs: 250 } }
 return { text: 'PINNED_VERSION_RESULT' } },
      async cancel(input) { await count('cancels')
 if (input.handle.unknownCancel) { throw new Error('cancel response missing') }
 return { status: 'cancelled' } }
    } }
  `
  const binding = await env.register('jobwork', source, {
    operations: [
      {
        id: 'echo',
        title: 'Plugin job',
        description: 'Async fixture',
        inputSchema: {
          type: 'object',
          properties: { waitMs: { type: 'number' }, unknownCancel: { type: 'boolean' } },
          required: ['waitMs']
        },
        execution: 'background',
        poll: 'poll',
        cancel: 'cancel'
      }
    ],
    commands: [
      {
        id: 'start',
        names: ['pluginjob'],
        operation: 'echo',
        description: 'Start fixture',
        arguments: 'json'
      }
    ]
  })
  const resources = new ResourceLibrary(
    ResourcesConfigSchema.parse({ plugins: [binding.instance] }),
    [],
    [],
    [binding.bundle]
  )
  let manager = env.manager
  const app = await jobHarness(
    () => {
      return responsesReply({ kind: 'text', text: 'FAST_ROOT_ANSWER' })
    },
    resources,
    (coordinator, config) => {
      config.bot.plugins = manager.config
      coordinator.plugins = new PluginService(() => {
        return config
      }, manager)
    }
  )
  async function counts() {
    const spec = [...env.backend.specifications.values()].find((spec) => {
      return spec.Labels['io.pi-im.plugin-instance'] === 'jobwork'
    })!
    const path = spec.HostConfig.Mounts.find((mount) => {
      return mount.Target === '/data'
    })!.Source
    return z
      .object({ starts: z.number(), polls: z.number(), cancels: z.number() })
      .parse(await Bun.file(join(path, 'files', 'counts.json')).json())
  }
  try {
    await app.coordinator.receive(app.room.id, '/pluginjob {"waitMs":1600}')
    await untilJob(async () => {
      return (await app.jobs.repository.list(app.room.id))[0]?.external?.hasReceipt === true
    }, 'plugin receipt missing')
    const first = (await app.jobs.repository.list(app.room.id))[0]
    expect(JSON.stringify(first)).not.toContain('PRIVATE_TASK_TICKET')
    const quick = await app.coordinator.receive(app.room.id, 'quick question', 'bob', 'Bob')
    expect((await app.coordinator.waitRun(quick!.id)).status).toBe('completed')
    expect((await app.jobs.repository.get(first.id)).revisions['1'].state).toBe('waiting_external')
    await Bun.write(
      join(binding.instance.sourceDir, 'main.mjs'),
      source.replaceAll('PINNED_VERSION_RESULT', 'NEW_VERSION_RESULT')
    )
    const newer = await importPlugin(binding.instance, env.root, manager.paths.packageDir)
    app.config.resources = new ResourceLibrary(
      {
        ...resources.config,
        plugins: [{ ...binding.instance, sourceDir: join(env.root, 'not-imported-yet') }]
      },
      [],
      [],
      [newer]
    )
    expect(app.config.resources.pluginPackage(binding.instance.id)).toBeUndefined()
    await app.restart(async () => {
      await manager.close()
      manager = new PluginWorkerManager(env.root, env.manager.config, env.backend, env.root, env.volumes)
      await manager.start()
    })
    await untilJob(async () => {
      return (await app.jobs.repository.get(first.id)).revisions['1'].delivery === 'sent'
    }, 'plugin result not delivered after restart')
    expect((await counts()).starts).toBe(1)
    app.config.resources = new ResourceLibrary(resources.config, [], [], [newer])
    const messages = app.store.listMessages(app.room.id, 30)
    expect(
      messages.filter((message) => {
        return message.text.includes('PINNED_VERSION_RESULT')
      })
    ).toHaveLength(1)
    expect(
      messages.some((message) => {
        return message.text.includes('NEW_VERSION_RESULT') || message.text.includes('PRIVATE_TASK_TICKET')
      })
    ).toBe(false)
    const identity = localIdentity('mock', 'bot', 'alice', 'Alice')
    const invocation = app.coordinator.jobInvocation(app.room.id, identity, 'start cancellable')
    const second = await app.jobs
      .forInvocation(invocation)
      .operation('Unknown cancel', 'plugin:jobwork/echo', { waitMs: 10000, unknownCancel: true }, 'second')
    await untilJob(async () => {
      return (await app.jobs.repository.get(second.id)).revisions['1'].external?.hasReceipt === true
    }, 'second receipt missing')
    await app.jobs.cancel(second.id, app.room.id)
    await untilJob(async () => {
      return (await app.jobs.repository.get(second.id)).revisions['1'].state === 'outcome_unknown'
    }, 'cancel did not settle')
    const cancelled = (await app.jobs.repository.get(second.id)).revisions['1']
    expect(cancelled.state).toBe('outcome_unknown')
    expect(cancelled.delivery).toBe('suppressed')
    expect((await counts()).cancels).toBe(1)
    await app.jobs.reconcile(second.id, app.room.id, false)
    expect((await counts()).starts).toBe(2)
    expect((await counts()).cancels).toBe(1)
    const third = await app.jobs
      .forInvocation(invocation)
      .operation('Confirmed cancel', 'plugin:jobwork/echo', { waitMs: 10000 }, 'third')
    await untilJob(async () => {
      return (await app.jobs.repository.get(third.id)).revisions['1'].external?.hasReceipt === true
    }, 'third receipt missing')
    await app.jobs.cancel(third.id, app.room.id)
    await untilJob(async () => {
      return (await app.jobs.repository.get(third.id)).revisions['1'].state === 'cancelled'
    }, 'confirmed cancellation did not settle')
    expect((await counts()).cancels).toBe(2)
  } finally {
    await app.close()
    await manager.close()
    await env.close()
  }
})

test('a plugin interrupted after dispatch is reported unknown on recovery without running its side effect again', async () => {
  const env = await pluginFixture()
  const binding = await env.register(
    'uncertain',
    `export default { operations: { async echo() {
    const file = Bun.file('starts.txt')
    let count = 0
    if (await file.exists()) { count = Number(await file.text()) }
    await Bun.write(file, String(count + 1))
    await new Promise(() => {})
  } } }`,
    {
      operations: [
        {
          id: 'echo',
          title: 'Uncertain',
          description: 'Interrupted fixture',
          inputSchema: { type: 'object' },
          execution: 'background',
          timeoutMs: 30000
        }
      ]
    }
  )
  const resources = new ResourceLibrary(
    ResourcesConfigSchema.parse({ plugins: [binding.instance] }),
    [],
    [],
    [binding.bundle]
  )
  let manager = env.manager
  const app = await jobHarness(
    () => {
      return responsesReply({ kind: 'text', text: 'unused' })
    },
    resources,
    (coordinator, config) => {
      config.bot.plugins = manager.config
      coordinator.plugins = new PluginService(() => {
        return config
      }, manager)
    }
  )
  try {
    const invocation = app.coordinator.jobInvocation(app.room.id, localIdentity('mock', 'bot'), 'start')
    const job = await app.jobs
      .forInvocation(invocation)
      .operation('Uncertain', 'plugin:uncertain/echo', {}, 'dispatch-once')
    let path = ''
    await untilJob(async () => {
      const spec = [...env.backend.specifications.values()][0]
      if (!spec) {
        return false
      }
      path = join(
        spec.HostConfig.Mounts.find((mount) => {
          return mount.Target === '/data'
        })!.Source,
        'files',
        'starts.txt'
      )
      return Bun.file(path).exists()
    }, 'plugin never dispatched')
    await app.restart(async () => {
      await manager.close()
      manager = new PluginWorkerManager(env.root, env.manager.config, env.backend, env.root, env.volumes)
      await manager.start()
    })
    await untilJob(async () => {
      return (await app.jobs.repository.get(job.id)).revisions['1'].state === 'outcome_unknown'
    }, 'recovery did not report uncertainty')
    expect(await Bun.file(path).text()).toBe('1')
    expect(app.requests).toHaveLength(0)
    await expect(app.jobs.reconcile(job.id, app.room.id, false)).rejects.toThrow()
    expect(await Bun.file(path).text()).toBe('1')
  } finally {
    await app.close()
    await manager.close()
    await env.close()
  }
})

test('a plugin can use only its mapped MCP connector under the triggering member ceiling without receiving service credentials', async () => {
  const env = await pluginFixture()
  const mcp = mcpFixture({ content: [{ type: 'text', text: 'CONNECTOR_RESULT' }] })
  const binding = await env.register(
    'bridge',
    `export default { operations: { async echo(input, ctx) {
    const result = await ctx.host('connector:reports', { tool: 'long-result', arguments: { query: input.text } })
    return { text: result.text, value: { settings: ctx.invocation.settings }, artifactIds: result.artifactIds }
  } } }`,
    {
      operations: [
        {
          id: 'echo',
          title: 'Bridge',
          description: 'Connector fixture',
          inputSchema: { type: 'object' },
          grants: ['connector:reports']
        }
      ],
      commands: [{ id: 'bridge', names: ['bridge'], operation: 'echo', description: 'Call connector' }]
    }
  )
  binding.instance.connectors = { reports: mcp.config.id }
  binding.instance.grants = ['connector:reports']
  const manifest = await inspectMcp(mcp.config, new AbortController().signal)
  const resources = new ResourceLibrary(
    ResourcesConfigSchema.parse({ plugins: [binding.instance], mcp: [mcp.config] }),
    [manifest],
    [],
    [binding.bundle]
  )
  const app = await jobHarness(
    () => {
      return responsesReply({ kind: 'text', text: 'unused' })
    },
    resources,
    (coordinator, config) => {
      config.bot.plugins = env.manager.config
      coordinator.plugins = new PluginService(() => {
        return config
      }, env.manager)
    }
  )
  try {
    await app.coordinator.receive(app.room.id, '/bridge query')
    const messages = JSON.stringify(app.store.listMessages(app.room.id))
    expect(messages).toContain('CONNECTOR_RESULT')
    expect(messages).not.toContain('fixture-secret')
    expect(messages).not.toContain('fixture-url-secret')
    expect(mcp.state.calls).toBe(1)
    app.config.framework.defaults.permissions.rules = [
      { effect: 'deny', capabilities: ['mcp:reports/*'], subjects: [{ kind: 'everyone' }] }
    ]
    await app.coordinator.receive(app.room.id, '/bridge forbidden')
    expect(mcp.state.calls).toBe(1)
    app.config.framework.defaults.permissions.rules = []
    app.config.resources = new ResourceLibrary(
      { ...resources.config, plugins: [{ ...binding.instance, connectors: {} }] },
      [manifest],
      [],
      [binding.bundle]
    )
    await app.coordinator.receive(app.room.id, '/bridge unmapped')
    expect(mcp.state.calls).toBe(1)
  } finally {
    await app.close()
    await mcp.server.stop(true)
    await env.close()
  }
})
