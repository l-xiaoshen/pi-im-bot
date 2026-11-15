import { defineDoc, defineDocFamily, type Tx } from "@earendil-works/pi-durable"
import { JobIndex } from "./documents"
import { jobTerminal, type JobSummary } from "./schema"
import { updateHistory, historyScope } from "./history"
import type { RenderRejection } from "@pi-im-bot/contracts/rendering"

export const JobActivity = defineDoc<{
  migrated: boolean
  jobs: Record<string, JobSummary>
}>({
  kind: "bot.job-activity",
  version: 1,
  scope: "session",
  initial: () => ({ migrated: false, jobs: {} }),
  checkpointWhen: (_value, _ops, info) => {
    return info.deltasSinceBase >= 128
  }
})

export const JobRequests = defineDocFamily<{ jobId: string | null; renderRejection?: RenderRejection }, null>({
  kind: "bot.job-request",
  version: 1,
  scope: "session",
  family: true,
  initial: () => ({ jobId: null }),
  checkpointWhen: () => true
})
export const JobAdmissions = defineDocFamily<{ count: number }, null>({
  kind: "bot.job-admissions",
  version: 1,
  scope: "session",
  family: true,
  initial: () => ({ count: 0 }),
  checkpointWhen: () => true
})
const JobLocation = defineDocFamily<
  {
    global: number | null
    room: number | null
  },
  null
>({
  kind: "bot.job-history-location",
  version: 1,
  scope: "session",
  family: true,
  initial: () => ({ global: null, room: null }),
  checkpointWhen: () => true
})

export function jobOutstanding(job: JobSummary) {
  return !jobTerminal(job.state) || job.delivery === "pending"
}
export async function indexJob(tx: Tx, summary: JobSummary) {
  const activity = await tx.doc(JobActivity)
  const location = await tx.doc(JobLocation, summary.id, null)
  if (jobOutstanding(summary)) {
    activity.jobs[summary.id] = summary
  } else {
    delete activity.jobs[summary.id]
  }
  location.global = await updateHistory(tx, historyScope(), location.global, summary, jobOutstanding(summary))
  location.room = await updateHistory(tx, historyScope(summary.roomId), location.room, summary, jobOutstanding(summary))
}

/** One atomic conversion; interrupted commits retain the entire original index for the next open. */
export async function initializeJobIndex(tx: Tx) {
  const activity = await tx.doc(JobActivity)
  if (activity.migrated) {
    return activity
  }
  const legacy = await tx.doc(JobIndex)
  const summaries = Object.values(legacy.jobs).sort((a, b) => {
    return a.createdAt - b.createdAt
  })
  for (const summary of summaries) {
    await indexJob(tx, summary)
  }
  for (const [key, id] of Object.entries(legacy.requests)) {
    const request = await tx.doc(JobRequests, key, null)
    request.jobId = id
  }
  for (const [key, count] of Object.entries(legacy.admissions)) {
    const admission = await tx.doc(JobAdmissions, key, null)
    admission.count = count
  }
  // Data is copied into keyed receipts and archive pages before retiring the monolithic projection.
  legacy.jobs = {}
  legacy.requests = {}
  legacy.admissions = {}
  activity.migrated = true
  return activity
}
