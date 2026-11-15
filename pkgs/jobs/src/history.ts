import { defineDocFamily, type Tx } from '@earendil-works/pi-durable'
import type { JobSummary } from './schema'

export const jobHistoryPageSize = 128

export const JobHistoryHead = defineDocFamily<
  {
    page: number
    size: number
    latest?: number | null
    linked?: boolean
  },
  null
>({
  kind: 'bot.job-history-head',
  version: 1,
  scope: 'session',
  family: true,
  initial: () => ({ page: 0, size: 0, latest: null, linked: true }),
  checkpointWhen: () => true
})
export const JobHistoryPage = defineDocFamily<
  {
    jobs: Record<string, JobSummary>
    previous?: number | null
    next?: number | null
  },
  null
>({
  kind: 'bot.job-history-page',
  version: 1,
  scope: 'session',
  family: true,
  initial: () => ({ jobs: {} }),
  checkpointWhen: (_value, _ops, info) => {
    return info.deltasSinceBase >= 128
  }
})

export function historyScope(roomId?: string) {
  return JSON.stringify([roomId ?? null])
}
export function historyPageKey(scope: string, page: number) {
  return JSON.stringify([scope, page])
}

/** Old page projections gain links once; subsequent operations touch only a page and its neighbors. */
export async function linkedHistory(tx: Tx, scope: string) {
  const head = await tx.doc(JobHistoryHead, scope, null)
  if (head.linked) {
    return head
  }
  let previous: number | null = null
  for (let number = 0; number <= head.page; number += 1) {
    const page = await tx.doc(JobHistoryPage, historyPageKey(scope, number), null)
    page.previous = previous
    page.next = null
    if (Object.keys(page.jobs).length === 0) {
      continue
    }
    if (previous !== null) {
      const prior = await tx.doc(JobHistoryPage, historyPageKey(scope, previous), null)
      prior.next = number
    }
    previous = number
  }
  head.latest = previous
  head.linked = true
  return head
}

export async function updateHistory(
  tx: Tx,
  scope: string,
  number: number | null,
  summary: JobSummary,
  active: boolean
) {
  const head = await linkedHistory(tx, scope)
  if (number !== null) {
    const page = await tx.doc(JobHistoryPage, historyPageKey(scope, number), null)
    if (active || page.jobs[summary.id]?.revision !== summary.revision) {
      delete page.jobs[summary.id]
      if (Object.keys(page.jobs).length === 0) {
        if (number === head.page) {
          head.size = 0
        }
        const previous = page.previous ?? null
        const next = page.next ?? null
        if (previous !== null) {
          const prior = await tx.doc(JobHistoryPage, historyPageKey(scope, previous), null)
          prior.next = next
        }
        if (next !== null) {
          const after = await tx.doc(JobHistoryPage, historyPageKey(scope, next), null)
          after.previous = previous
        }
        if (head.latest === number) {
          head.latest = previous
        }
      }
      number = null
    }
  }
  if (active) {
    return null
  }
  if (number === null) {
    if (head.size >= jobHistoryPageSize || (head.latest !== head.page && head.size > 0)) {
      head.page += 1
      head.size = 0
    }
    number = head.page
    if (head.latest !== number) {
      const page = await tx.doc(JobHistoryPage, historyPageKey(scope, number), null)
      page.previous = head.latest ?? null
      page.next = null
      if (head.latest !== undefined && head.latest !== null) {
        const previous = await tx.doc(JobHistoryPage, historyPageKey(scope, head.latest), null)
        previous.next = number
      }
      head.latest = number
    }
    head.size += 1
  }
  const page = await tx.doc(JobHistoryPage, historyPageKey(scope, number), null)
  page.jobs[summary.id] = summary
  return number
}
