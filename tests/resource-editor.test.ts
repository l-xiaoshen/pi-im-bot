import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { ResourceEditor } from '@pi-im-bot/resources/editor'
import { ResourceLibrary } from '@pi-im-bot/resources/library'
import { ResourceSecretPlaceholder, McpServerDraftSchema } from '@pi-im-bot/resources/contracts'
import { McpServerSchema } from '@pi-im-bot/resources/mcp/schema'
import { ConfigurationMutations } from '@pi-im-bot/config/mutations'
import { BotConfigSchema } from '@pi-im-bot/config/schema'
import { ProvidersConfigSchema } from '@pi-im-bot/providers/schema'
import { ProviderCatalog } from '@pi-im-bot/providers/catalog'
import { testFramework } from './agent-input'
import { mcpFixture } from './mcp-fixture'
import { pluginFixture } from './plugin-fixture'
import { ResourcesConfigSchema } from '@pi-im-bot/resources/schema'
import { ConfigurationSnapshots } from '@pi-im-bot/config/snapshots'

test('MCP web edits preserve masked credentials, reject stale writes, discover only metadata, and invalidate changed connections', async () => {
  const root = await mkdtemp('/tmp/pi-resource-editor-')
  const mcp = mcpFixture()
  const plugins = await pluginFixture()
  try {
    const plugin = await plugins.register('reference', 'export default {}')
    const resources = ResourcesConfigSchema.parse({ plugins: [plugin.instance] })
    await Bun.write(join(root, 'resources.json'), JSON.stringify(resources))
    const catalog = await ProviderCatalog.create(
      ProvidersConfigSchema.parse({
        defaultGroup: 'main',
        providers: [],
        groups: [{ id: 'main', candidates: [] }]
      }),
      root
    )
    const config = {
      bot: BotConfigSchema.parse({}),
      catalog,
      framework: testFramework(),
      resources: new ResourceLibrary(resources, [], [], [plugin.bundle]),
      configDir: root,
      dataDir: root,
      projectDir: root
    }
    let usage: string[] = []
    const editor = new ResourceEditor(
      () => {
        return config
      },
      (resources) => {
        config.resources = resources
      },
      new ConfigurationMutations(),
      () => {
        return usage
      }
    )
    const before = await editor.read()
    const saved = await editor.save(before.revision, McpServerDraftSchema.parse(mcp.config))
    const publicText = JSON.stringify(saved)
    expect(publicText).not.toContain('fixture-secret')
    expect(publicText).not.toContain('fixture-url-secret')
    expect(saved.mcp[0].headers.Authorization).toBe(ResourceSecretPlaceholder)
    await expect(
      editor.save(before.revision, McpServerDraftSchema.parse(mcp.config), mcp.config.id)
    ).rejects.toThrow('已变化')
    const draft = McpServerDraftSchema.parse({
      ...mcp.config,
      url: '',
      headers: saved.mcp[0].headers,
      name: 'Renamed'
    })
    const edited = await editor.save(saved.revision, draft, mcp.config.id)
    expect(config.resources.config.mcp[0].url).toBe(mcp.config.url)
    expect(config.resources.config.mcp[0].headers.Authorization).toBe('Bearer fixture-secret')
    const discovered = await editor.refresh(edited.revision, mcp.config.id, new AbortController().signal)
    expect(discovered.mcp[0].tools).toHaveLength(1)
    expect(mcp.state.calls).toBe(0)
    const changed = await editor.save(
      discovered.revision,
      { ...draft, url: mcp.config.url + '&updated=1' },
      mcp.config.id
    )
    expect(changed.mcp[0].state).toBe('undiscovered')
    usage = ['scope']
    await expect(editor.remove(changed.revision, mcp.config.id)).rejects.toThrow('仍被配置引用')
    expect(McpServerSchema.safeParse({ ...mcp.config, transport: 'stdio', command: 'sh' }).success).toBe(
      false
    )
    expect(config.resources.pluginPackage('reference')?.revision).toBe(plugin.bundle.revision)
    const snapshots = new ConfigurationSnapshots(() => {
      return config
    })
    const reference = snapshots.save(config)
    config.resources = ResourceLibrary.empty()
    const restored = await snapshots.load(reference)
    expect(restored.resources.pluginPackage('reference')?.revision).toBe(plugin.bundle.revision)
  } finally {
    await plugins.close()
    await mcp.server.stop(true)
    await rm(root, { recursive: true, force: true })
  }
})
