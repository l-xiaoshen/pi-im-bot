import { z } from 'zod'

const EndpointSchema = z.url().refine((value) => {
  const url = new URL(value)
  return (
    ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash
  )
}, 'Use an HTTP(S) API base URL without credentials, query or fragment')

export const ShipyardConfigSchema = z.object({
  backend: z.literal('shipyard'),
  endpoint: EndpointSchema,
  apiKey: z.string().min(1).optional(),
  apiKeyEnv: z.string().min(1).optional(),
  profile: z.string().min(1).default('python-default'),
  timeoutMs: z.number().int().min(1000).max(120000).default(30000),
  commandTimeoutSeconds: z.number().int().min(1).max(300).default(120),
  maxFileBytes: z
    .number()
    .int()
    .min(1024)
    .max(20 * 1024 * 1024)
    .default(5 * 1024 * 1024)
})
export type ShipyardConfig = z.infer<typeof ShipyardConfigSchema>

export const ExecutionConfigSchema = z
  .discriminatedUnion('backend', [z.object({ backend: z.literal('disabled') }), ShipyardConfigSchema])
  .prefault({ backend: 'disabled' })
export type ExecutionConfig = z.infer<typeof ExecutionConfigSchema>

export const ExecutionStatusSchema = z.object({
  backend: z.enum(['disabled', 'shipyard']),
  status: z.enum(['disabled', 'configured']),
  workspace: z.string().nullable(),
  tools: z.array(z.string()),
  message: z.string()
})

export function executionStatus(config: ExecutionConfig): z.infer<typeof ExecutionStatusSchema> {
  if (config.backend === 'disabled') {
    return {
      backend: 'disabled',
      status: 'disabled',
      workspace: null,
      tools: [],
      message: '文件执行未配置；文件与 Shell 工具关闭，宿主执行不可用。'
    }
  }
  return {
    backend: 'shipyard',
    status: 'configured',
    workspace: '/workspace',
    tools: ['read', 'write', 'edit', 'ls', 'bash'],
    message:
      '文件与 Shell 均在 Shipyard 容器内执行，默认 /workspace 持久化；容器内不额外限路径，宿主执行关闭。'
  }
}
