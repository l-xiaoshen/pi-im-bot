import { z } from 'zod'

export const ConfigValuesSchema = z.record(z.string(), z.json())
export type ConfigValues = z.infer<typeof ConfigValuesSchema>
export const ConfigLevelSchema = z.enum(['instance', 'account', 'room', 'conversation'])
export type ConfigLevel = z.infer<typeof ConfigLevelSchema>
const KeySchema = z
  .string()
  .min(1)
  .max(100)
  .refine((key) => {
    return !['__proto__', 'prototype', 'constructor', '__entry_id', '__template_key'].includes(key)
  }, '配置字段使用了保留名称')
const CommonFieldSchema = z.object({
  type: z.enum(['string', 'text', 'int', 'float', 'bool', 'object', 'list', 'dict', 'template_list']),
  description: z.string().max(300).default(''),
  hint: z.string().max(3000).optional(),
  default: z.json().optional(),
  required: z.boolean().default(false),
  secret: z.boolean().default(false),
  invisible: z.boolean().default(false),
  readonly: z.boolean().default(false),
  obvious_hint: z.boolean().default(false),
  options: z
    .array(z.union([z.string().max(4000), z.number()]))
    .max(1000)
    .optional(),
  labels: z.array(z.string().max(1000)).max(1000).optional(),
  slider: z.object({ min: z.number(), max: z.number(), step: z.number().positive() }).strict().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  condition: z.record(KeySchema, z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
  scope: z.array(ConfigLevelSchema).min(1).max(4).default(['instance']),
  _special: z.enum(['select_mcp', 'select_provider', 'select_model_group', 'select_persona']).optional(),
  editor_mode: z.boolean().default(false),
  editor_language: z.enum(['json', 'text', 'markdown']).default('text')
})
interface ConfigTemplate {
  name: string
  hint?: string
  display_item?: string
  hide_hint_in_list?: boolean
  items: Record<string, ConfigField>
}
export interface ConfigField extends z.infer<typeof CommonFieldSchema> {
  items?: Record<string, ConfigField>
  templates?: Record<string, ConfigTemplate>
  template_schema?: Record<string, ConfigField>
}
export const ConfigFieldSchema: z.ZodType<ConfigField> = z.lazy(() => {
  return CommonFieldSchema.extend({
    items: z.record(KeySchema, ConfigFieldSchema).optional(),
    template_schema: z.record(KeySchema, ConfigFieldSchema).optional(),
    templates: z
      .record(
        KeySchema,
        z
          .object({
            name: z.string().min(1).max(100),
            hint: z.string().max(3000).optional(),
            display_item: z.string().max(200).optional(),
            hide_hint_in_list: z.boolean().optional(),
            items: z.record(KeySchema, ConfigFieldSchema)
          })
          .strict()
      )
      .refine((items) => {
        return Object.keys(items).length <= 40
      }, '模板超过 40 种')
      .optional()
  })
    .strict()
    .superRefine((field, context) => {
      if (field.secret && !['string', 'text', 'list'].includes(field.type)) {
        context.addIssue({ code: 'custom', message: 'secret 仅用于文本或字符串列表' })
      }
      if (field.secret && (field.scope.length !== 1 || field.scope[0] !== 'instance')) {
        context.addIssue({ code: 'custom', message: '秘密字段仅允许实例层配置' })
      }
      if (field.type === 'object' && !field.items) {
        context.addIssue({ code: 'custom', message: 'object 必须声明 items' })
      }
      if (field.type === 'template_list' && !Object.keys(field.templates ?? {}).length) {
        context.addIssue({ code: 'custom', message: 'template_list 必须声明模板' })
      }
      if (field.slider && (field.slider.min > field.slider.max || !['int', 'float'].includes(field.type))) {
        context.addIssue({ code: 'custom', message: 'slider 需要有效数值范围' })
      }
      if (field.labels && field.labels.length !== field.options?.length) {
        context.addIssue({ code: 'custom', message: 'labels 与 options 长度不一致' })
      }
      if (field.options && !['string', 'text', 'int', 'float', 'list'].includes(field.type)) {
        context.addIssue({ code: 'custom', message: '此字段类型不支持 options' })
      }
      if (
        field.type === 'dict' &&
        Object.values(field.template_schema ?? field.items ?? {}).some((entry) => {
          return entry.secret
        })
      ) {
        context.addIssue({
          code: 'custom',
          message: '秘密值应使用独立的 secret 字段，不能放在自由字典模板中'
        })
      }
    })
})
export const ConfigDefinitionSchema = z.record(KeySchema, ConfigFieldSchema)
export type ConfigDefinition = z.infer<typeof ConfigDefinitionSchema>

/** Bound recursion before Zod's recursive schema sees package-controlled data. */
export function parseConfigDefinition(input: unknown) {
  let nodes = 0
  function bound(value: unknown, depth: number) {
    nodes += 1
    if (depth > 24 || nodes > 24000) {
      throw new Error('插件配置 schema 过深或过大')
    }
    if (value && typeof value === 'object') {
      for (const child of Object.values(value)) {
        bound(child, depth + 1)
      }
    }
  }
  if (Buffer.byteLength(JSON.stringify(input)) > 256 * 1024) {
    throw new Error('插件配置 schema 超过 256 KiB')
  }
  bound(input, 0)
  return ConfigDefinitionSchema.parse(input)
}
