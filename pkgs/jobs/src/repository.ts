import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context"
import type { Tx } from "@earendil-works/pi-durable"
import type { DurableAgentRuntime } from "@pi-im-bot/agent/durable/runtime"
import { Jobs } from "./documents"
import { JobActivity, initializeJobIndex, indexJob, jobOutstanding } from "./index"
import { JobHistoryHead, JobHistoryPage, historyScope, historyPageKey } from "./history"
import { JobSchema, JobSummarySchema, jobSummary, type Job, type JobRevision, type JobSummary } from "./schema"

interface JobHistoryResult {
  jobs: JobSummary[]
  nextPage?: number
}

export class JobRepository {
  private ready?: Promise<void>
  constructor(private readonly runtime: DurableAgentRuntime) {}

  initialize() {
    this.ready ??= this.runtime.native
      .commit(async (tx) => {
        await initializeJobIndex(tx)
      }, BACKGROUND_CONTEXT)
      .catch((error) => {
        this.ready = undefined
        throw error
      })
    return this.ready
  }

  async get(id: string, roomId?: string) {
    const stored = await this.runtime.native.snapshot(Jobs, id, BACKGROUND_CONTEXT)
    const job = stored?.value
    if (!job || (roomId !== undefined && job.roomId !== roomId)) {
      throw new Error("当前会话中不存在该任务")
    }
    return JobSchema.parse(job)
  }

  async list(roomId?: string, limit = 100) {
    const active = await this.active(roomId)
    const activeIds = new Set(
      active.map((job) => {
        return job.id
      })
    )
    const completed: JobSummary[] = []
    let beforePage: number | undefined
    const maximum = Math.min(Math.max(0, limit), 1000)
    while (completed.length < maximum) {
      const page = await this.history(roomId, beforePage)
      completed.push(
        ...page.jobs
          .filter((job) => {
            return !activeIds.has(job.id)
          })
          .slice(0, maximum - completed.length)
      )
      if (page.nextPage === undefined) {
        break
      }
      beforePage = page.nextPage
    }
    return [...active, ...completed]
  }

  async active(roomId?: string) {
    await this.initialize()
    const index = await this.runtime.native.snapshot(JobActivity, BACKGROUND_CONTEXT)
    return Object.values(index?.jobs ?? {})
      .filter((job) => {
        return roomId === undefined || job.roomId === roomId
      })
      .sort((a, b) => {
        return b.createdAt - a.createdAt
      })
  }

  async history(roomId?: string, beforePage?: number): Promise<JobHistoryResult> {
    await this.initialize()
    const scope = historyScope(roomId)
    const latest = await this.runtime.native.commit(async (tx) => {
      const head = await tx.doc(JobHistoryHead, scope, null)
      return head.latest ?? null
    }, BACKGROUND_CONTEXT)
    if (latest === null) {
      return { jobs: [] }
    }
    let page = latest
    if (beforePage !== undefined) {
      page = Math.min(beforePage, page)
    }
    const stored = await this.runtime.native.snapshot(JobHistoryPage, historyPageKey(scope, page), BACKGROUND_CONTEXT)
    const result: JobHistoryResult = {
      jobs: Object.values(stored?.jobs ?? {})
        .reverse()
        .filter((job) => {
          return !jobOutstanding(job)
        })
    }
    if (stored?.previous !== undefined && stored.previous !== null) {
      result.nextPage = stored.previous
    }
    return result
  }

  async save(tx: Tx, job: Job) {
    const document = await tx.doc(Jobs, job.id, null)
    document.value = JobSchema.parse(JSON.parse(JSON.stringify(job)))
    await initializeJobIndex(tx)
    await indexJob(tx, JobSummarySchema.parse(JSON.parse(JSON.stringify(jobSummary(job)))))
  }

  async change(tx: Tx, id: string, revision: number, update: (value: JobRevision) => void) {
    const document = await tx.doc(Jobs, id, null)
    if (!document.value) {
      throw new Error("任务不存在")
    }
    const job = JobSchema.parse(document.value)
    const value = job.revisions[String(revision)]
    if (!value) {
      throw new Error("任务版本不存在")
    }
    update(value)
    await this.save(tx, job)
    return job
  }
}
