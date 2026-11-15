import { z } from "zod"
import { PluginOverridesSchema } from "@pi-im-bot/plugins/config"

export const ResourceSelectionSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("all") }),
  z.object({ mode: z.literal("selected"), ids: z.array(z.string().min(1)).max(200) })
])

export const PermissionSubjectSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("everyone") }),
  z.object({ kind: z.literal("local") }),
  z.object({ kind: z.literal("mock") }),
  z.object({
    kind: z.literal("platform-user"),
    channel: z.string().min(1),
    accountId: z.string().min(1),
    actorId: z.string().min(1)
  }),
  z.object({
    kind: z.literal("platform-role"),
    channel: z.string().min(1),
    accountId: z.string().min(1),
    role: z.enum(["owner", "admin", "member"])
  })
])
export const PermissionPolicySchema = z.object({
  default: z.enum(["allow", "deny"]).default("allow"),
  rules: z
    .array(
      z.object({
        effect: z.enum(["allow", "deny"]),
        capabilities: z.array(z.string().min(1)).min(1),
        subjects: z.array(PermissionSubjectSchema).min(1)
      })
    )
    .max(200)
    .default([])
})
export type PermissionPolicy = z.infer<typeof PermissionPolicySchema>

export const DataSettingsSchema = z.object({
  includeQuotes: z.boolean().default(true),
  quoteChars: z.number().int().min(0).max(8000).default(2000),
  visionEnabled: z.boolean().default(true),
  imageMaxCount: z.number().int().min(1).max(8).default(4),
  imageMaxSide: z.number().int().min(256).max(4096).default(1536),
  imageBudgetBytes: z
    .number()
    .int()
    .min(65536)
    .max(16 * 1024 * 1024)
    .default(4 * 1024 * 1024),
  includeSpeaker: z.boolean().default(true),
  includeTime: z.boolean().default(false),
  historyLimit: z.number().int().min(1).max(100).default(30),
  historyChars: z.number().int().min(500).max(100000).default(12000)
})
export const PreferenceSettingsSchema = z.object({
  personaId: z.string().min(1).default("default"),
  providerGroup: z.string().min(1).default("main"),
  replyStyle: z.string().max(4000).default("")
})
export const BehaviorSettingsSchema = z.object({
  maxJobsPerRun: z.number().int().min(1).max(10).default(3),
  maxOutstandingJobs: z.number().int().min(1).max(200).default(20),
  jobTimeoutMs: z.number().int().min(1000).max(86400000).default(3600000),
  batchQuietMs: z.number().int().min(0).max(5000).default(600),
  batchMaxHoldMs: z.number().int().min(50).max(10000).default(2000),
  batchMaxRequests: z.number().int().min(1).max(20).default(6),
  batchMaxChars: z.number().int().min(500).max(100000).default(10000),
  queueMaxAgeMs: z.number().int().min(1000).max(3600000).default(120000),
  agentEnabled: z.boolean().default(true),
  allowProactive: z.boolean().default(true),
  timeoutMs: z.number().int().min(1000).max(3600000).default(600000),
  maxModelCalls: z.number().int().min(1).max(100).default(20)
})
export const OutputSettingsSchema = z.object({
  trim: z.boolean().default(true)
})
export const ResourceSettingsSchema = z.object({
  tools: ResourceSelectionSchema.prefault({ mode: "all" }),
  mcp: ResourceSelectionSchema.prefault({ mode: "all" }),
  skills: ResourceSelectionSchema.prefault({ mode: "all" }),
  plugins: ResourceSelectionSchema.prefault({ mode: "all" }),
  toolExposure: z.enum(["all", "deferred"]).default("all"),
  permanentTools: z.array(z.string().min(1)).max(100).default(["chat_history", "delegate_task", "start_job"])
})
export const SettingsSchema = z.object({
  data: DataSettingsSchema.prefault({}),
  preferences: PreferenceSettingsSchema.prefault({}),
  behavior: BehaviorSettingsSchema.prefault({}),
  output: OutputSettingsSchema.prefault({}),
  resources: ResourceSettingsSchema.prefault({}),
  permissions: PermissionPolicySchema.prefault({}),
  extensions: PluginOverridesSchema.prefault({})
})
export const SettingsPatchSchema = z
  .object({
    // Patches must not inject defaults: absence means inheritance, including in Zod 4.
    data: z
      .object({
        includeQuotes: DataSettingsSchema.shape.includeQuotes.unwrap(),
        quoteChars: DataSettingsSchema.shape.quoteChars.unwrap(),
        visionEnabled: DataSettingsSchema.shape.visionEnabled.unwrap(),
        imageMaxCount: DataSettingsSchema.shape.imageMaxCount.unwrap(),
        imageMaxSide: DataSettingsSchema.shape.imageMaxSide.unwrap(),
        imageBudgetBytes: DataSettingsSchema.shape.imageBudgetBytes.unwrap(),
        includeSpeaker: DataSettingsSchema.shape.includeSpeaker.unwrap(),
        includeTime: DataSettingsSchema.shape.includeTime.unwrap(),
        historyLimit: DataSettingsSchema.shape.historyLimit.unwrap(),
        historyChars: DataSettingsSchema.shape.historyChars.unwrap()
      })
      .partial()
      .optional(),
    preferences: z
      .object({
        personaId: PreferenceSettingsSchema.shape.personaId.unwrap(),
        providerGroup: PreferenceSettingsSchema.shape.providerGroup.unwrap(),
        replyStyle: PreferenceSettingsSchema.shape.replyStyle.unwrap()
      })
      .partial()
      .optional(),
    behavior: z
      .object({
        agentEnabled: BehaviorSettingsSchema.shape.agentEnabled.unwrap(),
        maxJobsPerRun: BehaviorSettingsSchema.shape.maxJobsPerRun.unwrap(),
        maxOutstandingJobs: BehaviorSettingsSchema.shape.maxOutstandingJobs.unwrap(),
        jobTimeoutMs: BehaviorSettingsSchema.shape.jobTimeoutMs.unwrap(),
        batchQuietMs: BehaviorSettingsSchema.shape.batchQuietMs.unwrap(),
        batchMaxHoldMs: BehaviorSettingsSchema.shape.batchMaxHoldMs.unwrap(),
        batchMaxRequests: BehaviorSettingsSchema.shape.batchMaxRequests.unwrap(),
        batchMaxChars: BehaviorSettingsSchema.shape.batchMaxChars.unwrap(),
        queueMaxAgeMs: BehaviorSettingsSchema.shape.queueMaxAgeMs.unwrap(),
        allowProactive: BehaviorSettingsSchema.shape.allowProactive.unwrap(),
        timeoutMs: BehaviorSettingsSchema.shape.timeoutMs.unwrap(),
        maxModelCalls: BehaviorSettingsSchema.shape.maxModelCalls.unwrap()
      })
      .partial()
      .optional(),
    output: z.object({ trim: OutputSettingsSchema.shape.trim.unwrap() }).partial().optional(),
    resources: z
      .object({
        tools: ResourceSettingsSchema.shape.tools.unwrap(),
        mcp: ResourceSettingsSchema.shape.mcp.unwrap(),
        skills: ResourceSettingsSchema.shape.skills.unwrap(),
        plugins: ResourceSettingsSchema.shape.plugins.unwrap(),
        toolExposure: ResourceSettingsSchema.shape.toolExposure.unwrap(),
        permanentTools: ResourceSettingsSchema.shape.permanentTools.unwrap()
      })
      .partial()
      .optional(),
    permissions: PermissionPolicySchema.optional(),
    extensions: PluginOverridesSchema.partial().optional()
  })
  .strict()
