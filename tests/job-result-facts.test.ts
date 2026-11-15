import { expect, test } from 'bun:test'
import { mergeExternalOutcome } from '@pi-im-bot/jobs/external/outcome'
import type { JobRevision } from '@pi-im-bot/jobs/schema'

test('external finish, cancellation and reconciliation preserve confirmed result evidence across missing or degraded updates', () => {
  const first = crypto.randomUUID()
  const second = crypto.randomUUID()
  const known: NonNullable<JobRevision['result']> = {
    summary: 'one known image, one unresolved',
    artifactIds: [first],
    businessStatus: 'partial',
    factsComplete: false,
    items: [
      { item: 0, status: 'succeeded', artifactIds: [first] },
      { item: 1, status: 'abandoned', artifactIds: [] }
    ]
  }
  for (const state of ['outcome_unknown', 'failed', 'cancelled'] as const) {
    const outcome = mergeExternalOutcome(known, { state })
    expect(outcome.result).toBe(known)
    expect(outcome.state).toBe('outcome_unknown')
  }
  const degraded = mergeExternalOutcome(known, {
    state: 'outcome_unknown',
    result: {
      summary: 'no results yet',
      artifactIds: [],
      businessStatus: 'unknown',
      factsComplete: false,
      items: [
        { item: 0, status: 'running', artifactIds: [] },
        { item: 1, status: 'running', artifactIds: [] }
      ]
    }
  })
  expect(degraded.result?.artifactIds).toEqual([first])
  expect(degraded.result?.items?.[0].status).toBe('succeeded')
  expect(degraded.result?.businessStatus).toBe('partial')
  expect(degraded.result?.summary).toBe(known.summary)
  const completed = mergeExternalOutcome(degraded.result, {
    state: 'succeeded',
    result: {
      summary: 'both completed',
      artifactIds: [first, second],
      businessStatus: 'succeeded',
      factsComplete: true,
      items: [
        { item: 0, status: 'succeeded', artifactIds: [first] },
        { item: 1, status: 'succeeded', artifactIds: [second] }
      ]
    }
  })
  expect(completed.state).toBe('succeeded')
  expect(completed.result?.artifactIds).toEqual([first, second])
  expect(completed.result?.factsComplete).toBe(true)
  expect(completed.result?.businessStatus).toBe('succeeded')
  expect(completed.result?.summary).toBe('both completed')
})
