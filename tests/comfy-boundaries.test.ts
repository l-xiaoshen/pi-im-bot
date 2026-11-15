import { expect, test } from 'bun:test'
import { PluginStateStore } from '@pi-im-bot/plugins/state/store'
import { withComfyHttp, withComfyDownload } from '@pi-im-bot/integrations/comfy/budgets'
import { comfyRequest } from '@pi-im-bot/integrations/comfy/http'
import { WorkflowSchema, ComfyServiceSchema } from '@pi-im-bot/integrations/comfy/resources'
import { ResourcesConfigSchema } from '@pi-im-bot/resources/schema'
import { compileWorkflow } from '@pi-im-bot/integrations/comfy/compile'
import { outputFiles } from '@pi-im-bot/integrations/comfy/outputs'
import { jobHarness, untilJob } from './job-harness'
import { responsesReply } from './responses-fixture'

export function boundWorkflow() {
  return WorkflowSchema.parse({
    id: 'authored',
    name: 'Authored',
    graph: {
      '1': { class_type: 'Text', inputs: { text: 'original' } },
      '2': { class_type: 'Sampler', inputs: { steps: 12, seed: 0 } },
      '3': { class_type: 'SaveImage', inputs: { filename_prefix: 'authored' } }
    },
    parameters: {
      positive: { type: 'string', paths: [['1', 'inputs', 'text']] },
      steps: {
        type: 'number',
        paths: [['2', 'inputs', 'steps']],
        default: 12,
        min: 1,
        max: 200,
        integer: true
      }
    },
    bindings: { positive: 'positive', stepNodes: { '2': 'steps' } },
    outputs: ['3']
  })
}

test('managed state CAS is atomic across contenders, isolates instance and scope, persists and enforces bounded namespaces', async () => {
  const env = await jobHarness(() => {
    return responsesReply({ kind: 'text', text: 'unused' })
  })
  try {
    const store = new PluginStateStore(env.runtime)
    const key = { area: 'scope' as const, key: 'counter' }
    const results = await Promise.all(
      Array.from({ length: 8 }, (_value, index) => {
        return store.compare('a', 'room', { ...key, version: 0, value: index }, () => {})
      })
    )
    expect(
      results.filter((result) => {
        return result.applied
      })
    ).toHaveLength(1)
    expect((await store.read('a', 'room', key)).version).toBe(1)
    expect((await store.read('a', 'other', key)).version).toBe(0)
    expect((await store.read('b', 'room', key)).version).toBe(0)
    const shared = { area: 'instance' as const, key: 'lock', version: 0, value: true }
    await store.compare('a', 'room', shared, () => {})
    expect((await store.read('a', 'other', shared)).value).toBe(true)
    await expect(
      store.compare('a', 'room', { ...key, version: 1, value: 'x'.repeat(32768) }, () => {})
    ).rejects.toThrow('32KiB')
    await expect(
      store.compare('a', 'room', { ...key, version: 1, value: 2 }, () => {
        throw new Error('revoked')
      })
    ).rejects.toThrow('revoked')
    for (let index = 0; index < 64; index += 1) {
      await store.compare(
        'quota',
        'room',
        { area: 'scope', key: 'k' + index, version: 0, value: 0 },
        () => {}
      )
    }
    await expect(
      store.compare('quota', 'room', { area: 'scope', key: 'overflow', version: 0, value: 0 }, () => {})
    ).rejects.toThrow('64键')
    await env.restart()
    expect((await new PluginStateStore(env.runtime).read('a', 'room', key)).version).toBe(1)
  } finally {
    await env.close()
  }
})

