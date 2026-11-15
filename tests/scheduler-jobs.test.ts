import { expect, test } from 'bun:test'
import { jobHarness, latestUser, untilJob } from './job-harness'
import { responsesReply } from './responses-fixture'
import { captureAuthority } from '@pi-im-bot/permissions/authorize'
import { localIdentity } from '@pi-im-bot/permissions/identity'
import type { Schedule } from '@pi-im-bot/scheduler/definition'
import { createFakeShipyard } from './shipyard-fixture'
import { ShipyardConfigSchema } from '@pi-im-bot/execution/config'

function save(env: Awaited<ReturnType<typeof jobHarness>>, prompt: string, isolated = true): Schedule {
  const authority = captureAuthority(env.coordinator.effective(env.room.id), [
    localIdentity('mock', 'mock-bot', 'creator', 'Creator')
  ])
  return env.scheduler.save(
    {
      roomId: env.room.id,
      name: 'Daily check',
      cron: '* * * * *',
      timezone: 'Asia/Shanghai',
      prompt,
      enabled: true,
      isolated
    },
    authority
  )
}

test('cron Jobs inherit their creator ceiling and use a separate conversation without moving the shared pointer', async () => {
  const env = await jobHarness(() => {
    return responsesReply({ kind: 'text', text: 'scheduled result' })
  })
  try {
    env.config.framework.defaults.resources.tools = {
      mode: 'selected',
      ids: ['chat_history', 'schedule_create']
    }
    const schedule = save(env, 'Check once')
    env.config.framework.defaults.resources.tools = { mode: 'all' }
    const job = await env.scheduler.run(schedule.id)
    await untilJob(async () => {
      return (await env.jobs.repository.get(job.id)).revisions['1'].delivery === 'sent'
    }, 'Cron result not delivered')
    const run = env.store.getRun(job.runId!)!
    expect(run.status).toBe('completed')
    expect(run.source).toBe('schedule')
    expect(run.input?.scheduled?.timezone).toBe('Asia/Shanghai')
    expect(env.requests[0]).toContain('Asia/Shanghai')
    expect(run.context?.authority.identities[0].actorId).toBe('creator')
    expect(run.context?.authority.capabilities).not.toContain('chat_send')
    expect(run.context?.conversationId).not.toBe(env.room.currentConversationId)
    expect(env.coordinator.requireRoom(env.room.id).currentConversationId).toBe(
      env.room.currentConversationId
    )
    expect(env.store.listSchedules()[0].lastJobId).toBe(job.id)
  } finally {
    await env.close()
  }
})

test('accepted cron occurrences deduplicate, remain non-overlapping after restart, and missed ticks skip instead of producing a backlog', async () => {
  const released = Promise.withResolvers<void>()
  const env = await jobHarness(async () => {
    await released.promise
    return responsesReply({ kind: 'text', text: 'CRON_RECOVERED' })
  })
  try {
    const schedule = save(env, 'Hold this scheduled work')
    const due = Date.now() - 10
    const first = await env.scheduler.run(schedule.id, 'cron:' + due, due)
    expect((await env.scheduler.run(schedule.id, 'cron:' + due, due)).id).toBe(first.id)
    await untilJob(() => {
      return env.requests.length === 1
    }, 'Scheduled agent did not start')
    await expect(env.scheduler.run(schedule.id)).rejects.toThrow('不重叠')
    await env.restart()
    await untilJob(() => {
      return env.requests.length === 2
    }, 'Scheduled agent did not resume')
    await expect(env.scheduler.run(schedule.id)).rejects.toThrow('不重叠')
    const current = env.store.listSchedules()[0]
    env.store.saveSchedule({ ...current, nextRunAt: Date.now() - 60000 })
    env.scheduler.start()
    expect(env.store.listSchedules()[0].nextRunAt).toBeGreaterThan(Date.now())
    released.resolve()
    await untilJob(async () => {
      return (await env.jobs.repository.get(first.id)).revisions['1'].delivery === 'sent'
    }, 'Recovered result missing')
    expect(await env.jobs.repository.list(env.room.id)).toHaveLength(1)
    expect(
      env.store.listMessages(env.room.id).filter((message) => {
        return message.text.includes('CRON_RECOVERED')
      })
    ).toHaveLength(1)
  } finally {
    released.resolve()
    await env.close()
  }
})

