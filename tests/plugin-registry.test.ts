import { expect, test } from 'bun:test'
import { PluginHookSchema } from '@pi-im-bot/plugins/manifest'
import { orderHooks, type OrderedHook } from '@pi-im-bot/plugins/hooks/order'
import { applyHookPatch } from '@pi-im-bot/plugins/hooks/patch'
import { revision } from '@pi-im-bot/settings/resolve'
import { z } from 'zod'
import { pluginFixture } from './plugin-fixture'
import { PluginRegistry } from '@pi-im-bot/plugins/registry'
import { PluginOverridesSchema } from '@pi-im-bot/plugins/config'
import { transformPluginPoint, type PluginHookTrace } from '@pi-im-bot/plugins/hooks/transform'

function hook(
  key: string,
  priority: number,
  options: Partial<ReturnType<typeof PluginHookSchema.parse>> = {}
): OrderedHook {
  return {
    key,
    instanceId: key.split('/')[0],
    generation: '1',
    priority,
    hook: PluginHookSchema.parse({
      id: key.split('/')[1],
      point: 'delivery.text@1',
      mode: 'transform',
      ...options
    })
  }
}
test('shared extension points honor dependency order before priority, reject cycles and missing requirements, and keep ties stable', () => {
  const input = [
    hook('voice/render', 100, { after: ['clean/trim'], requires: ['clean/trim'] }),
    hook('clean/trim', 0),
    hook('other/first', 50)
  ]
  expect(
    orderHooks(input).map((entry) => {
      return entry.key
    })
  ).toEqual(['other/first', 'clean/trim', 'voice/render'])
  expect(
    orderHooks([hook('b/item', 0), hook('a/item', 0)]).map((entry) => {
      return entry.key
    })
  ).toEqual(['a/item', 'b/item'])
  expect(() => {
    orderHooks([hook('a/item', 0, { requires: ['missing/item'] })])
  }).toThrow('缺少')
  expect(() => {
    orderHooks([hook('a/item', 0, { after: ['b/item'] }), hook('b/item', 0, { after: ['a/item'] })])
  }).toThrow('环路')
})

test('hook patches do not mutate prior data and cannot write delivery destinations, stale revisions, or prototype paths', () => {
  const original = { text: 'before', roomId: 'room', options: { voice: 'first' } }
  const baseRevision = revision(original)
  const result = applyHookPatch(
    original,
    { baseRevision, patch: [{ op: 'set', path: '/text', value: 'after' }] },
    ['/text']
  )
  expect(result).toMatchObject({ text: 'after', roomId: 'room' })
  expect(original.text).toBe('before')
  expect(() => {
    applyHookPatch(original, { baseRevision, patch: [{ op: 'set', path: '/roomId', value: 'other' }] }, [
      '/text'
    ])
  }).toThrow('可写字段')
  expect(() => {
    applyHookPatch(original, { baseRevision: 'old', patch: [] }, ['/text'])
  }).toThrow('过期')
  expect(() => {
    applyHookPatch(
      original,
      { baseRevision, patch: [{ op: 'set', path: '/options/__proto__/admin', value: true }] },
      ['/options']
    )
  }).toThrow('不可写')
})

test('array deletion cannot shift unwritable siblings and escaped pointer segments stay within their exact field', () => {
  const original = { items: ['editable', 'protected'], options: { 'a/b': 'before', other: 'protected' } }
  const baseRevision = revision(original)
  expect(() => {
    applyHookPatch(original, { baseRevision, patch: [{ op: 'remove', path: '/items/0' }] }, ['/items/0'])
  }).toThrow('整个数组')
  expect(
    applyHookPatch(original, { baseRevision, patch: [{ op: 'remove', path: '/items/0' }] }, ['/items'])
  ).toMatchObject({ items: ['protected'] })
  expect(
    applyHookPatch(
      original,
      { baseRevision, patch: [{ op: 'set', path: '/options/a~1b', value: 'after' }] },
      ['/options/a~1b']
    )
  ).toMatchObject({ options: { 'a/b': 'after', other: 'protected' } })
  expect(() => {
    applyHookPatch(
      original,
      { baseRevision, patch: [{ op: 'set', path: '/options/a~2b', value: 'after' }] },
      ['/options']
    )
  }).toThrow('JSON Pointer')
  expect(original.items).toEqual(['editable', 'protected'])
})

