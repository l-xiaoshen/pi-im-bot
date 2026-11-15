import { expect, test } from 'bun:test'
import { mkdir, symlink, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { pluginFixture } from './plugin-fixture'
import { importPlugin, verifyPlugin, pluginPackageRoot } from '@pi-im-bot/plugins/package'
import { PluginManifestSchema } from '@pi-im-bot/plugins/manifest'
import { PluginPackageSchema } from '@pi-im-bot/plugins/config'

test('plugin import executes neither entry nor installation scripts and preserves immutable versions', async () => {
  const env = await pluginFixture()
  try {
    const marker = join(env.root, 'should-not-exist')
    const binding = await env.register(
      'snapshot',
      `await Bun.write(${JSON.stringify(marker)}, 'ran')\nexport default {}`
    )
    const directory = binding.instance.sourceDir
    const manifest = { ...binding.bundle.manifest, files: ['main.mjs', 'package.json'] }
    await Bun.write(
      join(directory, 'package.json'),
      JSON.stringify({ scripts: { postinstall: 'touch ' + marker } })
    )
    await Bun.write(join(directory, 'plugin.json'), JSON.stringify(manifest))
    const before = await importPlugin(binding.instance, env.root, env.manager.paths.packageDir)
    expect(await Bun.file(marker).exists()).toBe(false)
    await Bun.write(join(directory, 'main.mjs'), 'export default { changed: true }')
    await verifyPlugin(env.manager.paths.packageDir, before)
    const after = await importPlugin(binding.instance, env.root, env.manager.paths.packageDir)
    expect(after.revision).not.toBe(before.revision)
    expect(await Bun.file(marker).exists()).toBe(false)
    await Bun.write(join(pluginPackageRoot(env.manager.paths.packageDir, before), 'main.mjs'), 'modified')
    await expect(verifyPlugin(env.manager.paths.packageDir, before)).rejects.toThrow('快照内容')
    const escaped = structuredClone(after)
    escaped.files[0].path = '../outside.mjs'
    expect(PluginPackageSchema.safeParse(escaped).success).toBe(false)
    expect(
      PluginManifestSchema.safeParse({ ...manifest, files: [...manifest.files, 'package-index.json'] })
        .success
    ).toBe(false)
  } finally {
    await env.close()
  }
})

test('plugin file symlinks, symlinked parent directories and traversal entries are rejected at import', async () => {
  const env = await pluginFixture()
  try {
    const binding = await env.register('links', 'export default {}')
    const directory = binding.instance.sourceDir
    const outside = join(env.root, 'outside')
    await mkdir(outside)
    await Bun.write(join(outside, 'main.mjs'), 'export default {}')
    await rm(join(directory, 'main.mjs'))
    await symlink(join(outside, 'main.mjs'), join(directory, 'main.mjs'))
    await expect(importPlugin(binding.instance, env.root, env.manager.paths.packageDir)).rejects.toThrow(
      '符号链接'
    )
    await symlink(outside, join(directory, 'linked'))
    await Bun.write(
      join(directory, 'plugin.json'),
      JSON.stringify({ ...binding.bundle.manifest, entry: 'linked/main.mjs', files: ['linked/main.mjs'] })
    )
    await expect(importPlugin(binding.instance, env.root, env.manager.paths.packageDir)).rejects.toThrow(
      '符号链接'
    )
    expect(
      PluginManifestSchema.safeParse({
        ...binding.bundle.manifest,
        entry: '../outside/main.mjs',
        files: ['../outside/main.mjs']
      }).success
    ).toBe(false)
  } finally {
    await env.close()
  }
})
