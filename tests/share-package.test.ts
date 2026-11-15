import { expect, test } from 'bun:test'
import { pluginArchive } from '@pi-im-bot/plugins/install/archive'

test('plugin export rejects internal agent files at every depth and retains ordinary documentation', () => {
  for (const path of [
    'AGENTS.md',
    'notes/AGENTS.md',
    'AGENTS.override.md',
    'notes/AGENTS.override.md',
    '.codex/handoff.md',
    'notes/.codex/handoff.md'
  ]) {
    expect(() => {
      pluginArchive(new Map([[path, Buffer.from('private fixture')]]))
    }).toThrow('分享内容不得包含')
  }
  expect(pluginArchive(new Map([['README.md', Buffer.from('Public documentation')]])).length).toBeGreaterThan(
    0
  )
})
