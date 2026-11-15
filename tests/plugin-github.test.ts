import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { resolvePluginSource } from '@pi-im-bot/plugins/install/source'
import { PluginInstallUrlSchema } from '@pi-im-bot/plugins/install/url'
import { PluginDownloadError, type PluginSourceReader } from '@pi-im-bot/plugins/install/download'
import { pluginArchive, unpackPluginArchive } from '@pi-im-bot/plugins/install/archive'

const sha = 'a'.repeat(40)
const api = 'https://api.github.com/repos/owner/plugin'
function fixture(routes: Record<string, object | number>) {
  const calls: string[] = []
  const read: PluginSourceReader = async (url, signal) => {
    signal.throwIfAborted()
    calls.push(url)
    const value = routes[url]
    if (typeof value === 'number') {
      throw new PluginDownloadError(value)
    }
    if (!value) {
      throw new Error('Unexpected source request: ' + url)
    }
    return Buffer.from(JSON.stringify(value))
  }
  return { calls, read }
}

test('GitHub repositories without a release resolve their default branch once and download only the pinned commit', async () => {
  for (const link of [
    'https://github.com/owner/plugin',
    'https://github.com/owner/plugin.git/',
    'git@github.com:owner/plugin.git',
    'ssh://git@github.com/owner/plugin.git',
    'owner/plugin',
    'github.com/owner/plugin?tab=readme-ov-file#readme'
  ]) {
    const source = fixture({
      [api + '/releases/latest']: 404,
      [api]: { default_branch: 'main' },
      [api + '/commits/main']: { sha }
    })
    const resolved = await resolvePluginSource(link, new AbortController().signal, source.read)
    expect(resolved.url).toBe('https://codeload.github.com/owner/plugin/zip/' + sha)
    expect(resolved.origin).toEqual({
      kind: 'github-source',
      repository: 'https://github.com/owner/plugin',
      ref: 'main',
      commit: sha
    })
    expect(source.calls).toHaveLength(3)
  }
})

test('branch names with slashes, tags, commits and manifest directory links resolve without treating HTML as ZIP', async () => {
  const routes = {
    [api + '/commits/feature%2Fvoice%2Fplugins%2Ftts']: 422,
    [api + '/commits/feature%2Fvoice%2Fplugins']: 404,
    [api + '/commits/feature%2Fvoice']: { sha },
    [api + '/commits/v1.2.3%2Fplugins%2Ftts']: 404,
    [api + '/commits/v1.2.3%2Fplugins']: 404,
    [api + '/commits/v1.2.3']: { sha },
    [api + '/commits/abc1234']: { sha },
    [api + '/commits/refs%2Fheads%2Fmain']: { sha }
  }
  for (const [link, ref, directory] of [
    ['https://github.com/owner/plugin/tree/feature/voice/plugins/tts', 'feature/voice', 'plugins/tts'],
    ['https://github.com/owner/plugin/blob/v1.2.3/plugins/tts/plugin.json', 'v1.2.3', 'plugins/tts'],
    ['https://github.com/owner/plugin/commit/abc1234', 'abc1234', undefined],
    ['https://github.com/owner/plugin/archive/refs/heads/main.zip', 'refs/heads/main', undefined]
  ] as const) {
    const source = fixture(routes)
    const resolved = await resolvePluginSource(link, new AbortController().signal, source.read)
    expect(resolved.origin.ref).toBe(ref)
    expect(resolved.origin.directory).toBe(directory)
    expect(resolved.origin.commit).toBe(sha)
  }
})

test('GitHub release pages select release assets or source tags, while denied access never silently changes source', async () => {
  const archive = 'https://github.com/owner/plugin/releases/download/v2/plugin.zip'
  const source = fixture({
    [api + '/releases/latest']: {
      tag_name: 'v2',
      assets: [{ name: 'plugin.zip', browser_download_url: archive }]
    },
    [api + '/releases/tags/v1']: { tag_name: 'v1', assets: [] },
    [api + '/commits/v1']: { sha }
  })
  for (const link of [
    'https://github.com/owner/plugin',
    'https://github.com/owner/plugin/releases',
    'https://github.com/owner/plugin/releases/latest'
  ]) {
    expect((await resolvePluginSource(link, new AbortController().signal, source.read)).url).toBe(archive)
  }
  const tag = await resolvePluginSource(
    'https://github.com/owner/plugin/releases/tag/v1',
    new AbortController().signal,
    source.read
  )
  expect(tag.origin.commit).toBe(sha)
  expect(tag.origin.ref).toBe('v1')
  const denied = fixture({ [api + '/releases/latest']: 403 })
  await expect(
    resolvePluginSource('owner/plugin', new AbortController().signal, denied.read)
  ).rejects.toThrow('403')
  expect(denied.calls).toHaveLength(1)
  const direct = fixture({})
  expect((await resolvePluginSource(archive, new AbortController().signal, direct.read)).url).toBe(archive)
  expect(
    (
      await resolvePluginSource(
        'https://github.com/owner/plugin/releases/latest/download/plugin.zip',
        new AbortController().signal,
        direct.read
      )
    ).url
  ).toContain('/latest/download/')
  expect(direct.calls).toHaveLength(0)
  expect(PluginInstallUrlSchema.safeParse('file:///tmp/plugin.zip').success).toBe(false)
})

test('repository extraction selects exactly the requested plugin directory and keeps sibling packages out', async () => {
  const root = await mkdtemp('/tmp/pi-plugin-github-archive-')
  try {
    const bytes = pluginArchive(
      new Map([
        ['repo-sha/plugin.json', Buffer.from('{"id":"root"}')],
        ['repo-sha/plugins/tts/plugin.json', Buffer.from('{"id":"tts"}')],
        ['repo-sha/plugins/tts/main.ts', Buffer.from('export default {}')],
        ['repo-sha/plugins/other/plugin.json', Buffer.from('{"id":"other"}')]
      ])
    )
    await unpackPluginArchive(bytes, join(root, 'child'), new AbortController().signal, 'plugins/tts')
    expect(await Bun.file(join(root, 'child/plugin.json')).json()).toEqual({ id: 'tts' })
    expect(await Bun.file(join(root, 'child/main.ts')).exists()).toBe(true)
    expect(await Bun.file(join(root, 'child/plugins/other/plugin.json')).exists()).toBe(false)
    await expect(
      unpackPluginArchive(bytes, join(root, 'missing'), new AbortController().signal, 'missing')
    ).rejects.toThrow('没有 plugin.json')
    await expect(
      unpackPluginArchive(bytes, join(root, 'escape'), new AbortController().signal, '../other')
    ).rejects.toThrow()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