test('isolated cron occurrences keep one persistent schedule workspace while each starts with fresh model context', async () => {
  const bay = createFakeShipyard()
  const env = await jobHarness((_raw, call) => {
    if (call === 1) {
      return responsesReply({
        kind: 'tool',
        name: 'write',
        arguments: { path: '/workspace/state.txt', content: 'PERSISTED_SCHEDULE_FILE' }
      })
    }
    if (call === 2) {
      return responsesReply({ kind: 'text', text: 'FIRST_ENTRY_RESULT' })
    }
    if (call === 3) {
      return responsesReply({ kind: 'tool', name: 'read', arguments: { path: '/workspace/state.txt' } })
    }
    return responsesReply({ kind: 'text', text: 'SECOND_ENTRY_RESULT' })
  })
  try {
    env.config.bot.agent.execution = ShipyardConfigSchema.parse({
      backend: 'shipyard',
      endpoint: bay.endpoint,
      apiKey: 'test-bay-key'
    })
    const schedule = save(env, 'Update the persistent report')
    const first = await env.scheduler.run(schedule.id)
    await untilJob(async () => {
      return (await env.jobs.repository.get(first.id)).revisions['1'].delivery === 'sent'
    }, 'First occurrence did not complete')
    const second = await env.scheduler.run(schedule.id)
    await untilJob(async () => {
      return (await env.jobs.repository.get(second.id)).revisions['1'].delivery === 'sent'
    }, 'Second occurrence did not complete')
    expect(bay.creations).toBe(1)
    expect(env.requests[2]).not.toContain('FIRST_ENTRY_RESULT')
    expect(env.requests[3]).toContain('PERSISTED_SCHEDULE_FILE')
    expect(env.store.getRun(first.runId!)?.context?.conversationId).not.toBe(
      env.store.getRun(second.runId!)?.context?.conversationId
    )
  } finally {
    await env.close()
    await bay.close()
  }
})

test('an isolated scheduled entry can collect a child agent while the group remains responsive and only the composed result is delivered', async () => {
  let scheduledCalls = 0
  let childId: () => Promise<string> = async () => {
    throw new Error('Not initialized')
  }
  const childReady = Promise.withResolvers<void>()
  const childFinish = Promise.withResolvers<void>()
  const env = await jobHarness(async (raw) => {
    const text = latestUser(raw)
    if (text.includes('CHILD_WORK')) {
      childReady.resolve()
      await childFinish.promise
      return responsesReply({ kind: 'text', text: 'PRIVATE_CHILD_RESULT' })
    }
    if (!text.includes('CRON_ENTRY')) {
      return responsesReply({ kind: 'text', text: 'FAST_GROUP_REPLY' })
    }
    scheduledCalls += 1
    if (scheduledCalls === 1) {
      return responsesReply({
        kind: 'tool',
        name: 'delegate_task',
        arguments: { title: 'Child', prompt: 'CHILD_WORK' }
      })
    }
    if (scheduledCalls === 2) {
      return responsesReply({ kind: 'tool', name: 'job_wait', arguments: { id: await childId() } })
    }
    return responsesReply({ kind: 'text', text: 'COMPOSED_CRON_RESULT' })
  })
  childId = async () => {
    return (await env.jobs.repository.list(env.room.id)).find((job) => {
      return Boolean(job.parentJobId)
    })!.id
  }
  try {
    const schedule = save(env, 'CRON_ENTRY')
    const first = await env.scheduler.run(schedule.id)
    await childReady.promise
    const fast = await env.coordinator.receive(env.room.id, 'FAST_QUESTION', 'bob', 'Bob')
    expect((await env.coordinator.waitRun(fast!.id)).status).toBe('completed')
    await expect(env.scheduler.run(schedule.id)).rejects.toThrow('不重叠')
    childFinish.resolve()
    await untilJob(async () => {
      return (await env.jobs.repository.get(first.id)).revisions['1'].delivery === 'sent'
    }, 'Scheduled composition did not finish')
    expect(env.requests.at(-1)).toContain('PRIVATE_CHILD_RESULT')
    expect(
      env.store.listMessages(env.room.id).some((message) => {
        return message.text.includes('PRIVATE_CHILD_RESULT')
      })
    ).toBe(false)
    expect(
      env.store.listMessages(env.room.id).some((message) => {
        return message.text.includes('COMPOSED_CRON_RESULT')
      })
    ).toBe(true)
  } finally {
    childFinish.resolve()
    await env.close()
  }
})

