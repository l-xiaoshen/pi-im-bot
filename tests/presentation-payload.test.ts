import { expect, test } from 'bun:test'
import { pluginFixture } from './plugin-fixture'
import { jobHarness, untilJob } from './job-harness'
import { responsesReply } from './responses-fixture'
import { PluginService } from '@pi-im-bot/plugins/service'
import { localIdentity } from '@pi-im-bot/permissions/identity'
import { ResourceLibrary } from '@pi-im-bot/resources/library'
import { ResourcesConfigSchema } from '@pi-im-bot/resources/schema'
import { ArtifactStore } from '@pi-im-bot/artifacts/store'
import { DeliverySuppressed } from '@pi-im-bot/runtime/delivery'

test('plain delivery with 1500 unrelated capabilities captures no render admission or input clone', async () => {
  const worker = await pluginFixture()
  const app = await jobHarness(
    () => {
      return responsesReply({ kind: 'text', text: 'unused' })
    },
    undefined,
    (coordinator, config) => {
      config.bot.plugins = worker.manager.config
      coordinator.plugins = new PluginService(() => {
        return config
      }, worker.manager)
    }
  )
  const clone = globalThis.structuredClone
  try {
    const catalog = app.config.resources.capabilityIds.bind(app.config.resources)
    const builtin = catalog(app.coordinator.effective(app.room.id).settings)
    app.config.resources.capabilityIds = () => {
      return [
        ...builtin,
        ...Array.from({ length: 1500 }, (_, index) => {
          return 'fixture_' + index
        })
      ]
    }
    const invocation = app.coordinator.jobInvocation(
      app.room.id,
      localIdentity('web', 'operator'),
      'plain delivery'
    )
    let snapshots = 0
    let inputClones = 0
    const save = app.coordinator.snapshotConfiguration.bind(app.coordinator)
    app.coordinator.snapshotConfiguration = (config) => {
      snapshots += 1
      return save(config)
    }
    function measuredClone<T>(value: T) {
      if (value === invocation.input) {
        inputClones += 1
      }
      return clone(value)
    }
    globalThis.structuredClone = measuredClone
    const id = 'no-render-payload'
    const presentation = app.coordinator.presentation(
      invocation.config,
      invocation.room,
      invocation.input,
      id,
      'final',
      new AbortController().signal,
      undefined,
      'agent-final',
      true
    )
    expect(snapshots).toBe(0)
    expect(inputClones).toBe(0)
    await app.coordinator.delivery.send(
      invocation.room,
      'plain reply with zero hooks',
      undefined,
      'assistant',
      id,
      { presentation }
    )
    const outbound = app.store.getOutbound(id)!
    expect(outbound.state).toBe('sent')
    expect(outbound).not.toHaveProperty('renderAdmission')
    expect(outbound.render).toBeUndefined()
    expect(snapshots).toBe(0)
    expect(inputClones).toBe(0)
    expect(Buffer.byteLength(JSON.stringify(outbound))).toBeLessThan(1500)
    console.log(
      JSON.stringify({
        noRenderPayload: {
          capabilities: 1500,
          bytes: Buffer.byteLength(JSON.stringify(outbound)),
          snapshots,
          inputClones
        }
      })
    )
  } finally {
    globalThis.structuredClone = clone
    await app.close()
    await worker.close()
  }
})

test('non-render decisions retain real visibility, text, synchronous media and receipt hooks without invoking render capture', async () => {
  const worker = await pluginFixture()
  const binding = await worker.register(
    'presentation',
    `export default { hooks: {
    visible(input) { return { allow: !input.text.startsWith('deny') } },
    text(input, context) { return { baseRevision: context.invocation.inputRevision, patch: [{ op: 'set', path: '/text', value: input.text + '[text]' }] } },
    sync(input) {
      if (input.text.startsWith('skip')) { return null }
      return { text: input.text + '[sync]', artifactIds: input.artifactIds }
    },
    receipt() { return null }
  } }`,
    {
      hooks: [
        { id: 'visible', point: 'delivery.visibility@1', mode: 'policy' },
        { id: 'text', point: 'delivery.text@1', mode: 'transform', writes: ['/text'] },
        { id: 'sync', point: 'delivery.presentation@1', mode: 'select' },
        { id: 'receipt', point: 'delivery.receipt@1', mode: 'observe' }
      ]
    }
  )
  const library = new ResourceLibrary(
    ResourcesConfigSchema.parse({ plugins: [binding.instance] }),
    [],
    [],
    [binding.bundle]
  )
  const app = await jobHarness(
    () => {
      return responsesReply({ kind: 'text', text: 'unused' })
    },
    library,
    (coordinator, config) => {
      config.bot.plugins = worker.manager.config
      coordinator.plugins = new PluginService(() => {
        return config
      }, worker.manager)
    }
  )
  try {
    const service = app.coordinator.plugins!
    const hook = service.hook.bind(service)
    const events: string[] = []
    service.hook = async (invocation, registry, entry, value, id, signal) => {
      const result = await hook(invocation, registry, entry, value, id, signal)
      events.push(id.split(':')[0] + '/' + entry.hook.id)
      return result
    }
    const invocation = app.coordinator.jobInvocation(
      app.room.id,
      localIdentity('web', 'operator'),
      'hook fixture'
    )
    const artifact = await new ArtifactStore(app.config.dataDir, app.room.id).save(
      'fixture.txt',
      'text/plain',
      'fixture',
      'attached bytes'
    )
    let captures = 0
    for (const text of ['sync', 'skip', 'mixed', 'deny']) {
      const presentation = app.coordinator.presentation(
        invocation.config,
        invocation.room,
        invocation.input,
        text,
        'final',
        new AbortController().signal,
        undefined,
        'agent-final',
        true
      )!
      const capture = presentation.captureAdmission!
      presentation.captureAdmission = () => {
        captures += 1
        return capture()
      }
      const artifacts: string[] = []
      if (text === 'mixed') {
        artifacts.push(artifact.id)
      }
      const sending = app.coordinator.delivery.send(invocation.room, text, undefined, 'assistant', text, {
        presentation,
        artifactIds: artifacts
      })
      if (text === 'deny') {
        await expect(sending).rejects.toBeInstanceOf(DeliverySuppressed)
      } else {
        await sending
      }
      await untilJob(() => {
        return (
          events.filter((event) => {
            return event.endsWith('/receipt')
          }).length >=
          ['sync', 'skip', 'mixed', 'deny'].indexOf(text) + 1
        )
      }, 'receipt hook did not execute')
      const outbound = app.store.getOutbound(text)!
      expect(outbound).not.toHaveProperty('renderAdmission')
      expect(events).toContain(text + '/visible')
      if (text !== 'deny') {
        expect(events).toContain(text + '/text')
        expect(events).toContain(text + '/sync')
      }
      if (text === 'sync') {
        expect(outbound.renderedText).toBe('sync[text][sync]')
      }
      if (text === 'skip') {
        expect(outbound.renderedText).toBe('skip[text]')
      }
      if (text === 'mixed') {
        expect(outbound.artifactIds).toEqual([artifact.id])
      }
    }
    expect(captures).toBe(0)
    expect(
      events.filter((event) => {
        return event.endsWith('/receipt')
      })
    ).toHaveLength(4)
    expect(app.requests).toHaveLength(0)
  } finally {
    await app.close()
    await worker.close()
  }
})
