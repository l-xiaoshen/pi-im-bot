import { z } from 'zod'
import { ConfigValuesSchema, type ConfigDefinition, type ConfigValues } from './schema'

export const SecretChangeSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('set'),
      path: z.string().min(1).max(2000),
      value: z.union([z.string().max(100000), z.array(z.string().max(32000)).max(1000)])
    })
    .strict(),
  z.object({ action: z.literal('clear'), path: z.string().min(1).max(2000) }).strict()
])
export const SecretStateSchema = z.object({ path: z.string(), configured: z.boolean(), list: z.boolean() })
export type SecretChange = z.infer<typeof SecretChangeSchema>
function segment(key: string) {
  return key.replaceAll('~', '~0').replaceAll('/', '~1')
}
export function publicConfig(definition: ConfigDefinition, input: ConfigValues) {
  const secrets: z.infer<typeof SecretStateSchema>[] = []
  function visit(fields: ConfigDefinition, values: ConfigValues, path: string): ConfigValues {
    const output: ConfigValues = {}
    for (const [key, field] of Object.entries(fields)) {
      if (!Object.hasOwn(values, key)) {
        continue
      }
      const value = values[key]
      const pointer = path + '/' + segment(key)
      if (field.secret) {
        secrets.push({
          path: pointer,
          configured: Boolean(value && (!Array.isArray(value) || value.length)),
          list: field.type === 'list'
        })
      } else if (field.type === 'object') {
        output[key] = visit(field.items ?? {}, ConfigValuesSchema.parse(value), pointer)
      } else if (field.type === 'template_list') {
        output[key] = z
          .array(ConfigValuesSchema)
          .parse(value)
          .map((entry) => {
            const templateKey = z.string().parse(entry.__template_key)
            const id = z.uuid().parse(entry.__entry_id)
            return {
              ...visit(field.templates![templateKey].items, entry, pointer + '/@' + id),
              __template_key: templateKey,
              __entry_id: id
            }
          })
      } else {
        output[key] = structuredClone(value)
      }
    }
    return output
  }
  return { values: visit(definition, input, ''), secrets }
}
export function applyConfigSecrets(
  definition: ConfigDefinition,
  input: ConfigValues,
  previous: ConfigValues,
  changes: SecretChange[]
) {
  const pending = new Map(
    changes.map((change) => {
      return [change.path, change]
    })
  )
  if (pending.size !== changes.length) {
    throw new Error('同一秘密字段不能重复修改')
  }
  function visit(
    fields: ConfigDefinition,
    values: ConfigValues,
    old: ConfigValues,
    path: string
  ): ConfigValues {
    const output = structuredClone(values)
    for (const [key, field] of Object.entries(fields)) {
      const pointer = path + '/' + segment(key)
      if (field.secret) {
        if (Object.hasOwn(values, key)) {
          throw new Error('秘密字段必须通过替换/清除动作修改')
        }
        const change = pending.get(pointer)
        pending.delete(pointer)
        if (change?.action === 'set') {
          output[key] = change.value
        } else if (change?.action === 'clear') {
          output[key] = ''
          if (field.type === 'list') {
            output[key] = []
          }
        } else if (Object.hasOwn(old, key)) {
          output[key] = structuredClone(old[key])
        }
      } else if (field.type === 'object' && Object.hasOwn(values, key)) {
        output[key] = visit(
          field.items ?? {},
          ConfigValuesSchema.parse(values[key]),
          ConfigValuesSchema.parse(old[key] ?? {}),
          pointer
        )
      } else if (field.type === 'template_list' && Object.hasOwn(values, key)) {
        const previousEntries = z.array(ConfigValuesSchema).parse(old[key] ?? [])
        output[key] = z
          .array(ConfigValuesSchema)
          .max(100)
          .parse(values[key])
          .map((entry) => {
            const id = z.uuid().parse(entry.__entry_id)
            const template = z.string().parse(entry.__template_key)
            const before =
              previousEntries.find((item) => {
                return item.__entry_id === id && item.__template_key === template
              }) ?? {}
            const spec = field.templates?.[template]
            if (!spec) {
              throw new Error('配置模板不存在')
            }
            return visit(spec.items, entry, before, pointer + '/@' + id)
          })
      }
    }
    return output
  }
  const result = visit(definition, input, previous, '')
  if (pending.size) {
    throw new Error('秘密字段路径无效、已删除或不是秘密字段')
  }
  return result
}
