import { z } from "zod"
import { TriggerIdentitySchema } from "@pi-im-bot/permissions/identity"

const PendingAdmissionSchema = z.object({
  state: z.enum(["pending", "dispatching"]),
  control: z.boolean().default(false),
  prompt: z.string(),
  identity: TriggerIdentitySchema,
  epoch: z.number(),
  expiresAt: z.number()
})

export const InboundAdmissionSchema = z.union([
  PendingAdmissionSchema,
  z.object({ state: z.literal("accepted"), outcome: z.enum(["agent", "command", "recorded"]) }),
  z.object({ state: z.enum(["unknown", "expired", "cancelled"]), error: z.string() })
])