test('Comfy HTTP has global and per-service concurrency and downloads retain their independent lease until persistence completes', async () => {
  const service = ComfyServiceSchema.parse({
    id: 'one',
    name: 'one',
    kind: 'comfy',
    url: 'http://127.0.0.1:1'
  })
  const gate = Promise.withResolvers<void>()
  let active = 0
  let maximum = 0
  const byService = new Map<string, number>()
  const maxima = new Map<string, number>()
  const tasks = Array.from({ length: 12 }, (_value, index) => {
    const id = String(index % 3)
    return withComfyHttp({ ...service, id }, new AbortController().signal, false, async () => {
      active += 1
      maximum = Math.max(maximum, active)
      byService.set(id, (byService.get(id) ?? 0) + 1)
      maxima.set(id, Math.max(maxima.get(id) ?? 0, byService.get(id)!))
      await gate.promise
      active -= 1
      byService.set(id, byService.get(id)! - 1)
    })
  })
  await untilJob(() => {
    return active === 4
  }, 'HTTP did not reach four distinct active requests')
  expect(maximum).toBe(4)
  expect(
    [...maxima.values()].every((value) => {
      return value <= 2
    })
  ).toBe(true)
  gate.resolve()
  await Promise.all(tasks)
  let downloads = 0
  let downloadMaximum = 0
  const persisted = Promise.withResolvers<void>()
  const downloadsDone = Array.from({ length: 6 }, () => {
    return withComfyDownload(service, new AbortController().signal, async () => {
      downloads += 1
      downloadMaximum = Math.max(downloadMaximum, downloads)
      await persisted.promise
      downloads -= 1
    })
  })
  await untilJob(() => {
    return downloads === 2
  }, 'download persistence leases not acquired')
  expect(downloadMaximum).toBe(2)
  const aborted = new AbortController()
  aborted.abort()
  await expect(
    withComfyDownload(service, aborted.signal, async () => {
      throw new Error('must not run')
    })
  ).rejects.toThrow()
  persisted.resolve()
  await Promise.all(downloadsDone)
  expect(downloadMaximum).toBe(2)
})

test('dispatch persistence failure cleans up the HTTP body and never repeats a write', async () => {
  let calls = 0
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch() {
      calls += 1
      return new Response('authored')
    }
  })
  try {
    const service = ComfyServiceSchema.parse({
      id: 'one',
      name: 'one',
      kind: 'comfy',
      url: 'http://127.0.0.1:' + server.port
    })
    await expect(
      comfyRequest(service, 'prompt', new AbortController().signal, 100, {}, async () => {
        throw new Error('lost persistence')
      })
    ).rejects.toMatchObject({ outcome: 'unknown' })
    await comfyRequest(service, 'history/owned', new AbortController().signal, 100)
    expect(calls).toBeLessThanOrEqual(2)
    expect(calls).toBeGreaterThanOrEqual(1)
  } finally {
    await server.stop(true)
  }
})

test('registered bindings reject type/range/host-path mistakes before admission and completed false remains running', () => {
  const workflow = boundWorkflow()
  expect(compileWorkflow(workflow, { positive: 'new', steps: 24 })['2'].inputs.steps).toBe(24)
  expect(workflow.graph['1'].inputs.text).toBe('original')
  expect(() => {
    compileWorkflow(workflow, { steps: 1.5 })
  }).toThrow('登记范围')
  expect(() => {
    compileWorkflow(workflow, { unknown: 3 })
  }).toThrow('未登记')
  expect(() => {
    WorkflowSchema.parse({ ...workflow, bindings: { ...workflow.bindings, positive: 'steps' } })
  }).toThrow('类型')
  expect(() => {
    WorkflowSchema.parse({
      ...workflow,
      graph: { ...workflow.graph, '4': { class_type: 'X', inputs: { secret: 'SENTINEL' } } }
    })
  }).toThrow('秘密')
  expect(() => {
    ResourcesConfigSchema.parse({
      comfyServices: [
        { id: 'one', name: 'one', kind: 'comfy', url: 'http://127.0.0.1:1', workflows: ['missing'] }
      ]
    })
  }).toThrow('不存在')
  expect(
    outputFiles(
      { owned: { status: { completed: false, status_str: 'success' }, outputs: { '3': { images: [] } } } },
      'owned',
      ['3']
    ).status
  ).toBe('running')
  expect(
    outputFiles({ owned: { status: { completed: true, status_str: 'success' }, outputs: {} } }, 'owned', [
      '3'
    ]).status
  ).toBe('failed')
})
