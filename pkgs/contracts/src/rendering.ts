import { z } from 'zod'
import { ExecutionContextSchema } from './run'
import { RunInputSchema } from './run-input'
import { ArtifactAccessSchema } from '@pi-im-bot/artifacts/access'

// Core writes the admission snapshot. A plugin can choose only its own operation and arguments.
export const RenderRequestSchema = z
  .object({
    operation: z.string().regex(/^[a-z][a-z0-9_-]{0,47}$/u),
    arguments: z.record(z.string(), z.json())
  })
  .strict()
export const RenderPlanSchema = z
  .object({
    capability: z.string(),
    arguments: z.record(z.string(), z.json()),
    access: ArtifactAccessSchema
  })
  .strict()
export type RenderPlan = z.infer<typeof RenderPlanSchema>
export const RenderAdmissionSchema = z.object({
  configSnapshot: z.string(),
  mode: z.enum(['demo', 'live']),
  input: RunInputSchema.extend({ context: ExecutionContextSchema })
})
export type RenderAdmission = z.infer<typeof RenderAdmissionSchema>
export const RenderRejectionSchema = z.object({
  code: z.enum(['global_capacity', 'scope_capacity', 'run_capacity', 'worker_capacity']),
  message: z.string().max(300)
})
export type RenderRejection = z.infer<typeof RenderRejectionSchema>
export class RenderAdmissionRejected extends Error {
  constructor(readonly rejection: RenderRejection) {
    super(rejection.message)
  }
}
export class DeliveryDeferred extends Error {
  constructor(readonly jobId: string) {
    super('呈现已受理，尚未确认平台发送：' + jobId)
  }
}
