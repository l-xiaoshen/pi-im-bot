import { expect, test } from 'bun:test'
import { pluginFixture } from './plugin-fixture'
import { jobHarness } from './job-harness'
import { responsesReply } from './responses-fixture'
import { localIdentity } from '@pi-im-bot/permissions/identity'
import { PluginService } from '@pi-im-bot/plugins/service'
import { pluginPresentation } from '@pi-im-bot/plugins/hooks/presentation'
import { ResourceLibrary } from '@pi-im-bot/resources/library'
import { ResourcesConfigSchema } from '@pi-im-bot/resources/schema'
import { DeliveryViewSchema } from '@pi-im-bot/plugins/hooks/points'

test('presentation authorization cost depends on declared consumer needs, not the unrelated capability directory', async () => {
  const worker = await pluginFixture()
  const app = await jobHarness(() => {
    return responsesReply({ kind: 'text', text: 'unused' })
  })
  try {
    app.config.bot.plugins = worker.manager.config
    const service = new PluginService(() => {
      return app.config
    }, worker.manager)
    const binding = await worker.register(
      'consumer',
      'export default { hooks: { choose() { return null } } }',
      {
        hooks: [
          {
            id: 'choose',
            point: 'delivery.presentation@1',
            mode: 'select',
            inspectCapabilities: ['tts_synthesize', 'plugin:self/echo'],
            timeoutMs: 1000
          }
        ]
      }
    )
    const results = []
    for (const consumer of [false, true]) {
      app.config.resources = ResourceLibrary.empty()
      if (consumer) {
        app.config.resources = new ResourceLibrary(
          ResourcesConfigSchema.parse({ plugins: [binding.instance] }),
          [],
          [],
          [binding.bundle]
        )
      }
      const original = app.config.resources.capabilityIds.bind(app.config.resources)
      const builtin = original(app.coordinator.effective(app.room.id).settings)
      for (const count of [100, 500, 1500]) {
        const ids = [
          ...builtin,
          ...Array.from({ length: count }, (_, index) => {
            return 'synthetic_' + index
          })
        ]
        app.config.resources.capabilityIds = () => {
          return ids
        }
        app.config.framework.defaults.permissions.rules = []
        const invocation = app.coordinator.jobInvocation(
          app.room.id,
          localIdentity('web', 'actor'),
          'benchmark'
        )
        for (const revoked of [false, true]) {
          app.config.framework.defaults.permissions.rules = []
          if (revoked) {
            app.config.framework.defaults.permissions.rules = [
              { effect: 'deny', capabilities: ['tts_synthesize'], subjects: [{ kind: 'everyone' }] }
            ]
          }
          let calls = 0
          let payload: string[] = []
          const hook = service.hook.bind(service)
          service.hook = async (invocation, registry, entry, value, id, signal) => {
            payload = DeliveryViewSchema.parse(value).capabilities
            return hook(invocation, registry, entry, value, id, signal)
          }
          const presentation = pluginPresentation(
            service,
            {
              ...invocation,
              services: {
                authorize(capability) {
                  calls += 1
                  app.coordinator.authorizeRetainedContext(
                    app.room.id,
                    invocation.room.mode,
                    invocation.input.context,
                    capability
                  )
                },
                history() {
                  return []
                },
                async send() {
                  throw new Error('not a send test')
                }
              }
            },
            'cost',
            'final',
            new AbortController().signal,
            () => {},
            'agent-final',
            true
          )!
          const start = performance.now()
          await presentation.prepare('normal reply', [])
          const elapsedMs = performance.now() - start
          if (!consumer) {
            expect(calls).toBe(0)
          } else {
            expect(calls).toBeLessThanOrEqual(8)
            expect(payload.length).toBeLessThanOrEqual(2)
            expect(payload.includes('tts_synthesize')).toBe(!revoked)
          }
          results.push({
            consumer,
            count,
            revoked,
            calls,
            payloadSize: payload.length,
            elapsedMs: Number(elapsedMs.toFixed(2))
          })
          service.hook = hook
        }
      }
    }
    console.log(JSON.stringify({ presentationAuthorizationBenchmark: results }))
  } finally {
    await app.close()
    await worker.close()
  }
})
