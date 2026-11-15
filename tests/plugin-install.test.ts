import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { pluginArchive, unpackPluginArchive } from '@pi-im-bot/plugins/install/archive'
import { pluginFixture } from './plugin-fixture'
import { jobHarness, untilJob } from './job-harness'
import { responsesReply } from './responses-fixture'
import { PluginEditor } from '@pi-im-bot/plugins/editor'
import { PluginInstaller } from '@pi-im-bot/plugins/install/service'
import { ConfigurationMutations } from '@pi-im-bot/config/mutations'
import { ResourcesConfigSchema } from '@pi-im-bot/resources/schema'
import { FrameworkEditor } from '@pi-im-bot/settings/editor'
import { PluginService } from '@pi-im-bot/plugins/service'
import { ResourceLibrary } from '@pi-im-bot/resources/library'
import { createHash } from 'node:crypto'
import {
  downloadPluginFile,
  PluginDownloadError,
  type PluginSourceReader
} from '@pi-im-bot/plugins/install/download'

test('ZIP paths, link attributes, CRC and file budgets are checked before activation', async () => {
  const root = await mkdtemp('/tmp/pi-plugin-archive-test-')
  try {
    const files = new Map([
      ['plugin.json', Buffer.from('{}')],
      ['safe.tx', Buffer.from('PAYLOAD')]
    ])
    const original = pluginArchive(files)
    const badPath = Buffer.from(original)
    for (let offset = badPath.indexOf('safe.tx'); offset >= 0; offset = badPath.indexOf('safe.tx')) {
      badPath.write('../bad.', offset)
    }
    await expect(
      unpackPluginArchive(badPath, join(root, 'path'), new AbortController().signal)
    ).rejects.toThrow()
    const link = Buffer.from(original)
    const central = link.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]))
    link.writeUInt32LE(0xa1ff0000, central + 38)
    await expect(unpackPluginArchive(link, join(root, 'link'), new AbortController().signal)).rejects.toThrow(
      '链接'
    )
    const corrupted = Buffer.from(original)
    corrupted[corrupted.indexOf('PAYLOAD')] ^= 1
    await expect(
      unpackPluginArchive(corrupted, join(root, 'crc'), new AbortController().signal)
    ).rejects.toThrow('校验')
    const large = Buffer.from(original)
    large.writeUInt32LE(17 * 1024 * 1024, central + 24)
    await expect(
      unpackPluginArchive(large, join(root, 'large'), new AbortController().signal)
    ).rejects.toThrow('文件大小')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('installation pins inert packages, preserves the previous version on failed updates, exports code without settings, and executes the configured command only when invoked', async () => {
  const fixtures = await pluginFixture()
  const app = await jobHarness(() => {
    return responsesReply({ kind: 'text', text: 'unused' })
  })
  let installer: PluginInstaller | undefined
  try {
    app.config.projectDir = fixtures.root
    app.config.bot.plugins = fixtures.manager.config
    app.config.resources = ResourceLibrary.empty()
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
    installer = new PluginInstaller(editor)
    const marker = join(fixtures.root, 'entry-marker')
    const binding = await fixtures.register(
      'installable',
      `await Bun.write(${JSON.stringify(marker)}, 'executed')\nexport default {operations:{echo(input,ctx){return {text:ctx.invocation.settings.prefix+input.text}}}}`,
      {
        commands: [{ id: 'echo', names: ['install_echo'], operation: 'echo', description: 'Echo' }],
        operations: [
          {
            id: 'echo',
            title: 'Echo',
            description: 'Echo',
            inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] }
          }
        ]
      }
    )
    await Bun.write(
      join(binding.instance.sourceDir, '_conf_schema.json'),
      JSON.stringify({ prefix: { type: 'string', description: 'Prefix', default: 'INSTALLED:' } })
    )
    const initial = await editor.read()
    const job = await installer.start({ revision: initial.revision, directory: binding.instance.sourceDir })
    const service = installer
    await untilJob(async () => {
      return (await service.list()).some((entry) => {
        return entry.id === job.id && ['succeeded', 'failed'].includes(entry.stage)
      })
    }, 'Install did not finish')
    expect((await installer.list())[0].stage).toBe('succeeded')
    expect(await Bun.file(marker).exists()).toBe(false)
    let view = await editor.read()
    const instance = app.config.resources.config.plugins[0]
    expect(instance.enabled).toBe(false)
    expect(instance.settings.prefix).toBe('INSTALLED:')
    const release = view.plugins[0].bundle!.revision
    await editor.mutate(view.revision, (config) => {
      config.plugins[0].settings.prefix = 'PRIVATE_CURRENT_PREFIX:'
    })
    view = await editor.read()
    const archive = await installer.archive(instance.id)
    expect(archive.content.includes(Buffer.from('INSTALLED:'))).toBe(true)
    expect(archive.content.includes(Buffer.from('PRIVATE_CURRENT_PREFIX'))).toBe(false)
    const server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch() {
        return new Response(archive.content)
      }
    })
    try {
      const failed = await installer.start({
        revision: view.revision,
        url: 'http://127.0.0.1:' + server.port + '/plugin.zip',
        sha256: '0'.repeat(64)
      })
      await untilJob(async () => {
        return (await service.list()).some((entry) => {
          return entry.id === failed.id && entry.stage === 'failed'
        })
      }, 'Bad digest did not fail')
      expect(app.config.resources.pluginPackage(instance.id)?.revision).toBe(release)
      const installed = await installer.start({
        revision: view.revision,
        url: 'http://127.0.0.1:' + server.port + '/plugin.zip',
        sha256: createHash('sha256').update(archive.content).digest('hex')
      })
      await untilJob(async () => {
        return (await service.list()).some((entry) => {
          return entry.id === installed.id && ['succeeded', 'failed'].includes(entry.stage)
        })
      }, 'ZIP installation did not finish')
      expect((await installer.list())[0].stage).toBe('succeeded')
      expect(app.config.resources.pluginPackage(instance.id)?.origin?.archiveSha256).toBe(
        createHash('sha256').update(archive.content).digest('hex')
      )
    } finally {
      await server.stop(true)
    }
    view = await editor.read()
    await editor.manage(view.revision, instance.id, { enabled: true })
    app.coordinator.plugins = new PluginService(() => {
      return app.config
    }, fixtures.manager)
    await app.coordinator.receive(app.room.id, '/install_echo hello')
    expect(
      app.store.listMessages(app.room.id).some((message) => {
        return message.text === 'PRIVATE_CURRENT_PREFIX:hello'
      })
    ).toBe(true)
    expect(await Bun.file(marker).text()).toBe('executed')
    await installer.close()
    const commit = 'b'.repeat(40)
    const typedMarker = join(fixtures.root, 'typed-entry-marker')
    const repository = 'https://api.github.com/repos/owner/typed'
    const typedManifest = {
      apiVersion: 1,
      id: 'github-typed',
      name: 'GitHub TypeScript',
      version: '1.0.0',
      description: 'Authored source fixture',
      entry: 'main.ts',
      files: ['main.ts'],
      operations: [
        {
          id: 'echo',
          title: 'Echo',
          description: 'Echo',
          inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] }
        }
      ],
      commands: [
        { id: 'echo', names: ['github_echo'], operation: 'echo', description: 'GitHub source fixture' }
      ]
    }
    const typedArchive = pluginArchive(
      new Map([
        ['typed-sha/plugin.json', Buffer.from(JSON.stringify(typedManifest))],
        [
          'typed-sha/main.ts',
          Buffer.from(
            `await Bun.write(${JSON.stringify(typedMarker)}, 'executed')\nexport default {operations:{echo(input: {text: string}) {const prefix: string = 'TYPED:'\nreturn {text:prefix+input.text}}}}`
          )
        ],
        ['typed-sha/examples/another/plugin.json', Buffer.from('{}')]
      ])
    )
    const requests: string[] = []
    const reader: PluginSourceReader = async (url, signal, budget) => {
      signal.throwIfAborted()
      requests.push(url)
      if (url === repository + '/releases/latest') {
        throw new PluginDownloadError(404)
      }
      if (url === repository) {
        return Buffer.from(JSON.stringify({ default_branch: 'main' }))
      }
      if (url === repository + '/commits/main') {
        return Buffer.from(JSON.stringify({ sha: commit }))
      }
      if (url === 'https://codeload.github.com/owner/typed/zip/' + commit) {
        return typedArchive
      }
      return downloadPluginFile(url, signal, budget)
    }
    installer = new PluginInstaller(editor, () => {}, reader)
    view = await editor.read()
    const github = await installer.start({ revision: view.revision, url: 'git@github.com:owner/typed.git' })
    const githubInstaller = installer
    await untilJob(async () => {
      return (await githubInstaller.list()).some((entry) => {
        return entry.id === github.id && ['succeeded', 'failed'].includes(entry.stage)
      })
    }, 'GitHub source did not install')
    expect((await installer.list())[0].stage).toBe('succeeded')
    expect(app.config.resources.pluginPackage('github-typed')?.origin?.commit).toBe(commit)
    expect(requests.at(-1)).toBe('https://codeload.github.com/owner/typed/zip/' + commit)
    expect(await Bun.file(typedMarker).exists()).toBe(false)
    const restored = await ResourceLibrary.load(app.config.resources.config, app.config.dataDir)
    expect(restored.pluginPackage('github-typed')?.origin?.commit).toBe(commit)
    view = await editor.read()
    await editor.manage(view.revision, 'github-typed', { enabled: true })
    await app.coordinator.receive(app.room.id, '/github_echo source')
    expect(
      app.store.listMessages(app.room.id).some((message) => {
        return message.text === 'TYPED:source'
      })
    ).toBe(true)
    expect(await Bun.file(typedMarker).text()).toBe('executed')
    expect(app.requests).toHaveLength(0)
  } finally {
    await installer?.close()
    await app.close()
    await fixtures.close()
  }
})
