import { expect, test } from 'bun:test'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { pluginFixture } from './plugin-fixture'
import { jobHarness } from './job-harness'
import { responsesReply } from './responses-fixture'
import { ResourceLibrary } from '@pi-im-bot/resources/library'
import { ResourcesConfigSchema } from '@pi-im-bot/resources/schema'
import { PluginService } from '@pi-im-bot/plugins/service'
import { ArtifactStore } from '@pi-im-bot/artifacts/store'
import { artifactBudget } from '@pi-im-bot/artifacts/quota'

test('large plugin files publish without entering RPC frames and descriptor traversal rejects parent and leaf symlinks', async () => {
  const env = await pluginFixture()
  const outside = join(env.root, 'outside.txt')
  await Bun.write(outside, 'OUTSIDE_SENTINEL')
  const binding = await env.register(
    'files',
    `
    import { mkdir, open, symlink } from 'node:fs/promises'
    export default { operations: { async echo(input, ctx) {
      await mkdir('output', { recursive: true })
      let path = 'output/large.bin'
      if (input.text === 'leaf') { await symlink(${JSON.stringify(outside)}, 'escape'); path = 'escape' }
      else if (input.text === 'parent') { await symlink(${JSON.stringify(env.root)}, 'directory'); path = 'directory/outside.txt' }
      else {
        const file = await open(path, 'w')
        await file.truncate(8 * 1024 * 1024)
        await file.close()
      }
      const artifact = await ctx.host('artifact.publish', { path, name: 'large.bin' })
      return { text: 'PUBLISHED:' + artifact.bytes, artifactIds: [artifact.id] }
    } } }`,
    {
      operations: [
        {
          id: 'echo',
          title: 'Publish',
          description: 'File publishing',
          inputSchema: { type: 'object' },
          grants: ['artifact.write']
        }
      ],
      commands: [{ id: 'publish', names: ['publish'], operation: 'echo', description: 'Publish fixture' }]
    }
  )
  binding.instance.grants = ['artifact.write']
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
      config.bot.plugins = env.manager.config
      coordinator.plugins = new PluginService(() => {
        return config
      }, env.manager)
    }
  )
  try {
    await app.coordinator.receive(app.room.id, '/publish large')
    const sent = app.store.listOutbound(app.room.id).find((item) => {
      return item.state === 'sent' && item.text.startsWith('PUBLISHED:')
    })!
    expect(sent.text).toBe('PUBLISHED:8388608')
    const artifact = await new ArtifactStore(app.config.dataDir, app.room.id).content(sent.artifactIds[0])
    expect(artifact.metadata.bytes).toBe(8 * 1024 * 1024)
    expect(artifact.metadata.sha256).toBe(
      createHash('sha256')
        .update(Buffer.alloc(8 * 1024 * 1024))
        .digest('hex')
    )
    for (const kind of ['leaf', 'parent']) {
      await app.coordinator.receive(app.room.id, '/publish ' + kind)
      const result = app.store.listMessages(app.room.id, 20).at(-1)!.text
      expect(result).not.toContain('OUTSIDE_SENTINEL')
      expect(result).not.toContain('/proc/self/fd')
      expect(result).not.toContain(env.root)
    }
    expect((await artifactBudget(app.config.dataDir).status()).items).toBe(1)
    expect(app.requests).toHaveLength(0)
  } finally {
    await app.close()
    await env.close()
  }
})