test('real hook workers compose ordered snapshots; wrong types, forbidden writes and failed dependencies leave the last valid data intact', async () => {
  const env = await pluginFixture()
  try {
    function source(changes: string) {
      return `export default { hooks: { change(input, ctx) { return { baseRevision: ctx.invocation.inputRevision, patch: ${changes} } } } }`
    }
    const first = await env.register(
      'first',
      source(`[{ op: 'set', path: '/text', value: input.text.trim() }]`),
      { hooks: [{ id: 'change', point: 'delivery.text@1', mode: 'transform', priority: 100 }] }
    )
    const forbidden = await env.register(
      'forbidden',
      source(
        `[{ op: 'set', path: '/text', value: 'partial change' }, { op: 'set', path: '/roomId', value: 'other' }]`
      ),
      { hooks: [{ id: 'change', point: 'delivery.text@1', mode: 'transform', priority: 90 }] }
    )
    const wrongType = await env.register('wrongtype', source(`[{ op: 'set', path: '/text', value: 42 }]`), {
      hooks: [{ id: 'change', point: 'delivery.text@1', mode: 'transform', priority: 80 }]
    })
    const dependent = await env.register(
      'dependent',
      source(`[{ op: 'set', path: '/text', value: 'must not run' }]`),
      {
        hooks: [
          {
            id: 'change',
            point: 'delivery.text@1',
            mode: 'transform',
            priority: 70,
            requires: ['forbidden/change']
          }
        ]
      }
    )
    const last = await env.register(
      'last',
      source(`[{ op: 'set', path: '/text', value: input.text + '!' }]`),
      { hooks: [{ id: 'change', point: 'delivery.text@1', mode: 'transform', priority: 0 }] }
    )
    const registry = new PluginRegistry(
      [last, forbidden, wrongType, dependent, first],
      PluginOverridesSchema.parse({})
    )
    const original = { text: ' hello ', roomId: 'room' }
    const traces: PluginHookTrace[] = []
    const result = await transformPluginPoint({
      registry,
      point: 'delivery.text@1',
      selector: { channel: 'mock', origin: 'im', phase: 'final' },
      value: original,
      schema: z.object({ text: z.string(), roomId: z.string() }).strict(),
      signal: new AbortController().signal,
      async invoke(handler, value, inputRevision, signal) {
        const binding = registry.bindings.get(handler.instanceId)!
        const context = { ...env.context(binding), inputRevision }
        return env.manager.invoke(
          binding,
          { kind: 'hook', handler: handler.hook.id, phase: 'execute' },
          context,
          value,
          signal,
          async () => {
            throw new Error('No grant')
          }
        )
      },
      report(trace) {
        traces.push(trace)
      }
    })
    expect(result).toEqual({ text: 'hello!', roomId: 'room' })
    expect(original.text).toBe(' hello ')
    expect(
      traces.map((trace) => {
        return [trace.handler, trace.outcome]
      })
    ).toEqual([
      ['first/change', 'applied'],
      ['forbidden/change', 'skipped'],
      ['wrongtype/change', 'skipped'],
      ['dependent/change', 'skipped'],
      ['last/change', 'applied']
    ])
    expect(
      [...env.backend.specifications.values()].some((spec) => {
        return spec.Labels['io.pi-im.plugin-instance'] === 'dependent'
      })
    ).toBe(false)
    const invalid = structuredClone(first)
    invalid.bundle.manifest.hooks[0].writes = ['/roomId']
    expect(() => {
      new PluginRegistry([invalid], PluginOverridesSchema.parse({}))
    }).toThrow('可写字段')
    const conflicting = structuredClone(first)
    conflicting.bundle.manifest.commands = [
      {
        id: 'help',
        names: ['help'],
        operation: 'echo',
        description: 'conflict',
        arguments: 'none',
        textField: 'text'
      }
    ]
    expect(() => {
      new PluginRegistry([conflicting], PluginOverridesSchema.parse({}))
    }).toThrow('命令别名冲突')
  } finally {
    await env.close()
  }
})

test('transform deadlines discard late patches, optional failures skip, and parent cancellation always stops the chain', async () => {
  const env = await pluginFixture()
  try {
    const binding = await env.register('slow', 'export default {}', {
      hooks: [{ id: 'slow', point: 'delivery.text@1', mode: 'transform', timeoutMs: 50 }]
    })
    const registry = new PluginRegistry([binding], PluginOverridesSchema.parse({}))
    const slow = Promise.withResolvers<unknown>()
    const controller = new AbortController()
    const input = {
      registry,
      point: 'delivery.text@1',
      selector: { channel: 'mock', origin: 'im' },
      value: { text: 'unchanged' },
      schema: z.object({ text: z.string() }),
      signal: controller.signal,
      invoke() {
        return slow.promise
      }
    }
    const result = await transformPluginPoint(input)
    expect(result.text).toBe('unchanged')
    slow.resolve({
      baseRevision: revision(input.value),
      patch: [{ op: 'set', path: '/text', value: 'too late' }]
    })
    expect(result.text).toBe('unchanged')
    controller.abort(new Error('cancelled'))
    await expect(transformPluginPoint(input)).rejects.toThrow('cancelled')
    const required = structuredClone(binding)
    required.bundle.manifest.hooks[0].onError = 'fail'
    await expect(
      transformPluginPoint({
        ...input,
        registry: new PluginRegistry([required], PluginOverridesSchema.parse({})),
        signal: new AbortController().signal,
        async invoke() {
          throw new Error('required hook failed')
        }
      })
    ).rejects.toThrow('required hook failed')
  } finally {
    await env.close()
  }
})
