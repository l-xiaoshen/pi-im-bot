import { z } from 'zod'
import { node, button, pill } from './dom'
import {
  ConfigValuesSchema as SettingsSchema,
  type ConfigField,
  type ConfigValues as Settings
} from '@pi-im-bot/plugins/configuration/schema'
import { fillConfigDefaults, containsConfigSecrets } from '@pi-im-bot/plugins/configuration/values'
import { publicConfig, type SecretChange } from '@pi-im-bot/plugins/configuration/secrets'
import type { PluginConfigView } from '@pi-im-bot/plugins/configuration/contracts'
import { secretField } from './secret-field'
import { listField, dictField } from './collections'
import { configurationId } from '@pi-im-bot/config/identity'
function defaults(fields: Record<string, ConfigField>) {
  return publicConfig(fields, fillConfigDefaults(fields, {})).values
}

interface FormOptions {
  scope: ConfigField['scope'][number]
  base: Settings
  overrides: Settings
  changed(): void
  prefix?: string
  path?: string
  choices: PluginConfigView['choices']
  secrets: PluginConfigView['secrets']
  secretChanges: Map<string, SecretChange>
}

export function configForm(fields: Record<string, ConfigField>, options: FormOptions) {
  const root = node('div', 'schema-form')
  const top = options.scope === 'instance'
  function render(
    container: HTMLElement,
    definition: Record<string, ConfigField>,
    base: Settings,
    overrides: Settings,
    prefix = '',
    pointer = ''
  ) {
    for (const [key, field] of Object.entries(definition)) {
      const effective = { ...base, ...overrides }
      if (
        field.condition &&
        Object.entries(field.condition).some(([name, expected]) => {
          return JSON.stringify(effective[name]) !== JSON.stringify(expected)
        })
      ) {
        continue
      }
      if (field.invisible) {
        continue
      }
      const path = prefix + key
      const secretPath = pointer + '/' + key.replaceAll('~', '~0').replaceAll('/', '~1')
      if (field.type === 'object') {
        const section = node('section', 'config-section')
        section.append(node('h3', '', field.description))
        if (field.hint) {
          section.append(node('p', 'section-hint', field.hint))
        }
        const inherited = SettingsSchema.parse(base[key] ?? defaults(field.items ?? {}))
        const local = SettingsSchema.parse(overrides[key] ?? {})
        if (top) {
          base[key] = inherited
        } else {
          overrides[key] = local
        }
        const group = node('fieldset', 'config-fieldset')
        group.disabled = field.readonly
        render(group, field.items ?? {}, inherited, local, path + '.', secretPath)
        section.append(group)
        container.append(section)
        continue
      }
      const row = node('div', 'config-row')
      const info = node('div', 'field-info')
      const label = node('label', '', field.description)
      label.htmlFor = 'config-' + path
      info.append(label)
      if (field.hint) {
        info.append(node('p', 'muted', field.hint))
      }
      let inherited = false
      let editable = !field.readonly
      if (!top) {
        if (
          !field.scope.includes(options.scope) ||
          containsConfigSecrets({ [key]: field }) ||
          field.readonly
        ) {
          editable = false
          info.append(pill('仅实例配置', 'neutral'))
        } else {
          inherited = !Object.hasOwn(overrides, key)
          const inherit = node('input')
          inherit.type = 'checkbox'
          inherit.checked = inherited
          inherit.setAttribute('aria-label', field.description + '：继承实例配置')
          const control = node('label', 'inherit-control')
          control.append(inherit, node('span', '', '继承实例配置'))
          info.append(control)
          inherit.addEventListener('change', () => {
            if (inherit.checked) {
              delete overrides[key]
            } else {
              overrides[key] = structuredClone(base[key])
            }
            options.changed()
          })
          editable = !inherited
        }
      }
      function write(value: z.infer<typeof SettingsSchema>[string]) {
        if (top) {
          base[key] = value
        } else {
          overrides[key] = value
        }
      }
      let value = base[key]
      if (!top && Object.hasOwn(overrides, key)) {
        value = overrides[key]
      }
      const inputArea = node('div', 'field-input')
      if (field.secret) {
        if (top) {
          inputArea.append(
            secretField(
              field,
              secretPath,
              options.secrets.some((item) => {
                return item.path === secretPath && item.configured
              }),
              options.secretChanges,
              () => {}
            )
          )
        } else {
          inputArea.append(pill('在实例配置中管理', 'neutral'))
        }
      } else if (field.type === 'template_list') {
        const entries = z.array(SettingsSchema).parse(value ?? [])
        if (editable) {
          write(entries)
        }
        const template = node('select')
        template.setAttribute('aria-label', field.description + '模板')
        for (const [templateKey, item] of Object.entries(field.templates ?? {})) {
          const option = node('option', '', item.name)
          option.value = templateKey
          template.append(option)
        }
        const add = button(
          '添加预设',
          () => {
            const selected = field.templates?.[template.value]
            if (selected) {
              entries.push({
                __template_key: template.value,
                __entry_id: configurationId(),
                ...defaults(selected.items)
              })
              write(entries)
              options.changed()
            }
          },
          'button secondary small'
        )
        add.disabled = !editable
        template.disabled = !editable
        const tools = node('div', 'inline-controls')
        tools.append(template, add)
        inputArea.append(tools)
        for (const [index, entry] of entries.entries()) {
          const templateKey = z.string().parse(entry.__template_key)
          const spec = field.templates?.[templateKey]
          if (!spec) {
            continue
          }
          const card = node('details', 'template-card')
          card.open = true
          card.append(node('summary', '', z.string().parse(entry[spec.display_item ?? 'name'] ?? spec.name)))
          const body = node('div', 'template-body')
          const editor = configForm(spec.items, {
            scope: 'instance',
            base: entry,
            overrides: {},
            changed: options.changed,
            prefix: path + '.' + index + '.',
            path: secretPath + '/@' + String(entry.__entry_id),
            choices: options.choices,
            secrets: options.secrets,
            secretChanges: options.secretChanges
          })
          const group = node('fieldset')
          group.disabled = !editable
          group.append(editor)
          const remove = button(
            '删除此预设',
            () => {
              entries.splice(index, 1)
              write(entries)
              options.changed()
            },
            'text-button danger'
          )
          remove.disabled = !editable
          body.append(group, remove)
          card.append(body)
          inputArea.append(card)
        }
      } else if (field.type === 'list' && !field.options && !field._special) {
        inputArea.append(listField(value, field.description, !editable, write))
      } else if (field.type === 'dict') {
        inputArea.append(dictField(value, field, !editable, write))
      } else if (field.type === 'bool') {
        const input = node('input', 'toggle-input')
        input.type = 'checkbox'
        input.id = 'config-' + path
        input.checked = z.boolean().parse(value)
        input.disabled = !editable
        input.setAttribute('aria-label', field.description)
        input.addEventListener('change', () => {
          write(input.checked)
          options.changed()
        })
        inputArea.append(input)
      } else if (field.options || field._special) {
        const input = node('select')
        const choices = (field.options ?? []).map((value, index) => {
          return [String(value), field.labels?.[index] ?? String(value)]
        })
        if (field._special) {
          choices.push(
            ...options.choices[field._special].map((item) => {
              return [item.id, item.name]
            })
          )
        }
        for (const [value, label] of choices) {
          const option = node('option', '', label)
          option.value = value
          input.append(option)
        }
        input.id = 'config-' + path
        if (field.type === 'list') {
          input.multiple = true
          const selected = z.array(z.string()).parse(value ?? [])
          for (const option of input.options) {
            option.selected = selected.includes(option.value)
          }
        } else {
          input.value = String(z.union([z.string(), z.number()]).parse(value))
        }
        input.disabled = !editable
        input.addEventListener('change', () => {
          if (field.type === 'list') {
            write(
              [...input.selectedOptions].map((option) => {
                return option.value
              })
            )
            return
          }
          const selected = field.options?.find((option) => {
            return String(option) === input.value
          })
          write(selected ?? input.value)
          options.changed()
        })
        inputArea.append(input)
      } else {
        let input: HTMLInputElement | HTMLTextAreaElement
        if (field.type === 'text' || field.type === 'list') {
          input = node('textarea')
          input.rows = 3
        } else {
          input = node('input')
          input.type = 'text'
          if (field.secret) {
            input.type = 'password'
          } else if (field.type === 'int' || field.type === 'float') {
            input.type = 'number'
            input.min = '0'
            if (field.min !== undefined) {
              input.min = String(field.min)
            }
            if (field.max !== undefined) {
              input.max = String(field.max)
            }
            input.step = '1'
            if (field.type === 'float') {
              input.step = 'any'
            }
            if (field.slider) {
              input.min = String(field.slider.min)
              input.max = String(field.slider.max)
              input.step = String(field.slider.step)
            }
          }
        }
        input.id = 'config-' + path
        input.required = field.required
        if (field.editor_mode) {
          input.classList.add('config-code-editor')
        }
        input.value = String(value ?? '')
        if (field.type === 'list') {
          input.value = z
            .array(z.string())
            .parse(value ?? [])
            .join('\n')
        }
        input.disabled = !editable
        input.addEventListener('change', () => {
          if (field.type === 'int' || field.type === 'float') {
            write(z.coerce.number().finite().parse(input.value))
          } else if (field.type === 'list') {
            write(input.value.split('\n').filter(Boolean))
          } else {
            write(input.value)
          }
        })
        inputArea.append(input)
        if (field.slider) {
          const range = node('input')
          range.type = 'range'
          range.min = String(field.slider.min)
          range.max = String(field.slider.max)
          range.step = String(field.slider.step)
          range.value = input.value
          range.disabled = !editable
          range.setAttribute('aria-label', field.description + '滑块')
          range.addEventListener('input', () => {
            input.value = range.value
            write(Number(range.value))
          })
          inputArea.append(range)
        }
      }
      row.append(info, inputArea)
      container.append(row)
    }
  }
  render(root, fields, options.base, options.overrides, options.prefix, options.path)
  return root
}
