import { expect, test } from 'bun:test'
import { pluginFixture } from './plugin-fixture'
import { importPlugin } from '@pi-im-bot/plugins/package'
import { join } from 'node:path'
import { untilJob } from './job-harness'

test('a failed worker cleanup can be retried and releases capacity only after successful destruction', async () => {
  const env = await pluginFixture({ maxWorkers: 1 })
  const binding = await env.register(
    'cleanup',
    `export default { operations: { echo() { return { text: 'ok' } } } }`
  )
  const destroy = env.backend.destroy.bind(env.backend)
  let attempts = 0
  env.backend.destroy = async (id, name) => {
    attempts += 1
    if (attempts === 1) {
      throw new Error('authored transient cleanup failure')
    }
    await destroy(id, name)
  }
  try {
    await env.manager.invoke(
      binding,
      { kind: 'operation', handler: 'echo', phase: 'execute' },
      env.context(binding),
      {},
      new AbortController().signal,
      async () => {
        return {}
      }
    )
    env.manager.retainInstances(new Set())
    await untilJob(() => {
      return Boolean(env.manager.status().workers[0]?.cleanupError)
    }, 'cleanup should fail once')
    expect(env.manager.status().workers).toHaveLength(1)
    env.manager.retainInstances(new Set())
    await untilJob(() => {
      return env.manager.status().workers.length === 0
    }, 'cleanup retry should release worker')
    expect(attempts).toBe(2)
    const result = await env.manager.invoke(
      binding,
      { kind: 'operation', handler: 'echo', phase: 'execute' },
      env.context(binding),
      {},
      new AbortController().signal,
      async () => {
        return {}
      }
    )
    expect(result).toMatchObject({ result: { text: 'ok' } })
  } finally {
    await env.close()
  }
})

test('plugin invocations use their bound context, do not inherit host environment, and container plans isolate code, data, network and resources', async () => {
  const env = await pluginFixture()
  const previous = process.env.PI_PLUGIN_HOST_SENTINEL
  process.env.PI_PLUGIN_HOST_SENTINEL = 'HOST_SECRET'
  try {
    const binding = await env.register(
      'echo',
      `export default { operations: { echo(input, ctx) { return { text: ctx.invocation.actors[0].id + ':' + input.text, value: { secret: process.env.PI_PLUGIN_HOST_SENTINEL ?? null } } } } }`
    )
    const result = await env.manager.invoke(
      binding,
      { kind: 'operation', handler: 'echo', phase: 'execute' },
      env.context(binding),
      { text: 'hello' },
      new AbortController().signal,
      async () => {
        throw new Error('No host grant')
      }
    )
    expect(result).toEqual({
      status: 'done',
      result: { text: 'alice:hello', artifactIds: [], value: { secret: null } }
    })
    const spec = [...env.backend.specifications.values()][0]
    expect(spec.HostConfig.NetworkMode).toBe('none')
    expect(spec.HostConfig.Privileged).toBe(false)
    expect(spec.HostConfig.ReadonlyRootfs).toBe(true)
    expect(spec.HostConfig.CapDrop).toEqual(['ALL'])
    expect(
      spec.HostConfig.Mounts.map((mount) => {
        return mount.Target
      })
    ).toEqual(['/plugin', '/data', '/rpc', '/runner'])
    expect(
      spec.HostConfig.Mounts.filter((mount) => {
        return !mount.ReadOnly
      })
    ).toHaveLength(0)
    expect(
      spec.HostConfig.Mounts.find((mount) => {
        return mount.Target === '/data'
      })?.BindOptions?.ReadOnlyNonRecursive
    ).toBe(true)
    expect(spec.Env.join('\n')).not.toContain('HOST_SECRET')
    expect(JSON.stringify(spec)).not.toContain('/var/run/docker.sock')
  } finally {
    if (previous === undefined) {
      delete process.env.PI_PLUGIN_HOST_SENTINEL
    } else {
      process.env.PI_PLUGIN_HOST_SENTINEL = previous
    }
    await env.close()
  }
})

