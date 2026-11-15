import { defineDoc, type Tx } from "@earendil-works/pi-durable"
import { initializeJobIndex } from "@pi-im-bot/jobs"
import { jobTerminal } from "@pi-im-bot/jobs/schema"

import type { ScheduleOrigin } from "./origin"
export const ScheduleOccurrences = defineDoc<{
  active: Record<string, string[]>
  latest: Record<string, { jobId: string; occurrence: string; scheduledAt: number }>
}>({
  kind: "bot.schedule-occurrences",
  version: 1,
  scope: "session",
  initial: () => ({ active: {}, latest: {} }),
  checkpointWhen: () => false
})

export class ScheduleOverlap extends Error {}

export async function admitSchedule(tx: Tx, origin: ScheduleOrigin, jobId: string) {
  const state = await tx.doc(ScheduleOccurrences)
  const index = await initializeJobIndex(tx)
  const active = (state.active[origin.id] ?? []).filter((id) => {
    const job = index.jobs[id]
    return job && (!jobTerminal(job.state) || job.delivery === "pending")
  })
  if (origin.entry && active.length > 0) {
    throw new ScheduleOverlap("上一次计划工作及其子任务尚未结束，本次不重叠执行")
  }
  state.active[origin.id] = [...new Set([...active, jobId])]
  if (origin.entry) {
    state.latest[origin.id] = { jobId, occurrence: origin.occurrence, scheduledAt: origin.scheduledAt }
  }
}

export async function releaseSchedule(tx: Tx, origin: ScheduleOrigin | undefined, jobId: string) {
  if (!origin) {
    return
  }
  const state = await tx.doc(ScheduleOccurrences)
  state.active[origin.id] = (state.active[origin.id] ?? []).filter((id) => {
    return id !== jobId
  })
}
