import { expect, test } from 'bun:test'
import { join } from 'node:path'
import { pluginConsoleFixture } from './plugin-console-fixture'
import { ResourceLibrary } from '@pi-im-bot/resources/library'
import { ResourcesConfigSchema } from '@pi-im-bot/resources/schema'
import { PluginConfigurationEditor } from '@pi-im-bot/plugins/configuration/editor'

test('required service bindings are editable with plugin configuration even without a schema and cannot write undeclared aliases', async () => {
  const fixture = await pluginConsoleFixture()
  try {
    const backend = await fixture.env.register('backend', 'export default {}')
    const consumer = await fixture.env.register('consumer', 'export default {}', {
      connections: [{ alias: 'engine', kind: 'plugin', title: '运行引擎', required: true }]
    })
    consumer.instance.enabled = false
    fixture.app.config.resources = new ResourceLibrary(
      ResourcesConfigSchema.parse({ plugins: [backend.instance, consumer.instance] }),
      [],
      [],
      [backend.bundle, consumer.bundle]
    )
    await Bun.write(
      join(fixture.app.config.configDir, 'resources.json'),
      JSON.stringify(fixture.app.config.resources.config)
    )
    const editor = new PluginConfigurationEditor(fixture.editor, fixture.framework, fixture.app.coordinator)
    let view = await editor.read('consumer', { level: 'instance' })
    expect(view.bindings[0].title).toBe('运行引擎')
    expect(
      view.bindings[0].choices.map((choice) => {
        return choice.id
      })
    ).toEqual(['backend'])
    view = await editor.save('consumer', {
      revision: view.revision,
      release: view.release,
      target: view.target,
      values: {},
      secrets: [],
      dependencies: { engine: 'backend' }
    })
    expect(view.bindings[0].value).toBe('backend')
    await fixture.editor.manage((await fixture.editor.read()).revision, 'consumer', { enabled: true })
    view = await editor.read('consumer', { level: 'instance' })
    await expect(
      editor.save('consumer', {
        revision: view.revision,
        release: view.release,
        target: view.target,
        values: {},
        secrets: [],
        dependencies: { invented: 'backend' }
      })
    ).rejects.toThrow('未声明')
    expect(
      (await fixture.editor.read()).plugins.find((entry) => {
        return entry.id === 'consumer'
      })?.issues
    ).toEqual([])
    expect(fixture.env.backend.specifications.size).toBe(0)
  } finally {
    await fixture.close()
  }
})