test('a stuck plugin is terminated without blocking another plugin, and RPC capabilities do not use plugin-supplied actor identities', async () => {
  const env = await pluginFixture()
  try {
    const blocked = await env.register(
      'blocked',
      `export default { operations: { echo() { while (true) {} } } }`
    )
    const normal = await env.register(
      'normal',
      `export default { operations: { async echo(input, ctx) {
        const result = await ctx.host('who', { actorId: 'admin' })
        return { text: result.actor }
      } } }`
    )
    const controller = new AbortController()
    const stuck = env.manager.invoke(
      blocked,
      { kind: 'operation', handler: 'echo', phase: 'execute' },
      env.context(blocked, 1500),
      {},
      controller.signal,
      async () => {
        return {}
      }
    )
    void stuck.catch(() => {})
    const context = env.context(normal)
    const result = await env.manager.invoke(
      normal,
      { kind: 'operation', handler: 'echo', phase: 'execute' },
      context,
      {},
      new AbortController().signal,
      async (_method, _params) => {
        return { actor: context.actors[0].id }
      }
    )
    expect(result).toMatchObject({ result: { text: 'alice' } })
    await expect(stuck).rejects.toThrow()
    await env.backend.stoppedWorker.promise
    expect(env.backend.stopped).toHaveLength(1)
    const again = await env.manager.invoke(
      normal,
      { kind: 'operation', handler: 'echo', phase: 'execute' },
      env.context(normal),
      {},
      new AbortController().signal,
      async () => {
        return { actor: 'bob' }
      }
    )
    expect(again).toMatchObject({ result: { text: 'bob' } })
  } finally {
    await env.close()
  }
})

test('plugin data is shared by group members, isolated between groups and instances, and retained across code generations', async () => {
  const env = await pluginFixture({ maxWorkers: 4 })
  try {
    const create = env.backend.create.bind(env.backend)
    env.backend.create = async (name, spec) => {
      const data = spec.HostConfig.Mounts.find((mount) => {
        return mount.Target === '/data'
      })!.Source
      for (const [previousName, previous] of env.backend.specifications) {
        if (
          previous.HostConfig.Mounts.some((mount) => {
            return mount.Target === '/data' && mount.Source === data
          })
        ) {
          expect(env.backend.stopped).toContain(previousName)
        }
      }
      return create(name, spec)
    }
    const source = `export default { operations: { async echo() {
      const file = Bun.file('counter.txt')
      let count = 0
      if (await file.exists()) { count = Number(await file.text()) }
      count += 1
      await Bun.write(file, String(count))
      return { value: count }
    } } }`
    const binding = await env.register('counter', source)
    async function invoke(target: typeof binding, group: string, actor = 'alice') {
      const context = env.context(target)
      context.scope.id = group
      context.scope.address.chatId = group
      context.actors[0].id = actor
      return env.manager.invoke(
        target,
        { kind: 'operation', handler: 'echo', phase: 'execute' },
        context,
        {},
        new AbortController().signal,
        async () => {
          throw new Error('No grant')
        }
      )
    }
    expect(await invoke(binding, 'group-a')).toMatchObject({ result: { value: 1 } })
    expect(await invoke(binding, 'group-a', 'bob')).toMatchObject({ result: { value: 2 } })
    expect(await invoke(binding, 'group-b')).toMatchObject({ result: { value: 1 } })
    await Bun.write(join(binding.instance.sourceDir, 'main.mjs'), source + '\n// generation 2')
    const bundle = await importPlugin(binding.instance, env.root, env.manager.paths.packageDir)
    expect(bundle.revision).not.toBe(binding.bundle.revision)
    expect(await invoke({ ...binding, bundle }, 'group-a')).toMatchObject({ result: { value: 3 } })
    const other = await env.register('other', source)
    expect(await invoke(other, 'group-a')).toMatchObject({ result: { value: 1 } })
  } finally {
    await env.close()
  }
})

test('timeout returns before slow container cleanup, while the unreclaimed worker retains its resource slot', async () => {
  const env = await pluginFixture({ maxWorkers: 1 })
  const cleanup = Promise.withResolvers<void>()
  const cleanupStarted = Promise.withResolvers<void>()
  const destroy = env.backend.destroy.bind(env.backend)
  let destroyed = false
  env.backend.destroy = async (id, name) => {
    cleanupStarted.resolve()
    await cleanup.promise
    await destroy(id, name)
    destroyed = true
  }
  try {
    const binding = await env.register(
      'blocked',
      `export default { operations: { echo() { while (true) {} } } }`
    )
    await expect(
      env.manager.invoke(
        binding,
        { kind: 'operation', handler: 'echo', phase: 'execute' },
        env.context(binding, 300),
        {},
        new AbortController().signal,
        async () => {
          return {}
        }
      )
    ).rejects.toThrow()
    await cleanupStarted.promise
    expect(destroyed).toBe(false)
    expect(env.manager.status().workers).toHaveLength(1)
    expect(env.manager.status().workers[0].stopping).toBe(true)
    expect(env.manager.status().invocations).toBe(0)
  } finally {
    cleanup.resolve()
    await env.close()
  }
})
