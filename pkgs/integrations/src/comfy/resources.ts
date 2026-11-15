import { z } from 'zod'
function revision(value: unknown) {
  return new Bun.CryptoHasher('sha256').update(JSON.stringify(value)).digest('hex')
}
import { ServiceIdSchema, ServiceUrlSchema, GsviServiceSchema } from '../gsvi/schema'

const NameSchema = z.string().regex(/^[a-z][a-z0-9_-]{0,47}$/u)
const SegmentSchema = z
  .union([z.string().regex(/^[\p{L}\p{N}_. -]{1,100}$/u), z.number().int().min(0).max(1024)])
  .refine((value) => {
    return !['__proto__', 'constructor', 'prototype'].includes(String(value))
  })
export const GraphSchema = z.record(
  z.string().regex(/^[a-zA-Z0-9_.-]{1,80}$/u),
  z
    .object({
      class_type: z.string().min(1).max(200),
      inputs: z.record(z.string(), z.json()),
      _meta: z.object({ title: z.string().max(300) }).optional()
    })
    .strict()
)
export const ParameterSchema = z
  .object({
    paths: z.array(z.array(SegmentSchema).min(3).max(12)).min(1).max(64),
    type: z.enum(['string', 'number', 'boolean']),
    encoding: z.enum(['identity', 'number-string']).default('identity'),
    integer: z.boolean().default(false),
    offsets: z.array(z.number().finite()).max(64).default([]),
    min: z.number().optional(),
    max: z.number().optional(),
    maxLength: z.number().int().min(1).max(16000).default(4000),
    default: z.union([z.string().max(16000), z.number(), z.boolean()]).optional()
  })
  .strict()
export const LoraSchema = z
  .object({
    id: NameSchema,
    name: z.string().min(1).max(200),
    filename: z.string().min(1).max(300),
    aliases: z.array(z.string().max(300)).max(16).default([]),
    description: z.string().max(4000).default(''),
    clipStrength: z.number().min(-4).max(4).optional(),
    enabled: z.boolean().default(true),
    triggers: z.array(z.string().max(1000)).max(20).default([]),
    promptHints: z.array(z.string().max(1000)).max(20).default([]),
    strength: z.number().min(-4).max(4).default(1)
  })
  .strict()
export const LoraSlotSchema = z
  .object({
    name: NameSchema,
    strength: NameSchema,
    clipStrength: NameSchema.optional(),
    enabled: NameSchema.optional()
  })
  .strict()
export const WorkflowSchema = z
  .object({
    id: ServiceIdSchema,
    name: z.string().min(1).max(100),
    description: z.string().max(4000).default(''),
    graph: GraphSchema,
    parameters: z.record(NameSchema, ParameterSchema),
    bindings: z
      .object({
        positive: NameSchema,
        negative: NameSchema.optional(),
        seed: NameSchema.optional(),
        steps: NameSchema.optional(),
        stepNodes: z
          .record(z.string().regex(/^[a-zA-Z0-9_.-]{1,80}$/u), NameSchema)
          .refine((nodes) => {
            return Object.keys(nodes).length <= 64
          }, '步骤节点超过64项')
          .default({}),
        loras: z.array(LoraSlotSchema).max(16).default([])
      })
      .strict(),
    outputs: z.array(z.string().min(1).max(80)).min(1).max(16),
    models: z
      .array(z.object({ role: z.string().max(100), filename: z.string().max(300) }).strict())
      .max(100)
      .default([]),
    loras: z.array(LoraSchema).max(256).default([])
  })
  .strict()
  .superRefine((workflow, context) => {
    for (const issue of resourceRisks(workflow)) {
      context.addIssue({ code: 'custom', message: issue })
    }
    if (
      Object.keys(workflow.graph).length > 512 ||
      new TextEncoder().encode(JSON.stringify(workflow)).length > 512 * 1024
    ) {
      context.addIssue({ code: 'custom', message: '模板超过512节点/512KiB额度' })
    }
    const names = [
      workflow.bindings.positive,
      workflow.bindings.negative,
      workflow.bindings.seed,
      workflow.bindings.steps,
      ...Object.values(workflow.bindings.stepNodes),
      ...workflow.bindings.loras.flatMap((slot) => {
        return [slot.name, slot.strength, slot.clipStrength, slot.enabled]
      })
    ].filter((value) => {
      return value !== undefined
    })
    for (const name of names) {
      if (!workflow.parameters[name]) {
        context.addIssue({ code: 'custom', message: '未登记参数绑定：' + name })
      }
    }
    const typed = [
      [workflow.bindings.positive, 'string'],
      [workflow.bindings.negative, 'string'],
      [workflow.bindings.seed, 'number'],
      [workflow.bindings.steps, 'number'],
      ...Object.values(workflow.bindings.stepNodes).map((name) => {
        return [name, 'number']
      }),
      ...workflow.bindings.loras.flatMap((slot) => {
        return [
          [slot.name, 'string'],
          [slot.strength, 'number'],
          [slot.clipStrength, 'number'],
          [slot.enabled, 'boolean']
        ]
      })
    ]
    for (const [name, type] of typed) {
      if (name && workflow.parameters[name]?.type !== type) {
        context.addIssue({ code: 'custom', message: '业务绑定参数类型错误：' + name })
      }
    }
    if (
      new Set(workflow.outputs).size !== workflow.outputs.length ||
      new Set(
        workflow.loras.map((lora) => {
          return lora.id
        })
      ).size !== workflow.loras.length ||
      new Set(
        workflow.loras.map((lora) => {
          return lora.filename
        })
      ).size !== workflow.loras.length
    ) {
      context.addIssue({ code: 'custom', message: '输出或LoRA声明重复' })
    }
    for (const id of workflow.outputs) {
      if (workflow.graph[id]?.class_type === 'SaveImageWebsocket') {
        context.addIssue({
          code: 'custom',
          message: '只支持history/view图像输出，SaveImageWebsocket输出需要重配为受管文件输出'
        })
      }
    }
    for (const id of workflow.outputs) {
      if (!workflow.graph[id]) {
        context.addIssue({ code: 'custom', message: '输出节点不存在' })
      }
    }
    for (const parameter of Object.values(workflow.parameters)) {
      if (
        (parameter.min !== undefined && parameter.max !== undefined && parameter.min > parameter.max) ||
        (parameter.offsets.length && parameter.offsets.length !== parameter.paths.length) ||
        (parameter.type !== 'number' &&
          (parameter.encoding !== 'identity' ||
            parameter.integer ||
            parameter.offsets.length > 0 ||
            parameter.min !== undefined ||
            parameter.max !== undefined))
      ) {
        context.addIssue({ code: 'custom', message: '参数范围或变换声明不合法' })
      }
      if (
        parameter.default !== undefined &&
        (typeof parameter.default !== parameter.type ||
          (typeof parameter.default === 'number' &&
            (!Number.isFinite(parameter.default) ||
              (parameter.integer && !Number.isSafeInteger(parameter.default)) ||
              (parameter.min !== undefined && parameter.default < parameter.min) ||
              (parameter.max !== undefined && parameter.default > parameter.max))) ||
          (typeof parameter.default === 'string' && parameter.default.length > parameter.maxLength))
      ) {
        context.addIssue({ code: 'custom', message: '参数默认值不符合登记类型/范围' })
      }
      for (const path of parameter.paths) {
        const target = readPath(workflow.graph, path)
        let expected = parameter.type
        if (parameter.encoding === 'number-string') {
          expected = 'string'
        }
        if (path[1] !== 'inputs' || !target.found || typeof target.value !== expected) {
          context.addIssue({ code: 'custom', message: '参数路径必须指向登记节点inputs内类型匹配的标量' })
        }
      }
    }
  })
