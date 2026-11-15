import { defineDoc, defineDocFamily, type Tx } from "@earendil-works/pi-durable"
import { jobTerminal, type JobSummary } from "./schema"
import { updateHistory, historyScope } from "./history"
import type { RenderRejection } from "@pi-im-bot/contracts/rendering"

export const JobActivity = defineDoc<{
  jobs: Record<string, JobSummary>
}>({
  kind: "bot.job-activity",
  version: 1,
  scope: "session",
  initial: () => ({ jobs: {} }),
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

/** Initialize the current job projection. */
export async function initializeJobIndex(tx: Tx) {
  return tx.doc(JobActivity)
}