export type Settings = z.infer<typeof SettingsSchema>
export type SettingsPatch = z.infer<typeof SettingsPatchSchema>

export const PersonaSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
  name: z.string().min(1).max(80),
  prompt: z.string().max(40000)
})
export type Persona = z.infer<typeof PersonaSchema>
export const FrameworkConfigSchema = z
  .object({
    version: z.literal(1).default(1),
    defaults: SettingsSchema,
    accounts: z
      .array(
        z.object({
          channel: z.string().min(1),
          accountId: z.string().min(1),
          settings: SettingsPatchSchema
        })
      )
      .default([]),
    personas: z.array(PersonaSchema).min(1).max(100)
  })
  .superRefine((value, ctx) => {
    const ids = value.personas.map((persona) => {
      return persona.id
    })
    const accounts = value.accounts.map((account) => {
      return JSON.stringify([account.channel, account.accountId])
    })
    if (new Set(ids).size !== ids.length || new Set(accounts).size !== accounts.length) {
      ctx.addIssue({ code: "custom", message: "人格 ID 与账号设置不可重复" })
    }
  })
export type FrameworkConfig = z.infer<typeof FrameworkConfigSchema>

export const EffectiveSettingsSchema = z.object({
  settings: SettingsSchema,
  persona: PersonaSchema.extend({ revision: z.string() }),
  revision: z.string(),
  sources: z.record(z.string(), z.string())
})
export type EffectiveSettings = z.infer<typeof EffectiveSettingsSchema>
