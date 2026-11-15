import { z } from 'zod'
import { PatchPathSchema } from './hooks/path'

export const PluginIdSchema = z.string().regex(/^[a-z][a-z0-9_-]{0,31}$/u)
export const PluginLocalIdSchema = z.string().regex(/^[a-z][a-z0-9_-]{0,47}$/u)
export const PluginPathSchema = z
  .string()
  .min(1)
  .max(240)
  .refine((path) => {
    return (
      !path.startsWith('/') &&
      !path.includes('\\') &&
      !path.includes('\0') &&
      path.split('/').every((part) => {
        return part !== '' && part !== '.' && part !== '..'
      })
    )
  }, '插件文件路径必须在包内')
export const PluginJsonSchema = z
  .object({ type: z.literal('object'), properties: z.record(z.string(), z.json()).default({}) })
  .catchall(z.json())
export const PluginGrantSchema = z
  .string()
  .regex(
    /^(?:system\.status|state\.(?:read|write)|authorization\.inspect|storage\.(?:read|write)|media\.read|history\.read|artifact\.(?:read|write)|delivery\.(?:send|recall)|service:[a-z][a-z0-9_-]{0,31}|connector:[a-z][a-z0-9_-]{0,31}|operation:[a-z][a-z0-9_-]{0,31}\/[a-z][a-z0-9_-]{0,47}|point:[a-z][a-z0-9_.-]{0,160}@\d+)$/u
  )
export const PluginOperationSchema = z.object({
  id: PluginLocalIdSchema,
  title: z.string().min(1).max(100),
  description: z.string().max(4000),
  inputSchema: PluginJsonSchema,
  outputSchema: z.record(z.string(), z.json()).optional(),
  tool: z.boolean().default(true),
  execution: z.enum(['foreground', 'background']).default('foreground'),
  data: z.enum(['scope', 'none']).default('scope'),
  actions: z
    .array(z.enum(['tts_voices', 'tts_synthesize', 'comfy_catalog', 'comfy_generate', 'comfy_manage']))
    .max(5)
    .default([]),
  timeoutMs: z.number().int().min(100).max(300000).default(30000),
  serviceTimeout: PluginLocalIdSchema.optional(),
  grants: z.array(PluginGrantSchema).max(32).default([]),
  recover: PluginLocalIdSchema.optional(),
  handleSchema: z.record(z.string(), z.json()).optional(),
  pollInputSchema: PluginJsonSchema.optional(),
  cancelInputSchema: PluginJsonSchema.optional(),
  recoverInputSchema: PluginJsonSchema.optional(),
  poll: PluginLocalIdSchema.optional(),
  cancel: PluginLocalIdSchema.optional()
})
export type PluginOperation = z.infer<typeof PluginOperationSchema>
export const PluginCommandSchema = z.object({
  id: PluginLocalIdSchema,
  names: z
    .array(z.string().regex(/^[\p{L}\p{N}_-]{1,40}$/u))
    .min(1)
    .max(8),
  operation: PluginLocalIdSchema,
  description: z.string().max(300),
  arguments: z.enum(['json', 'text', 'none']).default('text'),
  textField: z
    .string()
    .regex(/^[a-zA-Z][a-zA-Z0-9_]{0,47}$/u)
    .default('text'),
  parser: PluginLocalIdSchema.optional()
})
export const HookModeSchema = z.enum(['transform', 'collect', 'select', 'policy', 'exclusive', 'observe'])
export const HookSelectorSchema = z.object({
  channels: z.array(z.string().min(1)).max(20).optional(),
  origins: z.array(z.enum(['im', 'command', 'schedule', 'job', 'tool', 'admin'])).optional(),
  phases: z
    .array(z.enum(['final', 'intermediate', 'progress', 'tool-direct', 'notification', 'control']))
    .optional()
})
export const PluginHookSchema = z.object({
  id: PluginLocalIdSchema,
  point: z.string().regex(/^[a-z][a-z0-9_.-]{0,160}@\d+$/u),
  mode: HookModeSchema,
  priority: z.number().int().min(-100000).max(100000).default(0),
  before: z
    .array(z.string().regex(/^[a-z][a-z0-9_-]{0,31}\/[a-z][a-z0-9_-]{0,47}$/u))
    .max(20)
    .default([]),
  after: z
    .array(z.string().regex(/^[a-z][a-z0-9_-]{0,31}\/[a-z][a-z0-9_-]{0,47}$/u))
    .max(20)
    .default([]),
  requires: z
    .array(z.string().regex(/^[a-z][a-z0-9_-]{0,31}\/[a-z][a-z0-9_-]{0,47}$/u))
    .max(20)
    .default([]),
  selector: HookSelectorSchema.prefault({}),
  timeoutMs: z.number().int().min(50).max(30000).default(1000),
  onError: z.enum(['skip', 'fail']).default('skip'),
  grants: z.array(PluginGrantSchema).max(32).default([]),
  writes: z.array(PatchPathSchema).max(30).optional(),
  inspectCapabilities: z
    .array(
      z.union([
        z.enum(['tts_voices', 'tts_synthesize']),
        z.string().regex(/^plugin:self\/[a-z][a-z0-9_-]{0,47}$/u)
      ])
    )
    .max(16)
    .default([])
})
export type PluginHook = z.infer<typeof PluginHookSchema>
export const PluginPointSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_.-]{0,80}@\d+$/u),
  mode: HookModeSchema,
  inputSchema: PluginJsonSchema,
  outputSchema: z.record(z.string(), z.json()),
  writable: z.array(PatchPathSchema).max(30).default([])
})
export const PluginConnectionSchema = z
  .object({
    alias: PluginIdSchema,
    title: z.string().min(1).max(100),
    kind: z.enum(['mcp', 'plugin', 'service']),
    service: z.enum(['gsvi@1', 'comfy@1']).optional(),
    required: z.boolean().default(true),
    description: z.string().max(1000).default(''),
    setting: PluginLocalIdSchema.optional()
  })
  .strict()
