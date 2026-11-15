import { expect, test } from 'bun:test'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { pluginConsoleFixture } from './plugin-console-fixture'
import { untilJob } from './job-harness'
import { PluginInstaller } from '@pi-im-bot/plugins/install/service'
import { PluginMarket } from '@pi-im-bot/plugins/market/service'
import { pluginArchive } from '@pi-im-bot/plugins/install/archive'

test('force update follows the catalog across repeated same-version publications and preserves live settings after a rejected replacement', async () => {
  const fixture = await pluginConsoleFixture()
  const installer = new PluginInstaller(fixture.editor)
  const market = new PluginMarket(installer)
  let version = 1
  let broken = false
  function archive() {
    return pluginArchive(
      new Map([
        [
          'plugin.json',
          Buffer.from(
            JSON.stringify({
              apiVersion: 1,
              id: 'refreshable',
              name: 'Refreshable',
              version: '1.0.0',
              description: 'Owned fixture',
              entry: 'main.mjs',
              files: ['main.mjs']
            })
          )
        ],
        ['main.mjs', Buffer.from('export default { marker: ' + version + ' }')]
      ])
    )
  }
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request): Response {
      if (new URL(request.url).pathname === '/index.json') {
        return Response.json({
          version: 1,
          plugins: [
            {
              id: 'refreshable',
              name: 'Refreshable',
              description: 'Owned',
              version: '1.0.0',
              apiVersion: 1,
              url: 'http://127.0.0.1:' + server.port + '/v' + version + '.zip',
              sha256: createHash('sha256').update(archive()).digest('hex')
            }
          ]
        })
      }
      if (broken) {
        return new Response('broken')
      }
      return new Response(archive())
    }
  })
  async function complete(id: string, expected: 'succeeded' | 'failed' = 'succeeded') {
    await untilJob(async () => {
      return (await installer.list()).some((job) => {
        return job.id === id && ['succeeded', 'failed'].includes(job.stage)
      })
    }, 'Update did not finish')
    expect(
      (await installer.list()).find((job) => {
        return job.id === id
      })?.stage
    ).toBe(expected)
  }
  try {
    await fixture.editor.mutate((await fixture.editor.read()).revision, (config) => {
      config.pluginCatalogs = [
        { id: 'dev', name: 'Dev', url: 'http://127.0.0.1:' + server.port + '/index.json' }
      ]
    })
    const entry = (await market.refresh()).entries[0]
    await complete((await market.install(entry.key, (await fixture.editor.read()).revision)).id)
    await fixture.editor.mutate((await fixture.editor.read()).revision, (config) => {
      config.plugins[0].enabled = true
      config.plugins[0].settings = { marker: 'PRESERVED' }
    })
    let release = fixture.app.config.resources.pluginPackage('refreshable')!.revision
    for (const next of [2, 3]) {
      version = next
      await complete((await market.forceUpdate('refreshable', (await fixture.editor.read()).revision)).id)
      const current = fixture.app.config.resources.pluginPackage('refreshable')!
      expect(current.revision).not.toBe(release)
      expect(fixture.app.config.resources.config.plugins[0].settings.marker).toBe('PRESERVED')
      expect(fixture.app.config.resources.config.plugins[0].enabled).toBe(true)
      release = current.revision
    }
    const sourceId = fixture.app.config.resources.pluginPackage('refreshable')!.updateSourceId
    broken = true
    version = 4
    await complete(
      (await market.forceUpdate('refreshable', (await fixture.editor.read()).revision)).id,
      'failed'
    )
    expect(fixture.app.config.resources.pluginPackage('refreshable')?.revision).toBe(release)
    expect(fixture.app.config.resources.pluginPackage('refreshable')?.updateSourceId).toBe(sourceId)
    expect(
      await Bun.file(
        join(
          fixture.app.config.dataDir,
          'plugin-installations/update-sources/refreshable',
          sourceId + '.json'
        )
      ).exists()
    ).toBe(true)
    expect(fixture.env.backend.specifications.size).toBe(0)
  } finally {
    await installer.close()
    await server.stop(true)
    await fixture.close()
  }
})
