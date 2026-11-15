import { expect, test } from 'bun:test'
import { join } from 'node:path'
import { pluginFixture } from './plugin-fixture'
import { jobHarness } from './job-harness'
import { responsesReply } from './responses-fixture'
import { PluginEditor } from '@pi-im-bot/plugins/editor'
import { PluginInstaller } from '@pi-im-bot/plugins/install/service'
import { PluginMarket } from '@pi-im-bot/plugins/market/service'
import { ResourceLibrary } from '@pi-im-bot/resources/library'
import { ResourcesConfigSchema } from '@pi-im-bot/resources/schema'
import { ConfigurationMutations } from '@pi-im-bot/config/mutations'

test('catalog updates compare source package hashes even when the plugin semantic version is unchanged', async () => {
  const env = await pluginFixture()
  const binding = await env.register('update-fixture', 'export default {}')
  const digest = 'a'.repeat(64)
  binding.bundle.origin = { kind: 'url', archiveSha256: digest }
  let availableDigest = digest
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch() {
      return Response.json({
        version: 1,
        plugins: [
          {
            id: 'update-fixture',
            name: 'Update',
            description: 'Owned fixture',
            version: '1.0.0',
            apiVersion: 1,
            url: 'http://127.0.0.1:19337/package.zip',
            sha256: availableDigest
          }
        ]
      })
    }
  })
  const resources = new ResourceLibrary(
    ResourcesConfigSchema.parse({
      plugins: [binding.instance],
      pluginCatalogs: [{ id: 'local', name: 'Local', url: 'http://127.0.0.1:' + server.port + '/index.json' }]
    }),
    [],
    [],
    [binding.bundle]
  )
  const app = await jobHarness(() => {
    return responsesReply({ kind: 'text', text: 'unused' })
  }, resources)
  await Bun.write(join(app.config.configDir, 'resources.json'), JSON.stringify(resources.config))
  const editor = new PluginEditor(
    () => {
      return app.config
    },
    (value) => {
      app.config.resources = value
    },
    new ConfigurationMutations(),
    () => {},
    () => {
      return []
    }
  )
  const installer = new PluginInstaller(editor)
  const market = new PluginMarket(installer)
  try {
    let view = await market.refresh()
    expect(view.entries[0].installedId).toBe('update-fixture')
    expect(view.entries[0].updateAvailable).toBe(false)
    availableDigest = 'b'.repeat(64)
    view = await market.refresh()
    expect(view.entries[0].installedVersion).toBe('1.0.0')
    expect(view.entries[0].version).toBe('1.0.0')
    expect(view.entries[0].updateAvailable).toBe(true)
    expect(app.requests).toHaveLength(0)
  } finally {
    await installer.close()
    await app.close()
    await env.close()
    await server.stop(true)
  }
})
