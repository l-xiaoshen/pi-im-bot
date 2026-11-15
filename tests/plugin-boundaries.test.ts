import { expect, test } from 'bun:test'
import { z } from 'zod'
import { connect } from 'node:net'
import { join } from 'node:path'
import { pluginFixture } from './plugin-fixture'
import { PluginHostServices } from '@pi-im-bot/plugins/rpc/services'
import { workerScopeKey } from '@pi-im-bot/plugins/runtime/container-spec'
import { PluginFrameReader, encodePluginFrame, maximumPluginFrameBytes } from '@pi-im-bot/plugins/rpc/codec'
import { PluginPeer } from '@pi-im-bot/plugins/rpc/peer'

const action = { kind: 'operation', handler: 'echo', phase: 'execute' } as const
const noHost = async () => {
  throw new Error('No host service')
}

test('RPC services intersect declared grants, instance grants and live authority; parameters cannot select another room or actor', async () => {
  const env = await pluginFixture()
  try {
    const binding = await env.register(
      'reader',
      `export default { operations: {
      async echo(input, ctx) { return { value: await ctx.host('history', input) } }
    } }`
    )
    binding.instance.grants = ['history.read']
    const context = env.context(binding)
    context.grants = ['history.read', 'storage.write']
    const services = new PluginHostServices()
    let allowed = true
    let calls = 0
    services.register(
      'history',
      'history.read',
      z.object({ limit: z.number().int().min(1).max(10) }).strict(),
      async (_input, call) => {
        calls += 1
        return { room: call.invocation.scope.id, actor: call.invocation.actors[0].id }
      }
    )
    function authorize() {
      if (!allowed) {
        throw new Error('revoked')
      }
    }
    const host = services.bind(binding, context, ['history.read'], authorize)
    const result = await env.manager.invoke(
      binding,
      action,
      context,
      { limit: 1 },
      new AbortController().signal,
      host
    )
    expect(result).toMatchObject({ result: { value: { room: 'room', actor: 'alice' } } })
    context.actors[0].id = 'later-mutation'
    const forged = env.manager.invoke(
      binding,
      action,
      { ...context, id: crypto.randomUUID() },
      { limit: 1, actorId: 'admin', roomId: 'other' },
      new AbortController().signal,
      host
    )
    await expect(forged).rejects.toThrow()
    expect(calls).toBe(1)
    allowed = false
    await expect(host('history', { limit: 1 }, new AbortController().signal)).rejects.toThrow('revoked')
    allowed = true
    const undeclared = services.bind(binding, context, [], authorize)
    await expect(undeclared('history', { limit: 1 }, new AbortController().signal)).rejects.toThrow('未获准')
    const unchanged = await host('history', { limit: 1 }, new AbortController().signal)
    expect(unchanged).toMatchObject({ actor: 'alice' })
    const aborted = new AbortController()
    aborted.abort()
    await expect(host('history', { limit: 1 }, aborted.signal)).rejects.toThrow()
    expect(calls).toBe(2)
  } finally {
    await env.close()
  }
})

test('two occupied workers making nested calls fail promptly instead of waiting for each other', async () => {
  const env = await pluginFixture()
  try {
    const source = `export default { operations: { async echo(input, ctx) { return { value: await ctx.host('nested') } } } }`
    const first = await env.register('first', source)
    const second = await env.register('second', source)
    const gate = Promise.withResolvers<void>()
    let arrived = 0
    const started = performance.now()
    const work = [first, second].map((binding, index) => {
      const target = [second, first][index]
      const context = env.context(binding, 4000)
      return env.manager.invoke(
        binding,
        action,
        context,
        {},
        new AbortController().signal,
        async (_name, _params, signal) => {
          arrived += 1
          if (arrived === 2) {
            gate.resolve()
          }
          await gate.promise
          return env.manager.invoke(target, action, env.context(target), {}, signal, noHost, [
            workerScopeKey(binding.instance.id, binding.bundle.revision, context.scope.id)
          ])
        }
      )
    })
    const results = await Promise.allSettled(work)
    expect(
      results.every((result) => {
        return result.status === 'rejected'
      })
    ).toBe(true)
    expect(
      results
        .map((result) => {
          if (result.status === 'rejected') {
            return String(result.reason)
          }
          return ''
        })
        .join('\n')
    ).toContain('未持锁等待')
    expect(performance.now() - started).toBeLessThan(1500)
  } finally {
    await env.close()
  }
})

