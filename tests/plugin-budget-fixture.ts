import { pluginFixture } from './plugin-fixture'
import { jobHarness } from './job-harness'
import { responsesReply } from './responses-fixture'
import { PluginService } from '@pi-im-bot/plugins/service'
import { ResourceLibrary } from '@pi-im-bot/resources/library'
import { ResourcesConfigSchema } from '@pi-im-bot/resources/schema'
import { localIdentity } from '@pi-im-bot/permissions/identity'
import type { PluginBinding } from '@pi-im-bot/plugins/registry'

export const ObjectInput = { type: 'object' as const, properties: {} }

export async function budgetFixture(maxWorkers: number) {
  const worker = await pluginFixture({ maxWorkers })
  const app = await jobHarness(() => {
    return responsesReply({ kind: 'text', text: 'unused' })
  })
  app.config.bot.plugins = worker.manager.config
  const service = new PluginService(() => {
    return app.config
  }, worker.manager)
  function bind(bindings: PluginBinding[]) {
    app.config.resources = new ResourceLibrary(
      ResourcesConfigSchema.parse({
        plugins: bindings.map((binding) => {
          return binding.instance
        })
      }),
      [],
      [],
      bindings.map((binding) => {
        return binding.bundle
      })
    )
  }
  function invocation(history: () => void = () => {}) {
    const input = app.coordinator.jobInvocation(
      app.room.id,
      localIdentity('web', 'operator'),
      'budget fixture'
    )
    return {
      ...input,
      services: {
        authorize: input.authorize,
        history() {
          history()
          return []
        },
        async send() {
          throw new Error('fixture never sends')
        }
      }
    }
  }
  return {
    worker,
    app,
    service,
    bind,
    invocation,
    async close() {
      await worker.close()
      await app.close()
    }
  }
}
