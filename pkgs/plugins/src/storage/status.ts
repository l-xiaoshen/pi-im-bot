import { z } from "zod"
import { StorageStatusSchema } from "./contracts"
import { ArtifactUsageSchema } from "@pi-im-bot/artifacts/limits"

export const StorageOverviewSchema = z.object({
  executionEnabled: z.boolean(),
  data: StorageStatusSchema,
  artifacts: ArtifactUsageSchema
})
export type StorageOverview = z.infer<typeof StorageOverviewSchema>