test('admission is bounded while a worker is occupied and cancellation frees its capacity', async () => {
  const env = await pluginFixture({ maxWorkers: 1, maxPending: 0 })
  try {
    const binding = await env.register(
      'holding',
      `export default { operations: { async echo(input, ctx) { return { value: await ctx.host('hold') } } } }`
    )
    const entered = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const controller = new AbortController()
    const current = env.manager.invoke(
      binding,
      action,
      env.context(binding),
      {},
      controller.signal,
      async () => {
        entered.resolve()
        await release.promise
        return {}
      }
    )
    void current.catch(() => {})
    await entered.promise
    await expect(
      env.manager.invoke(binding, action, env.context(binding), {}, new AbortController().signal, noHost)
    ).rejects.toThrow('队列已满')
    controller.abort(new Error('stop'))
    await expect(current).rejects.toThrow()
    release.resolve()
    expect(env.manager.status().invocations).toBe(0)
  } finally {
    await env.close()
  }
})

test('oversized plugin results and raw frame lengths are rejected without stalling another worker', async () => {
  const env = await pluginFixture()
  try {
    const large = await env.register(
      'large',
      `export default { operations: { echo() { return { value: 'x'.repeat(600000) } } } }`
    )
    await expect(
      env.manager.invoke(large, action, env.context(large), {}, new AbortController().signal, noHost)
    ).rejects.toThrow('512 KiB')
    const malformed = await env.register(
      'malformed',
      `
      import { connect } from 'node:net'
      const socket = connect(process.env.BOT_PLUGIN_RPC)
      function send(value) {
        const body = Buffer.from(JSON.stringify(value))
        const header = Buffer.alloc(4)
        header.writeUInt32BE(body.length)
        socket.write(Buffer.concat([header, body]))
      }
      socket.on('connect', () => {
        send({ type: 'hello', token: process.env.BOT_PLUGIN_TOKEN })
        send({ type: 'ready' })
      })
      socket.on('data', () => {
        const header = Buffer.alloc(4)
        header.writeUInt32BE(2147483647)
        socket.write(header)
      })
      await new Promise(() => {})
      export default {}
    `
    )
    await expect(
      env.manager.invoke(malformed, action, env.context(malformed), {}, new AbortController().signal, noHost)
    ).rejects.toThrow('帧长度')
    const normal = await env.register(
      'normal',
      `export default { operations: { echo() { return { text: 'still available' } } } }`
    )
    const result = await env.manager.invoke(
      normal,
      action,
      env.context(normal),
      {},
      new AbortController().signal,
      noHost
    )
    expect(result).toMatchObject({ result: { text: 'still available' } })
    const values: unknown[] = []
    const reader = new PluginFrameReader()
    const packet = Buffer.concat([encodePluginFrame({ one: 1 }), encodePluginFrame({ two: 2 })])
    for (const byte of packet) {
      reader.feed(Uint8Array.of(byte), (value) => {
        values.push(value)
      })
    }
    expect(values).toEqual([{ one: 1 }, { two: 2 }])
    const header = Buffer.alloc(4)
    header.writeUInt32BE(maximumPluginFrameBytes + 1)
    expect(() => {
      reader.feed(header, () => {})
    }).toThrow('帧长度')
  } finally {
    await env.close()
  }
})

test('an unauthenticated socket cannot terminate the authenticated worker channel', async () => {
  const env = await pluginFixture()
  const faults: Error[] = []
  const path = join(env.root, 'auth.sock')
  const token = crypto.randomUUID()
  const peer = new PluginPeer(path, token, 10, (error) => {
    faults.push(error)
  })
  const sockets: ReturnType<typeof connect>[] = []
  try {
    await peer.listen()
    const valid = connect(path)
    sockets.push(valid)
    await new Promise<void>((resolve) => {
      valid.once('connect', resolve)
    })
    valid.write(
      Buffer.concat([encodePluginFrame({ type: 'hello', token }), encodePluginFrame({ type: 'ready' })])
    )
    await peer.ready(AbortSignal.timeout(1000))
    const invalid = connect(path)
    sockets.push(invalid)
    await new Promise<void>((resolve) => {
      invalid.once('connect', resolve)
    })
    const closed = new Promise<void>((resolve) => {
      invalid.once('close', () => {
        resolve()
      })
    })
    invalid.write(encodePluginFrame({ type: 'hello', token: crypto.randomUUID() }))
    await closed
    expect(faults).toHaveLength(0)
    expect(valid.destroyed).toBe(false)
  } finally {
    await peer.close()
    for (const socket of sockets) {
      socket.destroy()
    }
    await env.close()
  }
})
