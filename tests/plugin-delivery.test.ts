import { expect, test } from 'bun:test'
import { pluginFixture } from './plugin-fixture'
import { jobHarness, untilJob } from './job-harness'
import { responsesReply } from './responses-fixture'
import { ResourceLibrary } from '@pi-im-bot/resources/library'
import { ResourcesConfigSchema } from '@pi-im-bot/resources/schema'
import { PluginService } from '@pi-im-bot/plugins/service'
import { pluginToolName } from '@pi-im-bot/plugins/identity'

test('disabling a plugin suppresses a completed Job awaiting delivery while the parent conversation can still finish', async () => {
  const env = await pluginFixture()
  const binding = await env.register(
    'finished',
    `export default { operations: { echo() { return { text: 'LATE_PLUGIN_JOB_RESULT' } } } }`,
    {
      operations: [
        {
          id: 'echo',
          title: 'Finished job',
          description: 'Finish before the root',
          inputSchema: { type: 'object' },
          execution: 'background'
        }
      ]
    }
  )
  const library = new ResourceLibrary(
    ResourcesConfigSchema.parse({ plugins: [binding.instance] }),
    [],
    [],
    [binding.bundle]
  )
  const reply = Promise.withResolvers<Response>()
  const app = await jobHarness(
    (_input, count) => {
      if (count === 1) {
        return responsesReply({ kind: 'tool', name: pluginToolName('finished', 'echo'), arguments: {} })
      }
      return reply.promise
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
    const run = await app.coordinator.receive(app.room.id, 'start background plugin')
    await untilJob(async () => {
      return (await app.jobs.repository.list(app.room.id))[0]?.state === 'succeeded'
    }, 'plugin did not finish')
    const job = (await app.jobs.repository.list(app.room.id))[0]
    expect(job.delivery).toBe('pending')
    app.config.resources = new ResourceLibrary(
      { ...library.config, plugins: [{ ...binding.instance, enabled: false }] },
      [],
      [],
      [binding.bundle]
    )
    app.coordinator.plugins!.configurationChanged()
    await untilJob(async () => {
      return (await app.jobs.repository.get(job.id)).revisions['1'].delivery === 'suppressed'
    }, 'disabled plugin result was not suppressed')
    expect(app.store.getRun(run!.id)?.status).toBe('running')
    reply.resolve(responsesReply({ kind: 'text', text: 'ROOT_FINISHED' }))
    expect((await app.coordinator.waitRun(run!.id)).status).toBe('completed')
    const messages = app.store.listMessages(app.room.id, 20)
    expect(
      messages.some((message) => {
        return message.text === 'ROOT_FINISHED'
      })
    ).toBe(true)
    expect(
      messages.some((message) => {
        return message.text.includes('LATE_PLUGIN_JOB_RESULT')
      })
    ).toBe(false)
  } finally {
    reply.resolve(responsesReply({ kind: 'text', text: 'cleanup' }))
    await app.close()
    await env.close()
  }
})
