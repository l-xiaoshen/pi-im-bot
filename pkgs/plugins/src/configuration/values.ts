import { z } from "zod"
import { configurationId } from "@pi-im-bot/config/identity"
import {
  ConfigValuesSchema,
  type ConfigDefinition,
  type ConfigField,
  type ConfigValues,
  type ConfigLevel
} from "./schema"

const EntryIdSchema = z.uuid()
const validators = new WeakMap<ConfigDefinition, z.ZodObject<Record<string, z.ZodType>>>()
export class PluginConfigValidationError extends Error {
  constructor(readonly issues: Array<{ path: string; message: string }>) {
    super(
      issues
        .map((issue) => {
          return issue.path + "：" + issue.message
        })
        .join("；")
    )
  }
}
function typeDefault(field: ConfigField): z.infer<typeof ConfigValuesSchema>[string] {
  if (field.default !== undefined) {
    return structuredClone(field.default)
  }
  if (field.type === "bool") {
    return false
  }
  if (field.type === "int" || field.type === "float") {
    return 0
  }
  if (field.type === "list" || field.type === "template_list") {
    return []
  }
  if (field.type === "object" || field.type === "dict") {
    return {}
  }
  return ""
}
export function fillConfigDefaults(definition: ConfigDefinition, input: ConfigValues): ConfigValues {
  const output = structuredClone(input)
  for (const [key, field] of Object.entries(definition)) {
    if (!Object.hasOwn(output, key)) {
      output[key] = typeDefault(field)
    }
    if (field.type === "object") {
      output[key] = fillConfigDefaults(field.items ?? {}, ConfigValuesSchema.parse(output[key]))
    }
    if (field.type === "template_list") {
      output[key] = z
        .array(ConfigValuesSchema)
        .max(100)
        .parse(output[key])
        .map((entry) => {
          const template = field.templates?.[z.string().parse(entry.__template_key)]
          if (!template) {
            throw new Error("配置模板不存在：" + key)
          }
          return {
            ...fillConfigDefaults(template.items, entry),
            __entry_id: EntryIdSchema.parse(entry.__entry_id ?? configurationId())
          }
        })
    }
  }
  return output
}
export function mergeConfig(base: ConfigValues, patch: ConfigValues, definition?: ConfigDefinition): ConfigValues {
  const result = structuredClone(base)
  for (const [key, value] of Object.entries(patch)) {
    const field = definition?.[key]
    if (field?.type === "object") {
      result[key] = mergeConfig(
        ConfigValuesSchema.parse(result[key] ?? {}),
        ConfigValuesSchema.parse(value),
        field.items
      )
    } else {
      result[key] = structuredClone(value)
    }
  }
  return result
}

