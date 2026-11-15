import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BotConfigSchema } from '@pi-im-bot/config/schema'
import { OneBotSettings } from '@pi-im-bot/channels/onebot/settings'
import { OneBotSettingsInputSchema } from '@pi-im-bot/channels/onebot/status'

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) {
    await rm(root, { recursive: true, force: true })
  }
})
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'pi-onebot-settings-'))
  roots.push(root)
  let config = BotConfigSchema.parse({
    agent: { execution: { backend: 'shipyard', endpoint: 'http://example.test', apiKey: 'sandbox-secret' } },
    onebot: { accessToken: 'original-token' }
  })
  const path = join(root, 'bot.json')
  await writeFile(path, JSON.stringify(config))
  const editor = new OneBotSettings(root, (next) => {
    config = next
  })
  return {
    editor,
    path,
    current() {
      return config
    }
  }
}

test('OneBot settings preserve, replace and clear tokens without exposing them or changing sandbox configuration', async () => {
  const { editor, path, current } = await setup()
  let view = await editor.read()
  expect(JSON.stringify(view)).not.toContain('original-token')
  view = await editor.save(
    OneBotSettingsInputSchema.parse({
      ...view,
      accessToken: '',
      targets: [{ selfId: '11', chatId: '33', name: 'group', enabled: true }]
    })
  )
  expect(current().onebot.accessToken).toBe('original-token')
  expect(current().agent.execution).toMatchObject({ apiKey: 'sandbox-secret' })
  view = await editor.save(OneBotSettingsInputSchema.parse({ ...view, accessToken: 'new-token' }))
  expect(view.tokenConfigured).toBe(true)
  expect(JSON.stringify(view)).not.toContain('new-token')
  expect(current().onebot.accessToken).toBe('new-token')
  view = await editor.save(OneBotSettingsInputSchema.parse({ ...view, clearToken: true }))
  expect(view.tokenConfigured).toBe(false)
  expect(BotConfigSchema.parse(JSON.parse(await readFile(path, 'utf8'))).onebot.accessToken).toBe('')
  expect(current().onebot.targets).toHaveLength(1)
})

test('stale settings and concurrent target edits cannot overwrite a newer configuration', async () => {
  const { editor, path } = await setup()
  const view = await editor.read()
  const first = OneBotSettingsInputSchema.parse({
    ...view,
    targets: [{ selfId: '11', chatId: '33', name: 'first', enabled: true }]
  })
  const second = OneBotSettingsInputSchema.parse({
    ...view,
    targets: [{ selfId: '11', chatId: '44', name: 'second', enabled: true }]
  })
  const results = await Promise.allSettled([editor.save(first), editor.save(second)])
  expect(
    results.filter((result) => {
      return result.status === 'fulfilled'
    })
  ).toHaveLength(1)
  expect(
    results.filter((result) => {
      return result.status === 'rejected'
    })
  ).toHaveLength(1)
  expect((await editor.read()).targets[0].chatId).toBe('33')
  const current = await editor.read()
  const manual = BotConfigSchema.parse(JSON.parse(await readFile(path, 'utf8')))
  manual.agent.maxConcurrentRuns = 3
  await writeFile(path, JSON.stringify(manual))
  await expect(editor.save(OneBotSettingsInputSchema.parse(current))).rejects.toThrow('已被修改')
  expect(BotConfigSchema.parse(JSON.parse(await readFile(path, 'utf8'))).agent.maxConcurrentRuns).toBe(3)
})
