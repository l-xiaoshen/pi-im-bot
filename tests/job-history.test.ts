import { expect, test } from 'bun:test'
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import { openNodeJsonlStorage } from '@earendil-works/pi-durable/storage/jsonl/node'
import { mkdtemp, rm } from 'node:fs/promises'
import { DurableAgentRuntime } from '@pi-im-bot/agent/durable/runtime'
import { JobRepository } from '@pi-im-bot/jobs/repository'
import { JobIndex, Jobs } from '@pi-im-bot/jobs/documents'
import { JobActivity, JobRequests, JobAdmissions } from '@pi-im-bot/jobs'
import { JobSummarySchema, JobSchema, jobSummary } from '@pi-im-bot/jobs/schema'
import { localIdentity } from '@pi-im-bot/permissions/identity'
import { ConversationBinding, ConversationIndex } from '@pi-im-bot/agent/durable/documents'
import { ConfigurationSnapshots } from '@pi-im-bot/config/snapshots'
import { jobHarness } from './job-harness'
import { responsesReply } from './responses-fixture'
import { join } from 'node:path'

test('legacy conversation bindings preserve the native conversation across migration and restart', async () => {
  const app = await jobHarness(() => {
    return responsesReply({ kind: 'text', text: 'unused' })
  })
  const invocation = app.coordinator.jobInvocation(
    app.room.id,
    localIdentity('mock', 'mock-bot'),
    'old binding'
  )
  const key = app.room.id + ':' + invocation.input.context.conversationId + ':' + app.room.mode
  try {
    const id = await app.runtime.native.commit(async (tx) => {
      const conversation = await tx.createConversation({ ownership: { kind: 'ownerless' } })
      const index = await tx.doc(ConversationIndex)
      index.conversations[key] = conversation.id
      return conversation.id
    }, BACKGROUND_CONTEXT)
    expect(await app.runtime.ensureConversation(app.config, app.room, invocation.input)).toBe(id)
    expect(await app.runtime.native.snapshot(ConversationBinding, key, BACKGROUND_CONTEXT)).toEqual({
      conversationId: id
    })
    await app.restart()
    expect(await app.runtime.ensureConversation(app.config, app.room, invocation.input)).toBe(id)
  } finally {
    await app.close()
  }
})

test('a recoverable tool request remains deduplicated after legacy conversion and a restart', async () => {
  const app = await jobHarness(() => {
    return responsesReply({ kind: 'text', text: 'must not run' })
  })
  const invocation = app.coordinator.jobInvocation(app.room.id, localIdentity('mock', 'mock-bot'), 'original')
  const id = crypto.randomUUID()
  const job = JobSchema.parse({
    id,
    roomId: app.room.id,
    currentRevision: 1,
    revisions: {
      '1': {
        revision: 1,
        title: 'original',
        spec: { kind: 'agent', prompt: 'original' },
        state: 'succeeded',
        delivery: 'sent',
        createdAt: 1,
        finishedAt: 2,
        deadlineAt: Date.now() + 10000,
        sourceRunId: invocation.runId,
        sourceMessageIds: [],
        context: invocation.input.context,
        configSnapshot: app.coordinator.snapshotConfiguration(app.config),
        childConversationId: 'job:' + id,
        mode: 'live'
      }
    }
  })
  try {
    await app.runtime.native.commit(async (tx) => {
      const body = await tx.doc(Jobs, id, null)
      body.value = JobSchema.parse(JSON.parse(JSON.stringify(job)))
      const legacy = await tx.doc(JobIndex)
      legacy.jobs[id] = JobSummarySchema.parse(JSON.parse(JSON.stringify(jobSummary(job))))
      legacy.requests[invocation.runId + ':completed-tool'] = id
      legacy.admissions[invocation.runId] = 1
    }, BACKGROUND_CONTEXT)
    const first = await app.jobs.start(
      invocation,
      'original',
      { kind: 'agent', prompt: 'original' },
      'completed-tool'
    )
    expect(first.id).toBe(id)
    await app.restart()
    const replay = await app.jobs.start(
      invocation,
      'original',
      { kind: 'agent', prompt: 'original' },
      'completed-tool'
    )
    expect(replay.id).toBe(id)
    expect(app.requests).toHaveLength(0)
    expect(await app.jobs.repository.list(app.room.id)).toHaveLength(1)
  } finally {
    await app.close()
  }
})

