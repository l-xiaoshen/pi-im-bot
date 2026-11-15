import { expect, test } from 'bun:test'
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import { jobHarness, untilJob } from './job-harness'
import { responsesReply } from './responses-fixture'
import { JobIndex, Jobs } from '@pi-im-bot/jobs/documents'
import { JobSchema, JobSummarySchema, jobSummary, type JobSummary } from '@pi-im-bot/jobs/schema'
import { JobHistoryHead, JobHistoryPage, historyScope, historyPageKey } from '@pi-im-bot/jobs/history'
import { localIdentity } from '@pi-im-bot/permissions/identity'

test('a revised old Job returns to newest history without stale revisions, page gaps or active duplicates', async () => {
  const entered = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  let calls = 0
  const app = await jobHarness(async () => {
    calls += 1
    if (calls === 1) {
      entered.resolve()
      await release.promise
    }
    return responsesReply({ kind: 'text', text: 'revised result' })
  })
  const invocation = app.coordinator.jobInvocation(
    app.room.id,
    localIdentity('mock', 'mock-bot'),
    'revise old work'
  )
  const id = crypto.randomUUID()
  const historicalIds = Array.from({ length: 259 }, () => {
    return crypto.randomUUID()
  })
  const original = JobSchema.parse({
    id,
    roomId: app.room.id,
    currentRevision: 1,
    revisions: {
      '1': {
        revision: 1,
        title: 'oldest job',
        spec: { kind: 'agent', prompt: 'old work' },
        state: 'succeeded',
        delivery: 'sent',
        createdAt: 1,
        finishedAt: 2,
        deadlineAt: Date.now() + 10000,
        sourceRunId: invocation.runId,
        sourceMessageIds: [],
        context: invocation.input.context,
        configSnapshot: app.coordinator.snapshotConfiguration(app.config),
        childConversationId: 'old-job:' + id,
        mode: 'live'
      }
    }
  })
  async function history(roomId?: string) {
    const result: JobSummary[] = []
    let page = await app.jobs.repository.history(roomId)
    result.push(...page.jobs)
    while (page.nextPage !== undefined) {
      page = await app.jobs.repository.history(roomId, page.nextPage)
      result.push(...page.jobs)
    }
    return result
  }
  try {
    await app.runtime.native.commit(async (tx) => {
      const document = await tx.doc(Jobs, id, null)
      document.value = JobSchema.parse(JSON.parse(JSON.stringify(original)))
      const legacy = await tx.doc(JobIndex)
      legacy.jobs[id] = JobSummarySchema.parse(JSON.parse(JSON.stringify(jobSummary(original))))
      for (let n = 2; n <= 260; n += 1) {
        legacy.jobs[historicalIds[n - 2]] = JobSummarySchema.parse({
          id: historicalIds[n - 2],
          roomId: app.room.id,
          title: 'later job',
          revision: 1,
          state: 'succeeded',
          delivery: 'sent',
          createdAt: n,
          updatedAt: n
        })
      }
    }, BACKGROUND_CONTEXT)
    expect((await app.jobs.repository.list(app.room.id, 1))[0].id).not.toBe(id)
    await app.coordinator.receive(app.room.id, '/job ' + id)
    expect(app.store.listMessages(app.room.id).at(-1)?.text).toContain('oldest job')
    // Existing pass2 history projections have no links. Retain their rows and rebuild links once.
    await app.runtime.native.commit(async (tx) => {
      for (const scope of [historyScope(), historyScope(app.room.id)]) {
        const head = await tx.doc(JobHistoryHead, scope, null)
        delete head.linked
        delete head.latest
        for (let n = 0; n <= head.page; n += 1) {
          const page = await tx.doc(JobHistoryPage, historyPageKey(scope, n), null)
          delete page.previous
          delete page.next
        }
      }
    }, BACKGROUND_CONTEXT)
    await app.coordinator.receive(app.room.id, '/job update ' + id + ' 1 new revision')
    await entered.promise
    const active = (await app.jobs.repository.list(app.room.id)).filter((job) => {
      return job.id === id
    })
    expect(active).toHaveLength(1)
    expect(active[0].revision).toBe(2)
    expect(
      (await history(app.room.id)).some((job) => {
        return job.id === id
      })
    ).toBe(false)
    release.resolve()
    await untilJob(async () => {
      return (await app.jobs.repository.get(id)).revisions['2'].delivery === 'sent'
    }, 'revision should finish')
    expect((await app.jobs.repository.list(app.room.id, 1))[0]).toMatchObject({
      id,
      revision: 2,
      state: 'succeeded'
    })
    for (const scope of [undefined, app.room.id]) {
      const archived = await history(scope)
      expect(archived).toHaveLength(260)
      expect(
        new Set(
          archived.map((job) => {
            return job.id
          })
        ).size
      ).toBe(260)
      expect(
        archived.filter((job) => {
          return job.id === id
        })
      ).toMatchObject([{ id, revision: 2 }])
    }
    // Moving every current entry out of the oldest page must unlink that now-empty page.
    await app.runtime.native.commit(async (tx) => {
      const document = await tx.doc(Jobs, id, null)
      const base = document.value!
      for (let n = 2; n <= 128; n += 1) {
        const moved = JobSchema.parse(JSON.parse(JSON.stringify({ ...base, id: historicalIds[n - 2] })))
        moved.revisions['2'].state = 'running'
        moved.revisions['2'].delivery = 'pending'
        await app.jobs.repository.save(tx, moved)
      }
    }, BACKGROUND_CONTEXT)
    let page = await app.jobs.repository.history(app.room.id)
    const pages: number[] = []
    while (page.nextPage !== undefined) {
      pages.push(page.nextPage)
      page = await app.jobs.repository.history(app.room.id, page.nextPage)
    }
    expect(pages).not.toContain(0)
    expect(
      (await history(app.room.id)).filter((job) => {
        return job.id === id
      })
    ).toHaveLength(1)
    await app.restart()
    expect(
      (await app.jobs.repository.list(app.room.id, 1)).filter((job) => {
        return job.id === id
      })
    ).toMatchObject([{ id, revision: 2 }])
    expect(calls).toBe(1)
  } finally {
    release.resolve()
    await app.close()
  }
})
