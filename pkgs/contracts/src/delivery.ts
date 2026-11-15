import { MessageFormatSchema } from './message-format'
import { z } from 'zod'
import { AttachmentSchema } from './message'
import { RenderAdmissionSchema, RenderPlanSchema, RenderRejectionSchema } from './rendering'

export const OutboundSchema = z.object({
  id: z.string(),
  roomId: z.string(),
  conversationId: z.string().optional(),
  runId: z.string().optional(),
  text: z.string(),
  format: MessageFormatSchema.optional(),
  effectiveFormat: MessageFormatSchema.optional(),
  itemized: z.boolean().optional(),
  deliveryParts: z
    .array(z.object({ artifactIds: z.array(z.string()), platformMessageIds: z.array(z.string()) }))
    .optional(),
  renderedText: z.string().optional(),
  attachments: z.array(AttachmentSchema).default([]),
  artifactIds: z.array(z.string()).default([]),
  requestedArtifactIds: z.array(z.string()).optional(),
  presentationKey: z.string().optional(),
  presentationHandlers: z.array(z.string()).default([]),
  render: RenderPlanSchema.optional(),
  renderAdmission: RenderAdmissionSchema.optional(),
  renderJobId: z.string().optional(),
  inlineRender: z.enum(['planned', 'started', 'complete', 'fallback', 'unknown']).optional(),
  renderFallback: RenderRejectionSchema.optional(),
  cancelRequested: z.boolean().default(false),
  uncertaintyStage: z.enum(['presentation', 'transport']).optional(),
  role: z.enum(['assistant', 'system']),
  state: z.enum([
    'preparing',
    'rendering',
    'prepared',
    'suppressed',
    'failed',
    'sending',
    'sent',
    'unknown',
    'cancelled'
  ]),
  messageId: z.string(),
  platformMessageIds: z.array(z.string()).default([]),
  createdAt: z.number(),
  sentAt: z.number().optional(),
  error: z.string().optional()
})
export type Outbound = z.infer<typeof OutboundSchema>
