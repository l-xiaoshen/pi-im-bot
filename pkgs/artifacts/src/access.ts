import { z } from 'zod'

export const ArtifactAccessSchema = z.object({
  mediaIds: z.array(z.uuid()).max(16).default([]),
  capabilities: z.array(z.string()).max(16).default([]),
  plugin: z
    .object({
      instanceId: z.string(),
      grants: z.array(z.string()).max(32),
      services: z.record(z.string(), z.object({ id: z.string(), revision: z.string() })).default({})
    })
    .optional()
})
export type ArtifactAccess = z.infer<typeof ArtifactAccessSchema>
