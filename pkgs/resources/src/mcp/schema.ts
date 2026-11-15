import { z } from 'zod'
import { McpTaskCapabilitiesSchema, McpTaskPolicySchema } from './task-schema'

export const McpServerSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9_]{0,23}$/),
    name: z.string().min(1).max(100),
    enabled: z.boolean().default(false),
    transport: z.literal('http').default('http'),
    url: z.url().refine((value) => {
      const url = new URL(value)
      return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
    }, '仅支持不含用户名密码的 HTTP(S) 地址'),
    headers: z.record(z.string().min(1), z.string()).default({}),
    headerEnv: z.record(z.string().min(1), z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/)).default({}),
    timeoutMs: z.number().int().min(1000).max(300000).default(60000),
    tasks: McpTaskPolicySchema.prefault({})
  })
  .strict()
export type McpServer = z.infer<typeof McpServerSchema>

const McpParametersSchema = z
  .object({
    type: z.literal('object').default('object'),
    properties: z.record(z.string(), z.unknown()).default({})
  })
  .passthrough()

export const McpToolSchema = z.object({
  name: z.string().min(1).max(256),
  title: z.string().max(1000).optional(),
  description: z.string().max(40000).optional(),
  inputSchema: McpParametersSchema,
  outputSchema: z.record(z.string(), z.unknown()).optional(),
  annotations: z.object({ readOnlyHint: z.boolean().optional() }).passthrough().optional(),
  execution: z.object({ taskSupport: z.enum(['forbidden', 'optional', 'required']).optional() }).optional()
})
export type McpTool = z.infer<typeof McpToolSchema>
export const McpManifestSchema = z.object({
  serverId: z.string(),
  configRevision: z.string(),
  fetchedAt: z.number(),
  instructions: z.string().max(100000).default(''),
  tools: z.array(McpToolSchema).max(500),
  protocolVersion: z.string().optional(),
  taskCapabilities: McpTaskCapabilitiesSchema.optional()
})
export type McpManifest = z.infer<typeof McpManifestSchema>
export const McpCatalogFileSchema = z.object({ manifests: z.array(McpManifestSchema).default([]) })
