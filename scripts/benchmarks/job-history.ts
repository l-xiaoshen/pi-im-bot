import { performance } from "node:perf_hooks"
import { jobOutstanding } from "@pi-im-bot/jobs"
import type { JobSummary } from "@pi-im-bot/jobs/schema"

let sink = 0
function measure(operation: () => number) {
  const samples: number[] = []
  for (let repeat = 0; repeat < 25; repeat += 1) {
    const started = performance.now()
    sink += operation()
    const elapsed = performance.now() - started
    if (repeat >= 5) {
      samples.push(elapsed)
    }
  }
  samples.sort((a, b) => {
    return a - b
  })
  return Number(samples[Math.floor(samples.length / 2)].toFixed(5))
}
for (const size of [1000, 10000, 100000]) {
  const jobs: Record<string, JobSummary> = {}
  const requests: Record<string, string> = {}
  const admissions: Record<string, number> = {}
  for (let n = 0; n < size; n += 1) {
    const id = "history-" + n
    jobs[id] = {
      id,
      roomId: "room",
      title: "synthetic history",
      kind: "tool",
      revision: 1,
      state: "succeeded",
      delivery: "sent",
      createdAt: n,
      updatedAt: n
    }
    requests["source-" + n + ":call"] = id
    admissions["source-" + n] = 1
  }
  const active = Object.fromEntries(
    Object.entries(jobs)
      .slice(-16)
      .map(([id, job]) => {
        return [id, { ...job, state: "running" as const, delivery: "pending" as const }]
      })
  )
  Object.assign(jobs, active)
  const newestPage = Object.values(jobs).slice(-128)
  const previousPage = Object.values(jobs).slice(-256, -128)
  const oldListMs = measure(() => {
    const history = Object.values(jobs)
      .filter((job) => {
        return job.roomId === "room"
      })
      .sort((a, b) => {
        return b.createdAt - a.createdAt
      })
    return (
      history.filter(jobOutstanding).length +
      history
        .filter((job) => {
          return !jobOutstanding(job)
        })
        .slice(0, 100).length
    )
  })
  const newListMs = measure(() => {
    return (
      Object.values(active).length +
      [...newestPage]
        .reverse()
        .filter((job) => {
          return !jobOutstanding(job)
        })
        .concat(
          [...previousPage].reverse().filter((job) => {
            return !jobOutstanding(job)
          })
        )
        .slice(0, 100).length
    )
  })
  const oldAdmissionMs = measure(() => {
    return Object.values(jobs).filter(jobOutstanding).length
  })
  const newAdmissionMs = measure(() => {
    return Object.values(active).length
  })
  console.log(
    JSON.stringify({
      size,
      oldListMs,
      newListMs,
      oldAdmissionMs,
      newAdmissionMs,
      oldHotDocumentBytes: JSON.stringify({ jobs, requests, admissions }).length,
      newActiveBytes: JSON.stringify(active).length,
      historyPageBytes: JSON.stringify(newestPage).length
    })
  )
}
console.log(
  JSON.stringify({
    sink,
    note: "Authored in-memory projection benchmark, median of 20 samples after 5 warmups. Excludes SDK storage, transaction and migration costs. No performance claim for request archive deletion."
  })
)
