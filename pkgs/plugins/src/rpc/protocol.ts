import { MessageFormatSchema, BusinessStatusSchema, BusinessItemSchema } from "@pi-im-bot/contracts/message-format"
import { z } from "zod"
import { AddressSchema } from "@pi-im-bot/contracts/message"
import { PluginIdSchema, PluginLocalIdSchema } from "../manifest"

export const PluginOriginSchema = z.enum(["im", "command", "schedule", "job", "tool", "admin"])
export const PluginInvocationViewSchema = z.object({
  id: z.uuid(),
  parentId: z.string().optional(),
  instanceId: PluginIdSchema,
  generation: z.string(),
  scope: z.object({ id: z.string(), address: AddressSchema }),
  conversationId: z.string(),
  conversationEpoch: z.number().int().nonnegative(),
  origin: PluginOriginSchema,
  deadlineAt: z.number(),
  actors: z
    .array(z.object({ id: z.string(), name: z.string(), origin: z.string(), role: z.string().optional() }))
    .max(20),
  settings: z.record(z.string(), z.json()),
  inputRevision: z.string(),
  grants: z.array(z.string()),
  limits: z.object({ backgroundStatelessConcurrency: z.number().int().nonnegative() }).optional()
})
export type PluginInvocationView = z.infer<typeof PluginInvocationViewSchema>
export const PluginActionSchema = z.object({
  kind: z.enum(["operation", "hook", "parser", "validate"]),
  handler: z.string().min(1).max(140),
  operation: PluginLocalIdSchema.optional(),
  phase: z.enum(["execute", "poll", "cancel", "recover", "reconcile"]).default("execute"),
  validation: z.enum(["input", "output"]).optional()
})
export type PluginAction = z.infer<typeof PluginActionSchema>
export const PluginFailureSchema = z.object({
  code: z.enum(["validation", "handler", "protocol", "permission", "cancelled", "unknown"]),
  message: z.string().max(2000)
})
export type PluginFailure = z.infer<typeof PluginFailureSchema>
export const WorkerMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("hello"), token: z.string().min(16).max(256) }).strict(),
  z.object({ type: z.literal("ready") }).strict(),
  z.object({ type: z.literal("result"), invocationId: z.uuid(), value: z.json() }).strict(),
  z.object({ type: z.literal("error"), invocationId: z.uuid(), error: PluginFailureSchema }).strict(),
  z
    .object({
      type: z.literal("host_call"),
      invocationId: z.uuid(),
      id: z.uuid(),
      method: z.string().min(1).max(160),
      params: z.record(z.string(), z.json())
    })
    .strict()
])
export type WorkerMessage = z.infer<typeof WorkerMessageSchema>
export const HostMessageSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("invoke"),
      action: PluginActionSchema,
      context: PluginInvocationViewSchema,
      input: z.json()
    })
    .strict(),
  z.object({ type: z.literal("cancel"), invocationId: z.uuid() }).strict(),
  z.object({ type: z.literal("host_result"), id: z.uuid(), value: z.json() }).strict(),
  z.object({ type: z.literal("host_error"), id: z.uuid(), error: PluginFailureSchema }).strict()
])
export type HostMessage = z.infer<typeof HostMessageSchema>

export const PluginResultSchema = z
  .object({
    text: z.string().max(100000).default(""),
    artifactIds: z.array(z.uuid()).max(256).default([]),
    value: z.json().optional(),
    suppressText: z.boolean().optional(),
    format: MessageFormatSchema.optional(),
    itemized: z.boolean().optional(),
    businessStatus: BusinessStatusSchema.optional(),
    factsComplete: z.boolean().optional(),
    items: z.array(BusinessItemSchema).max(16).optional()
  })
  .strict()
export type PluginResult = z.infer<typeof PluginResultSchema>
export const PluginOperationOutcomeSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("cancelled"), message: z.string().max(2000).optional() }).strict(),
  z.object({ status: z.literal("failed"), error: z.string().min(1).max(2000) }).strict(),
  z.object({ status: z.literal("done"), result: PluginResultSchema }).strict(),
  z
    .object({
      status: z.literal("pending"),
      handle: z.json(),
      pollAfterMs: z.number().int().min(250).max(300000).default(1000),
      message: z.string().max(2000).optional()
    })
    .strict()
])
export type PluginOperationOutcome = z.infer<typeof PluginOperationOutcomeSchema>
