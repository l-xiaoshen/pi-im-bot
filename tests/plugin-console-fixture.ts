import { join } from 'node:path'
import { pluginFixture } from './plugin-fixture'
import { jobHarness } from './job-harness'
import { responsesReply } from './responses-fixture'
import { PluginEditor } from '@pi-im-bot/plugins/editor'
import { FrameworkEditor } from '@pi-im-bot/settings/editor'
import { ConfigurationMutations } from '@pi-im-bot/config/mutations'
import { PluginService } from '@pi-im-bot/plugins/service'
import { PluginRuntimeSchema } from '@pi-im-bot/plugins/runtime/config'

export async function pluginConsoleFixture() {
  const env = await pluginFixture()
  const app = await jobHarness(() => {
    return responsesReply({ kind: 'text', text: 'unused' })
  })
  app.config.projectDir = env.root
  app.config.bot.plugins = PluginRuntimeSchema.parse({ ...env.manager.config, enabled: false })
  const mutations = new ConfigurationMutations()
  const framework = new FrameworkEditor(
    () => {
      return app.config
    },
    app.store,
    (next) => {
      app.config.framework = next
    },
    mutations
  )
  const editor = new PluginEditor(
    () => {
      return app.config
    },
    (next) => {
      app.config.resources = next
    },
    mutations,
    (resources) => {
      framework.validate(app.config.framework, undefined, undefined, app.config.catalog, resources)
    },
    () => {
      return []
    }
  )
  const service = new PluginService(() => {
    return app.config
  }, env.manager)
  app.coordinator.plugins = service
  await Bun.write(join(app.config.configDir, 'bot.json'), JSON.stringify(app.config.bot))
  await Bun.write(join(app.config.configDir, 'framework.json'), JSON.stringify(app.config.framework))
  await Bun.write(join(app.config.configDir, 'resources.json'), JSON.stringify(app.config.resources.config))
  return {
    env,
    app,
    editor,
    framework,
    mutations,
    service,
    async close() {
      await service.manager.close()
      await app.close()
      await env.close()
    }
  }
}
