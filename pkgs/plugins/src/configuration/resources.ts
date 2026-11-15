import type { Configuration } from '@pi-im-bot/config/load'
import type { ConfigDefinition, ConfigValues } from './schema'
import { ConfigValuesSchema } from './schema'
import { z } from 'zod'

export function configResourceChoices(config: Configuration) {
  return {
    select_mcp: config.resources.config.mcp.map((server) => {
      return { id: server.id, name: server.name, enabled: server.enabled }
    }),
    select_provider: config.catalog.config.providers.flatMap((provider) => {
      return provider.models.map((model) => {
        return {
          id: provider.id + '/' + model.id,
          name: provider.name + ' / ' + model.name,
          enabled: provider.enabled && model.enabled
        }
      })
    }),
    select_model_group: config.catalog.config.groups.map((group) => {
      return { id: group.id, name: group.name ?? group.id, enabled: true }
    }),
    select_persona: config.framework.personas.map((persona) => {
      return { id: persona.id, name: persona.name, enabled: true }
    })
  }
}
export function validateConfigResources(
  definition: ConfigDefinition,
  values: ConfigValues,
  config: Configuration
) {
  const choices = configResourceChoices(config)
  function visit(fields: ConfigDefinition, input: ConfigValues) {
    for (const [key, field] of Object.entries(fields)) {
      if (!Object.hasOwn(input, key)) {
        continue
      }
      const value = input[key]
      if (field._special && value !== '') {
        const candidates = choices[field._special]
        const ids = [value].flat()
        if (
          ids.some((id) => {
            return !candidates.some((choice) => {
              return choice.id === id
            })
          })
        ) {
          throw new Error('配置引用的资源不存在：' + key)
        }
      }
      if (field.type === 'object') {
        visit(field.items ?? {}, ConfigValuesSchema.parse(value))
      }
      if (field.type === 'template_list') {
        for (const entry of z.array(ConfigValuesSchema).parse(value)) {
          visit(field.templates![z.string().parse(entry.__template_key)].items, entry)
        }
      }
    }
  }
  visit(definition, values)
}
