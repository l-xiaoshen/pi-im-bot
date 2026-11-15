import { z } from "zod"
import type { Outbound } from "./delivery"
import type { Observation } from "@pi-im-bot/plugins/observations/schema"
import { RenderPlanSchema, type RenderAdmission } from "./rendering"

export const PresentationResultSchema = z
  .object({
    text: z.string().max(100000),
    artifactIds: z.array(z.uuid()).max(256),
    allow: z.boolean(),
    reason: z.string().max(500).optional(),
    handlers: z.array(z.string()).max(6400).default([]),
    render: RenderPlanSchema.optional()
  })
  .strict()
export type PresentationResult = z.infer<typeof PresentationResultSchema>

export interface DeliveryPresentation {
  key: string
  captureAdmission?(): RenderAdmission
  enqueue?(outbound: Outbound): Promise<string>
  inline?(outbound: Outbound): Promise<{ text: string; artifactIds: string[] } | undefined>
  validateInline?(outbound: Outbound): void
  validateRender?(outbound: Outbound): void
  prepare(text: string, artifactIds: string[], mixed?: boolean): Promise<PresentationResult>
  validate(handlers: readonly string[]): void
  receipt?(outbound: Outbound): void
  observation?(outbound: Outbound): Observation | undefined
}

export class DeliverySuppressed extends Error {}