export const PluginManifestSchema = z
  .object({
    apiVersion: z.literal(1),
    id: PluginIdSchema,
    name: z.string().min(1).max(100),
    version: z.string().regex(/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/u),
    description: z.string().max(2000),
    author: z.string().max(100).default(''),
    repository: z
      .url()
      .refine((value) => {
        return ['http:', 'https:'].includes(new URL(value).protocol)
      })
      .optional(),
    license: z.string().max(100).optional(),
    categories: z.array(z.string().max(40)).max(8).default([]),
    platforms: z.array(z.string().max(40)).max(20).default([]),
    connections: z.array(PluginConnectionSchema).max(30).default([]),
    entry: PluginPathSchema,
    files: z.array(PluginPathSchema).min(1).max(2000),
    configSchema: PluginJsonSchema.optional(),
    configurationProjection: z.literal('gsvi@1').optional(),
    operations: z.array(PluginOperationSchema).max(100).default([]),
    commands: z.array(PluginCommandSchema).max(100).default([]),
    hooks: z.array(PluginHookSchema).max(100).default([]),
    points: z.array(PluginPointSchema).max(30).default([])
  })
  .strict()
  .superRefine((value, context) => {
    for (const operation of value.operations) {
      if (
        operation.serviceTimeout &&
        (value.configurationProjection !== 'gsvi@1' ||
          operation.execution !== 'background' ||
          !operation.actions.includes('tts_synthesize') ||
          operation.grants.some(
            (grant) =>
              !['service:' + operation.serviceTimeout, 'storage.read', 'artifact.write'].includes(grant)
          ) ||
          !operation.grants.includes('service:' + operation.serviceTimeout) ||
          !value.connections.some(
            (entry) => entry.alias === operation.serviceTimeout && entry.service === 'gsvi@1'
          ))
      ) {
        context.addIssue({ code: 'custom', message: '服务期限仅允许原生GSVI的已声明后台服务操作' })
      }
    }
    if (
      value.configurationProjection &&
      !value.connections.some(
        (entry) => entry.kind === 'service' && entry.alias === 'speech' && entry.service === 'gsvi@1'
      )
    ) {
      context.addIssue({ code: 'custom', message: 'GSVI配置投影必须声明speech:gsvi@1服务' })
    }
    for (const [name, ids] of [
      ['files', value.files],
      [
        'connections',
        value.connections.map((entry) => {
          return entry.alias
        })
      ],
      [
        'operations',
        value.operations.map((entry) => {
          return entry.id
        })
      ],
      [
        'commands',
        value.commands.map((entry) => {
          return entry.id
        })
      ],
      [
        'hooks',
        value.hooks.map((entry) => {
          return entry.id
        })
      ],
      [
        'points',
        value.points.map((entry) => {
          return entry.id
        })
      ]
    ] as const) {
      if (new Set(ids).size !== ids.length) {
        context.addIssue({ code: 'custom', message: name + ' 中的标识不可重复' })
      }
    }
    if (!value.files.includes(value.entry)) {
      context.addIssue({ code: 'custom', message: '入口文件必须包含在 files 中' })
    }
    if (
      value.files.some((file) => {
        return file === 'package-index.json' || file.startsWith('package-index.json/')
      })
    ) {
      context.addIssue({ code: 'custom', message: 'package-index.json 是框架保留路径' })
    }
    for (const connection of value.connections) {
      if (connection.kind === 'service' && !['gsvi@1', 'comfy@1'].includes(connection.service ?? '')) {
        context.addIssue({ code: 'custom', message: '具名服务必须声明已支持的服务契约' })
      }
      if (
        (connection.service && connection.kind !== 'service') ||
        (connection.kind === 'service' && connection.setting)
      ) {
        context.addIssue({ code: 'custom', message: '具名服务使用独立实例绑定，不使用业务 setting' })
      }
    }
    for (const operation of value.operations) {
      if (
        operation.data === 'none' &&
        operation.grants.some((grant) => {
          return grant.startsWith('storage.') || grant === 'artifact.publish'
        })
      ) {
        context.addIssue({ code: 'custom', message: '无数据操作不能声明私有存储能力' })
      }
    }
    for (const command of value.commands) {
      if (
        !value.operations.some((operation) => {
          return operation.id === command.operation
        })
      ) {
        context.addIssue({ code: 'custom', message: '指令引用了不存在的操作：' + command.id })
      }
    }
    for (const hook of value.hooks) {
      if (hook.inspectCapabilities.length > 0 && hook.point !== 'delivery.presentation@1') {
        context.addIssue({ code: 'custom', message: '能力诊断仅用于 delivery.presentation@1 的短时选择' })
      }
    }
  })
export type PluginManifest = z.infer<typeof PluginManifestSchema>
