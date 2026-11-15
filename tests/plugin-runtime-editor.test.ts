import { expect, test } from 'bun:test'
import { join } from 'node:path'
import { PluginRuntimeEditor } from '@pi-im-bot/plugins/runtime/editor'
import { PluginWorkerManager } from '@pi-im-bot/plugins/runtime/manager'
import { pluginConsoleFixture } from './plugin-console-fixture'

test('execution environment applies without restart, rejects stale and busy changes, and preserves configuration on failed preparation', async () => {
  const fixture = await pluginConsoleFixture()
  const { app, service, env } = fixture
  let ready = false
  let failPreparation = false
  const editor = new PluginRuntimeEditor(
    () => {
      return app.config
    },
    service,
    fixture.mutations,
    async () => {
      return {
        ready,
        checks: [{ id: 'fixture', name: 'Authored fixture', ready, detail: 'owned only' }],
        suggestedMountCommand: undefined
      }
    },
    (config, runtime) => {
      const manager = new PluginWorkerManager(
        config.projectDir,
        runtime,
        env.backend,
        config.dataDir,
        env.manager.volumes
      )
      if (failPreparation && runtime.enabled) {
        manager.start = async () => {
          throw new Error('PREPARE_FAILED')
        }
      }
      return manager
    }
  )
  const file = Bun.file(join(app.config.configDir, 'bot.json'))
  try {
    const before = await file.text()
    let view = await editor.read()
    await expect(editor.save({ ...view, enabled: true })).rejects.toThrow('依赖')
    expect(await file.text()).toBe(before)
    ready = true
    view = await editor.save({ ...view, enabled: true })
    expect(service.available()).toBe(true)
    expect(view.applied).toBe(true)
    await expect(editor.save({ ...view, revision: 'old', enabled: false })).rejects.toThrow('变化')
    view = await editor.save({ ...view, enabled: false })
    expect(service.available()).toBe(false)
    const disabled = await file.text()
    failPreparation = true
    await expect(editor.save({ ...view, enabled: true })).rejects.toThrow('PREPARE_FAILED')
    expect(await file.text()).toBe(disabled)
    expect(service.available()).toBe(false)
    failPreparation = false
    const started = Promise.withResolvers<void>()
    const finish = Promise.withResolvers<void>()
    const active = service.scoped(app.room.id, 'owned', new AbortController().signal, async () => {
      started.resolve()
      await finish.promise
    })
    await started.promise
    try {
      await expect(editor.save({ ...view, enabled: true })).rejects.toThrow('活动调用')
    } finally {
      finish.resolve()
      await active
    }
    expect(env.backend.specifications.size).toBe(0)
    expect(app.requests).toHaveLength(0)
  } finally {
    await fixture.close()
  }
})