function fieldValidator(field: ConfigField): z.ZodType {
  let validator: z.ZodType
  if (field.type === "object") {
    validator = configValidator(field.items ?? {})
  } else if (field.type === "template_list") {
    const variants = Object.entries(field.templates ?? {}).map(([key, template]) => {
      return configValidator(template.items).extend({ __template_key: z.literal(key), __entry_id: z.uuid() })
    })
    validator = z
      .array(z.union(variants))
      .max(100)
      .superRefine((entries, context) => {
        const ids = entries.map((entry) => {
          return entry.__entry_id
        })
        if (new Set(ids).size !== ids.length) {
          context.addIssue({ code: "custom", message: "模板条目标识重复" })
        }
      })
  } else if (field.type === "bool") {
    validator = z.boolean()
  } else if (field.type === "int" || field.type === "float") {
    let number = z.number().finite()
    if (field.type === "int") {
      number = number.int()
    }
    if (field.min !== undefined) {
      number = number.min(field.min)
    }
    if (field.max !== undefined) {
      number = number.max(field.max)
    }
    if (field.slider) {
      number = number.min(field.slider.min).max(field.slider.max)
      const slider = field.slider
      validator = number.refine((value) => {
        const steps = (value - slider.min) / slider.step
        return Math.abs(steps - Math.round(steps)) < 1e-7
      }, "数值不符合 step")
    } else {
      validator = number
    }
  } else if (field.type === "list") {
    let list = z.array(z.string().max(32000)).max(1000)
    if (field.required) {
      list = list.min(1, "至少填写一项")
    }
    validator = list
  } else if (field.type === "dict") {
    const known = field.template_schema ?? field.items
    validator = z
      .record(z.string().max(100), z.union([z.string().max(32000), z.number().finite(), z.boolean(), z.null()]))
      .superRefine((value, context) => {
        if (Object.keys(value).length > 100) {
          context.addIssue({ code: "custom", message: "字典超过 100 项" })
        }
        for (const [key, item] of Object.entries(value)) {
          if (["__proto__", "constructor", "prototype"].includes(key)) {
            context.addIssue({ code: "custom", path: [key], message: "保留字段不可写" })
          }
          if (known?.[key] && !fieldValidator(known[key]).safeParse(item).success) {
            context.addIssue({ code: "custom", path: [key], message: "字典值类型或范围错误" })
          }
        }
      })
  } else {
    let text = z.string().max(100000)
    if (field.required) {
      text = text.min(1, "此项必填")
    }
    validator = text
  }
  if (field.options) {
    const options = field.options
    validator = validator.refine((value) => {
      if (field.type === "list") {
        return z
          .array(z.string())
          .parse(value)
          .every((entry) => {
            return options.includes(entry)
          })
      }
      return options.some((entry) => {
        return entry === value
      })
    }, "请选择声明的可用选项")
  }
  return validator
}
function configValidator(definition: ConfigDefinition) {
  const cached = validators.get(definition)
  if (cached) {
    return cached
  }
  const schema = z
    .object(
      Object.fromEntries(
        Object.entries(definition).map(([key, field]) => {
          return [key, fieldValidator(field)]
        })
      )
    )
    .strict()
  validators.set(definition, schema)
  return schema
}
export function configIssues(definition: ConfigDefinition, values: ConfigValues) {
  const result = configValidator(definition).safeParse(values)
  if (result.success) {
    return []
  }
  return result.error.issues.map((issue) => {
    return { path: issue.path.map(String).join("."), message: issue.message }
  })
}
export function validateConfig(definition: ConfigDefinition, values: ConfigValues) {
  const issues = configIssues(definition, values)
  if (issues.length) {
    throw new PluginConfigValidationError(issues)
  }
  return values
}
export function validateConfigOverride(definition: ConfigDefinition, patch: ConfigValues, level: ConfigLevel) {
  for (const [key, value] of Object.entries(patch)) {
    const field = definition[key]
    if (!field) {
      throw new Error("未知插件配置字段：" + key)
    }
    if (field.readonly) {
      throw new Error("只读插件字段不可覆盖：" + key)
    }
    if (field.type === "object") {
      validateConfigOverride(field.items ?? {}, ConfigValuesSchema.parse(value), level)
    } else if (!field.scope.includes(level) || containsConfigSecrets({ [key]: field }) || field.readonly) {
      throw new Error("此层不能覆盖插件字段：" + key)
    } else if (!fieldValidator(field).safeParse(value).success) {
      throw new Error("插件字段类型或范围错误：" + key)
    }
  }
}
export function pruneConfigOverride(definition: ConfigDefinition, input: ConfigValues): ConfigValues {
  const output = structuredClone(input)
  for (const [key, field] of Object.entries(definition)) {
    if (field.type === "object" && Object.hasOwn(output, key)) {
      const value = pruneConfigOverride(field.items ?? {}, ConfigValuesSchema.parse(output[key]))
      if (Object.keys(value).length) {
        output[key] = value
      } else {
        delete output[key]
      }
    }
  }
  return output
}

export function containsConfigSecrets(definition: ConfigDefinition): boolean {
  return Object.values(definition).some((field) => {
    return (
      field.secret ||
      containsConfigSecrets(field.items ?? {}) ||
      containsConfigSecrets(field.template_schema ?? {}) ||
      Object.values(field.templates ?? {}).some((template) => {
        return containsConfigSecrets(template.items)
      })
    )
  })
}
export function validateConfigReadonly(definition: ConfigDefinition, previous: ConfigValues, next: ConfigValues) {
  for (const [key, field] of Object.entries(definition)) {
    if (field.readonly && Object.hasOwn(previous, key) && JSON.stringify(previous[key]) !== JSON.stringify(next[key])) {
      throw new Error("只读字段不能修改：" + key)
    }
    if (field.type === "object") {
      validateConfigReadonly(
        field.items ?? {},
        ConfigValuesSchema.parse(previous[key] ?? {}),
        ConfigValuesSchema.parse(next[key] ?? {})
      )
    }
    if (field.type === "template_list") {
      const before = z.array(ConfigValuesSchema).parse(previous[key] ?? [])
      for (const entry of z.array(ConfigValuesSchema).parse(next[key] ?? [])) {
        const old = before.find((item) => {
          return item.__entry_id === entry.__entry_id && item.__template_key === entry.__template_key
        })
        const template = field.templates?.[z.string().parse(entry.__template_key)]
        if (old && template) {
          validateConfigReadonly(template.items, old, entry)
        }
      }
    }
  }
}
