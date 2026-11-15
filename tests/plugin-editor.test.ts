import { expect, test } from 'bun:test'
import { Hono } from 'hono'
import { join } from 'node:path'
import { pluginFixture } from './plugin-fixture'
import { jobHarness } from './job-harness'
import { responsesReply } from './responses-fixture'
import { PluginEditor } from '@pi-im-bot/plugins/editor'
import { PluginEditorViewSchema } from '@pi-im-bot/plugins/contracts'
import { ConfigurationMutations } from '@pi-im-bot/config/mutations'
import { FrameworkEditor, SettingsEditError } from '@pi-im-bot/settings/editor'
import { registerPluginRoutes } from '@pi-im-bot/bot/http/plugin-routes'
import { resourceReferences } from '@pi-im-bot/resources/references'
import { ResourceLibrary } from '@pi-im-bot/resources/library'
import { ResourcesConfigSchema } from '@pi-im-bot/resources/schema'

test('plugin web edits mask and preserve settings, reject stale saves and conflicting activation, and preserve other resources', async () => {
  const plugins = await pluginFixture()
  const app = await jobHarness(() => {
    return responsesReply({ kind: 'text', text: 'unused' })
  })
  try {
    const marker = join(plugins.root, 'must-not-run')
    app.config.resources = new ResourceLibrary(
      ResourcesConfigSchema.parse({
        mcp: [{ id: 'existing', name: 'Existing MCP', enabled: false, url: 'http://127.0.0.1:1/mcp' }],
        skills: [{ id: 'existing', name: 'Existing Skill', enabled: false, sourceDir: 'unimported-skill' }]
      }),
      []
    )
    const binding = await plugins.register(
      'webplugin',
      `await Bun.write(${JSON.stringify(marker)}, 'executed')\nexport default {}`
    )
    await Bun.write(join(app.config.configDir, 'resources.json'), JSON.stringify(app.config.resources.config))
    const framework = new FrameworkEditor(
      () => {
        return app.config
      },
      app.store,
      (config) => {
        app.config.framework = config
      }
    )
    const editor = new PluginEditor(
      () => {
        return app.config
      },
      (library) => {
        app.config.resources = library
      },
      new ConfigurationMutations(),
      (resources) => {
        framework.validate(app.config.framework, undefined, undefined, app.config.catalog, resources)
      },
      (id) => {
        return resourceReferences(app.config, app.store, 'plugin', id)
      }
    )
    const http = new Hono()
    http.onError((error, c) => {
      if (error instanceof SettingsEditError) {
        return c.json({ error: error.message }, error.status)
      }
      return c.json({ error: error.message }, 400)
    })
    registerPluginRoutes(http, editor, () => {})
    async function view() {
      return PluginEditorViewSchema.parse(await (await http.request('/api/plugins')).json())
    }
    async function write(path: string, method: string, body: object) {
      return http.request(path, {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      })
    }
    let state = await view()
    expect(
      (
        await write('/api/plugins', 'POST', {
          revision: state.revision,
          plugin: {
            ...binding.instance,
            settings: { apiKey: 'PRIVATE_PLUGIN_KEY', nested: { key: 'PRIVATE_NESTED' } }
          }
        })
      ).status
    ).toBe(201)
    state = await view()
    expect(JSON.stringify(state)).not.toContain('PRIVATE_PLUGIN_KEY')
    expect(JSON.stringify(state)).not.toContain('PRIVATE_NESTED')
    const beforeImport = state.revision
    expect((await write('/api/plugins/webplugin/import', 'POST', { revision: beforeImport })).status).toBe(
      200
    )
    state = await view()
    expect(state.revision).not.toBe(beforeImport)
    expect(state.plugins[0].state).toBe('runtime-disabled')
    expect(await Bun.file(marker).exists()).toBe(false)
    const stale = await write('/api/plugins/webplugin', 'PUT', {
      revision: beforeImport,
      plugin: { ...binding.instance, settings: state.plugins[0].settings }
    })
    expect(stale.status).toBe(409)
    expect(
      (
        await write('/api/plugins/webplugin', 'PUT', {
          revision: state.revision,
          plugin: { ...binding.instance, name: 'Renamed', settings: state.plugins[0].settings }
        })
      ).status
    ).toBe(200)
    expect(app.config.resources.config.plugins[0].settings.apiKey).toBe('PRIVATE_PLUGIN_KEY')
    state = await view()
    const revision = state.plugins[0].bundle!.revision
    await Bun.write(
      join(binding.instance.sourceDir, 'plugin.json'),
      JSON.stringify({
        ...binding.bundle.manifest,
        commands: [{ id: 'conflict', names: ['help'], operation: 'echo', description: 'reserved command' }]
      })
    )
    expect((await write('/api/plugins/webplugin/import', 'POST', { revision: state.revision })).status).toBe(
      400
    )
    expect((await view()).plugins[0].bundle!.revision).toBe(revision)
    app.config.framework.defaults.resources.plugins = { mode: 'selected', ids: ['webplugin'] }
    expect((await write('/api/plugins/webplugin', 'DELETE', { revision: state.revision })).status).toBe(400)
    app.config.framework.defaults.resources.plugins = { mode: 'all' }
    expect((await write('/api/plugins/webplugin', 'DELETE', { revision: state.revision })).status).toBe(200)
    expect((await view()).plugins).toHaveLength(0)
    expect(
      app.config.resources.config.mcp.map((server) => {
        return server.id
      })
    ).toEqual(['existing'])
    expect(
      app.config.resources.config.skills.map((skill) => {
        return skill.id
      })
    ).toEqual(['existing'])
    expect(app.requests).toHaveLength(0)
  } finally {
    await app.close()
    await plugins.close()
  }
})