export type Workflow = z.infer<typeof WorkflowSchema>
export const ComfyServiceSchema = z
  .object({
    id: ServiceIdSchema,
    name: z.string().min(1).max(100),
    kind: z.literal('comfy'),
    enabled: z.boolean().default(false),
    url: ServiceUrlSchema,
    headers: GsviServiceSchema.shape.headers,
    timeoutMs: z.number().int().min(1000).max(30000).default(10000),
    maxHistoryBytes: z
      .number()
      .int()
      .min(1024)
      .max(4 * 1024 * 1024)
      .default(1024 * 1024),
    maxImageBytes: z
      .number()
      .int()
      .min(64)
      .max(32 * 1024 * 1024)
      .default(8 * 1024 * 1024),
    workflows: z.array(ServiceIdSchema).max(64).default([])
  })
  .strict()
export type ComfyService = z.infer<typeof ComfyServiceSchema>
export function comfyRevision(service: ComfyService) {
  const { name: _name, ...execution } = service
  return revision(execution)
}
export function workflowDigest(workflow: Workflow) {
  return revision(workflow)
}
export function readPath(root: unknown, path: readonly (string | number)[]) {
  let value: unknown = root
  for (const key of path) {
    if (value === null || typeof value !== 'object' || !Object.hasOwn(value, key)) {
      return { found: false, value: undefined }
    }
    value = Reflect.get(value, String(key))
  }
  return { found: true, value }
}
export function resourceRisks(value: unknown, path = 'resource'): string[] {
  const issues: string[] = []
  function visit(item: unknown, location: string) {
    if (
      typeof item === 'string' &&
      /(?:\b(?:Bearer|Basic)\s+[a-zA-Z0-9_+/.=-]{8,}|\bsk-[a-zA-Z0-9_-]{16,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|(?:api[_-]?key|access[_-]?token|secret)\s*=\s*\S{8,})/iu.test(
        item
      )
    ) {
      issues.push('疑似秘密内容：' + location)
    }
    if (
      typeof item === 'string' &&
      /(?:(?:https?|wss?|ftp|file):\/\/|^\/|(?:^|\s)\/(?:home|mnt|root|etc|data|opt|workspace|srv|tmp|media)\/|^[a-zA-Z]:[\\/]|(?:^|[\\/])\.\.(?:[\\/]|$))/u.test(
        item
      )
    ) {
      issues.push('禁止URL/宿主路径/路径越界：' + location)
    }
    if (Array.isArray(item)) {
      item.forEach((child, index) => {
        visit(child, location + '.' + index)
      })
    } else if (item && typeof item === 'object') {
      for (const [key, child] of Object.entries(item)) {
        if (
          /^(?:api[_-]?key|authorization|password|secret|(?:access[_-]?)?token|cookie|signature)$/iu.test(
            key
          ) ||
          ['__proto__', 'prototype', 'constructor'].includes(key)
        ) {
          issues.push('禁止秘密或原型字段：' + location + '.' + key)
        }
        visit(child, location + '.' + key)
      }
    }
  }
  visit(value, path)
  return issues.slice(0, 30)
}