test('shared-context cron leaves detached children running after its acknowledgment and stop targets the whole occurrence without stopping the group', async () => {
  let scheduledCalls = 0
  const childReady = Promise.withResolvers<void>()
  const childFinish = Promise.withResolvers<void>()
  const env = await jobHarness(async (raw) => {
    const text = latestUser(raw)
    if (text.includes('SHARED_CHILD')) {
      childReady.resolve()
      await childFinish.promise
      return responsesReply({ kind: 'text', text: 'LATE_CHILD' })
    }
    if (!text.includes('SHARED_CRON')) {
      return responsesReply({ kind: 'text', text: 'GROUP_REMAINS_AVAILABLE' })
    }
    scheduledCalls += 1
    if (scheduledCalls === 1) {
      return responsesReply({
        kind: 'tool',
        name: 'delegate_task',
        arguments: { title: 'Shared child', prompt: 'SHARED_CHILD' }
      })
    }
    return responsesReply({ kind: 'text', text: 'ACKNOWLEDGED_CRON' })
  })
  try {
    const schedule = save(env, 'SHARED_CRON', false)
    const first = await env.scheduler.run(schedule.id)
    await childReady.promise
    await untilJob(async () => {
      return (await env.jobs.repository.get(first.id)).revisions['1'].delivery === 'sent'
    }, 'Shared entry did not release the root')
    const child = (await env.jobs.repository.list(env.room.id)).find((job) => {
      return job.parentJobId === first.id
    })!
    expect(child.state).toBe('running')
    expect(env.store.getRun(first.runId!)?.context?.conversationId).toBe(env.room.currentConversationId)
    await expect(env.scheduler.run(schedule.id)).rejects.toThrow('不重叠')
    await env.scheduler.stopOccurrence(schedule.id)
    await untilJob(async () => {
      return (await env.jobs.repository.get(child.id)).revisions['1'].state === 'cancelled'
    }, 'Detached child was not cancelled with its occurrence')
    const fast = await env.coordinator.receive(env.room.id, 'A new ordinary question')
    expect((await env.coordinator.waitRun(fast!.id)).status).toBe('completed')
    expect(
      env.store.listMessages(env.room.id).some((message) => {
        return message.text.includes('LATE_CHILD')
      })
    ).toBe(false)
  } finally {
    childFinish.resolve()
    await env.close()
  }
})

test('deleting a schedule fences an admission already in flight and never resurrects the deleted schedule', async () => {
  const env = await jobHarness(() => {
    throw new Error('Deleted admission must not call a model')
  })
  try {
    const schedule = save(env, 'Must not run')
    const admission = env.scheduler.run(schedule.id)
    const deletion = env.scheduler.remove(schedule.id)
    const results = await Promise.allSettled([admission, deletion])
    expect(results[0].status).toBe('rejected')
    expect(results[1].status).toBe('fulfilled')
    expect(env.store.listSchedules()).toHaveLength(0)
    expect(await env.jobs.repository.list(env.room.id)).toHaveLength(0)
    expect(env.requests).toHaveLength(0)
  } finally {
    await env.close()
  }
})