test('legacy history migrates into pages while permanent request receipts and admission budgets survive reopening', async () => {
  const root = await mkdtemp('/tmp/pi-job-history-')
  let runtime = await new DurableAgentRuntime().open(await openNodeJsonlStorage(root, BACKGROUND_CONTEXT))
  try {
    await runtime.native.commit(async (tx) => {
      const legacy = await tx.doc(JobIndex)
      for (let n = 0; n < 300; n += 1) {
        const summary = JobSummarySchema.parse({
          id: 'history-' + n,
          roomId: 'room',
          title: 'job',
          revision: 1,
          state: 'succeeded',
          delivery: 'sent',
          createdAt: n,
          updatedAt: n
        })
        legacy.jobs[summary.id] = summary
      }
      legacy.jobs.active = JobSummarySchema.parse({
        id: 'active',
        roomId: 'room',
        title: 'active',
        revision: 1,
        state: 'running',
        delivery: 'pending',
        createdAt: 301,
        updatedAt: 301
      })
      legacy.requests['recoverable-run:call-with:colons'] = 'history-0'
      legacy.admissions['recoverable-run'] = 3
    }, BACKGROUND_CONTEXT)
    const repository = new JobRepository(runtime)
    expect(await repository.list('room', 5)).toHaveLength(6)
    let page = await repository.history('room')
    const ids = page.jobs.map((job) => {
      return job.id
    })
    expect(page.jobs).toHaveLength(44)
    while (page.nextPage !== undefined) {
      page = await repository.history('room', page.nextPage)
      expect(page.jobs.length).toBeLessThanOrEqual(128)
      ids.push(
        ...page.jobs.map((job) => {
          return job.id
        })
      )
    }
    expect(new Set(ids).size).toBe(300)
    expect(Object.keys((await runtime.native.snapshot(JobActivity, BACKGROUND_CONTEXT))!.jobs)).toEqual([
      'active'
    ])
    expect(
      await runtime.native.snapshot(JobRequests, 'recoverable-run:call-with:colons', BACKGROUND_CONTEXT)
    ).toEqual({ jobId: 'history-0' })
    expect(await runtime.native.snapshot(JobAdmissions, 'recoverable-run', BACKGROUND_CONTEXT)).toEqual({
      count: 3
    })
    await runtime.close()
    runtime = await new DurableAgentRuntime().open(await openNodeJsonlStorage(root, BACKGROUND_CONTEXT))
    const reopened = new JobRepository(runtime)
    expect(await reopened.list('room', 5)).toHaveLength(6)
    expect(
      await runtime.native.snapshot(JobRequests, 'recoverable-run:call-with:colons', BACKGROUND_CONTEXT)
    ).toEqual({ jobId: 'history-0' })
    expect((await runtime.native.snapshot(JobIndex, BACKGROUND_CONTEXT))!.requests).toEqual({})
  } finally {
    await runtime.close()
    await rm(root, { recursive: true, force: true })
  }
})

test('snapshot cache eviction preserves old archives and a repaired read can retry after failure', async () => {
  const app = await jobHarness(() => {
    return responsesReply({ kind: 'text', text: 'unused' })
  })
  const snapshots = new ConfigurationSnapshots(() => {
    return app.config
  })
  try {
    const first = snapshots.save(app.config)
    const originalPort = app.config.bot.server.port
    for (let n = 0; n < 140; n += 1) {
      app.config.bot.server.port = 20000 + n
      const id = snapshots.save(app.config)
      await snapshots.load(id)
    }
    expect((await snapshots.load(first)).bot.server.port).toBe(originalPort)
    const last = snapshots.save(app.config)
    const file = join(app.config.dataDir, 'configuration-snapshots', last + '.json')
    const contents = await Bun.file(file).text()
    const fresh = new ConfigurationSnapshots(() => {
      return app.config
    })
    await Bun.write(file, '{}')
    await expect(fresh.load(last)).rejects.toThrow('修改')
    await Bun.write(file, contents)
    expect((await fresh.load(last)).bot.server.port).toBe(20139)
  } finally {
    await app.close()
  }
})
