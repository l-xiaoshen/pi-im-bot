import { expect, test } from 'bun:test'
import { join } from 'node:path'
import { readdir } from 'node:fs/promises'
import { pluginFixture } from './plugin-fixture'
import { jobHarness } from './job-harness'
import { responsesReply } from './responses-fixture'
import { PluginEditor } from '@pi-im-bot/plugins/editor'
import { FrameworkEditor } from '@pi-im-bot/settings/editor'
import { ConfigurationMutations } from '@pi-im-bot/config/mutations'
import { PluginConfigurationEditor } from '@pi-im-bot/plugins/configuration/editor'
import { ResourcesConfigSchema } from '@pi-im-bot/resources/schema'
import { PluginOrderEditor } from '@pi-im-bot/plugins/configuration/order'
import { parseConfigDefinition } from '@pi-im-bot/plugins/configuration/schema'

test('schema configuration preserves secret leaves by template identity, rejects invalid/stale writes, and merges room preferences without widening instance fields', async () => {
  const fixtures = await pluginFixture()
  const app = await jobHarness(() => {
    return responsesReply({ kind: 'text', text: 'unused' })
  })
  try {
    app.config.projectDir = fixtures.root
    app.config.bot.plugins = fixtures.manager.config
    const marker = join(fixtures.root, 'not-executed')
    const binding = await fixtures.register(
      'settings',
      `await Bun.write(${JSON.stringify(marker)}, 'executed')\nexport default {}`,
      { hooks: [{ id: 'text', point: 'delivery.text@1', mode: 'transform', writes: ['/text'] }] }
    )
    await Bun.write(
      join(binding.instance.sourceDir, '_conf_schema.json'),
      JSON.stringify({
        token: { type: 'string', description: 'Token', secret: true, required: true },
        display: {
          type: 'object',
          description: 'Display',
          items: {
            prefix: {
              type: 'string',
              description: 'Prefix',
              default: 'BASE',
              scope: ['instance', 'account', 'room', 'conversation']
            },
            limit: {
              type: 'int',
              description: 'Limit',
              default: 10,
              slider: { min: 0, max: 100, step: 5 },
              scope: ['instance', 'account', 'room', 'conversation']
            }
          }
        },
        backends: {
          type: 'template_list',
          description: 'Backends',
          default: [
            { __template_key: 'server', name: 'one' },
            { __template_key: 'server', name: 'two' }
          ],
          templates: {
            server: {
              name: 'Server',
              items: {
                name: { type: 'string', description: 'Name', default: '' },
                api_key: { type: 'string', description: 'Key', secret: true }
              }
            }
          }
        }
      })
    )
    await Bun.write(
      join(app.config.configDir, 'resources.json'),
      JSON.stringify(ResourcesConfigSchema.parse({}))
    )
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
    await Bun.write(join(app.config.configDir, 'framework.json'), JSON.stringify(app.config.framework))
    const plugins = new PluginEditor(
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
    let list = await plugins.read()
    await plugins.save(list.revision, { ...binding.instance, enabled: false })
    list = await plugins.read()
    await plugins.import(list.revision, binding.instance.id)
    expect(await Bun.file(marker).exists()).toBe(false)
    const editor = new PluginConfigurationEditor(plugins, framework, app.coordinator)
    const instanceTarget = { level: 'instance' as const }
    let view = await editor.read('settings', instanceTarget)
    expect(
      view.issues.some((issue) => {
        return issue.path === 'token'
      })
    ).toBe(true)
    const initial = view
    const ids = app.config.resources.config.plugins[0].settings.backends as Array<{ __entry_id: string }>
    view = await editor.save('settings', {
      revision: view.revision,
      release: view.release,
      target: instanceTarget,
      values: view.values,
      secrets: [
        { action: 'set', path: '/token', value: 'PRIVATE_MAIN_TOKEN' },
        { action: 'set', path: '/backends/@' + ids[0].__entry_id + '/api_key', value: 'PRIVATE_ONE' },
        { action: 'set', path: '/backends/@' + ids[1].__entry_id + '/api_key', value: 'PRIVATE_TWO' }
      ]
    })
    expect(JSON.stringify(view)).not.toContain('PRIVATE_')
    expect(
      view.secrets.filter((entry) => {
        return entry.configured
      })
    ).toHaveLength(3)
    const values = structuredClone(view.values)
    const entries = values.backends as Array<Record<string, string>>
    entries.reverse()
    view = await editor.save('settings', {
      revision: view.revision,
      release: view.release,
      target: instanceTarget,
      values,
      secrets: []
    })
    const savedEntries = app.config.resources.config.plugins[0].settings.backends as Array<
      Record<string, string>
    >
    expect(savedEntries[0].api_key).toBe('PRIVATE_TWO')
    expect(savedEntries[1].api_key).toBe('PRIVATE_ONE')
    await expect(
      editor.save('settings', {
        revision: initial.revision,
        release: initial.release,
        target: instanceTarget,
        values: initial.values,
        secrets: []
      })
    ).rejects.toThrow('已变化')
    const before = await Bun.file(join(app.config.configDir, 'resources.json')).text()
    await expect(
      editor.save('settings', {
        revision: view.revision,
        release: view.release,
        target: instanceTarget,
        values: { ...view.values, display: { prefix: 'BAD', limit: 12 } },
        secrets: []
      })
    ).rejects.toThrow('step')
    expect(await Bun.file(join(app.config.configDir, 'resources.json')).text()).toBe(before)
    const account = {
      level: 'account' as const,
      channel: app.room.address.channel,
      accountId: app.room.address.accountId
    }
    let scope = await editor.read('settings', account)
    await editor.save('settings', {
      revision: scope.revision,
      release: scope.release,
      target: account,
      values: { display: { prefix: 'ACCOUNT' } },
      secrets: []
    })
    const room = { level: 'room' as const, roomId: app.room.id }
    scope = await editor.read('settings', room)
    await editor.save('settings', {
      revision: scope.revision,
      release: scope.release,
      target: room,
      values: { display: { limit: 25 } },
      secrets: []
    })
    expect(app.coordinator.effective(app.room.id).settings.extensions.settings.settings).toEqual({
      display: { prefix: 'ACCOUNT', limit: 25 }
    })
    scope = await editor.read('settings', room)
    await expect(
      editor.save('settings', {
        revision: scope.revision,
        release: scope.release,
        target: room,
        values: { token: 'INJECT' },
        secrets: []
      })
    ).rejects.toThrow('不能覆盖')
    expect(JSON.stringify(await editor.read('settings', room))).not.toContain('PRIVATE_')
    const patch = app.store.getRoom(app.room.id)!
    await expect(
      editor.save('settings', {
        revision: scope.revision,
        release: scope.release,
        target: room,
        values: { display: { limit: 30 } },
        secrets: [{ action: 'clear', path: '/token' }]
      })
    ).rejects.toThrow('实例')
    expect(app.store.getRoom(app.room.id)?.revision).toBe(patch.revision)
    const order = new PluginOrderEditor(editor)
    const orderView = await order.read('settings', room)
    await order.save('settings', {
      revision: orderView.revision,
      release: orderView.release,
      target: room,
      changes: [{ key: 'settings/text', priority: 90, disabled: false }],
      selected: false
    })
    expect(app.coordinator.effective(app.room.id).settings.resources.plugins).toEqual({
      mode: 'selected',
      ids: []
    })
    expect((await order.read('settings', room)).handlers[0].priority).toBe(90)
    expect(await readdir(join(app.config.dataDir, 'plugin-config-history/settings'))).not.toHaveLength(0)
    expect(app.requests).toHaveLength(0)
  } finally {
    await app.close()
    await fixtures.close()
  }
})

test('configuration schemas reject unbounded depth and executable/unsupported metadata before plugin execution', () => {
  expect(() => {
    parseConfigDefinition({ value: { type: 'string', pattern: '(a+)+$' } })
  }).toThrow()
  expect(() => {
    parseConfigDefinition({ value: { type: 'string', secret: true, scope: ['room'] } })
  }).toThrow()
  let value: unknown = { field: { type: 'string' } }
  for (let count = 0; count < 40; count++) {
    value = { field: { type: 'object', items: value } }
  }
  expect(() => {
    parseConfigDefinition(value)
  }).toThrow('过深')
})
