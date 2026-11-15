import { defineDoc, defineDocFamily } from "@earendil-works/pi-durable"
import type { Job } from "./schema"

export const Jobs = defineDocFamily<{ value: Job | null }, null>({
  kind: "bot.job",
  version: 1,
  scope: "session",
  family: true,
  initial: () => ({ value: null }),
  checkpointWhen: () => false
})
export const JobFacts = defineDoc<{
  results: Array<{
    id: string
    revision: number
    title: string
    summary: string
    delivery: string
    artifactIds: string[]
  }>
}>({
  kind: "bot.job-facts",
  version: 1,
  scope: "conversation",
  history: "latest",
  fork: "current",
  initial: () => ({ results: [] }),
  checkpointWhen: () => false
})
