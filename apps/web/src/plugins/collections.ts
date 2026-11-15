import { z } from 'zod'
import { node, button } from './dom'
import type { ConfigField, ConfigValues } from '@pi-im-bot/plugins/configuration/schema'

export function listField(value: unknown, label: string, disabled: boolean, save: (value: string[]) => void) {
  const values = z.array(z.string()).parse(value ?? [])
  const root = node('div', 'list-editor')
  function render() {
    root.replaceChildren()
    for (const [index, item] of values.entries()) {
      const row = node('div', 'inline-controls')
      const input = node('input')
      input.value = item
      input.disabled = disabled
      input.setAttribute('aria-label', label + ' 第 ' + (index + 1) + ' 项')
      input.addEventListener('change', () => {
        values[index] = input.value
        save(values)
      })
      const remove = button(
        '删除',
        () => {
          values.splice(index, 1)
          save(values)
          render()
        },
        'text-button danger'
      )
      remove.disabled = disabled
      row.append(input, remove)
      root.append(row)
    }
    const add = button(
      '添加一项',
      () => {
        values.push('')
        save(values)
        render()
      },
      'button secondary small'
    )
    add.disabled = disabled
    root.append(add)
  }
  render()
  return root
}
export function dictField(
  value: unknown,
  field: ConfigField,
  disabled: boolean,
  save: (value: ConfigValues) => void
) {
  const values = z
    .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
    .parse(value ?? {})
  const root = node('div', 'dict-editor')
  function render() {
    root.replaceChildren()
    for (const [key, value] of Object.entries(values)) {
      const row = node('div', 'inline-controls')
      const name = node('input')
      name.value = key
      name.readOnly = true
      name.setAttribute('aria-label', field.description + ' 字段名')
      const input = node('input')
      input.value = String(value ?? '')
      input.setAttribute('aria-label', key + ' 的值')
      input.disabled = disabled
      let type = typeof value
      const declared = (field.template_schema ?? field.items)?.[key]
      if (declared?.type === 'int' || declared?.type === 'float') {
        type = 'number'
      }
      if (declared?.type === 'bool') {
        type = 'boolean'
      }
      input.addEventListener('change', () => {
        if (type === 'number') {
          values[key] = Number(input.value)
        } else if (type === 'boolean') {
          values[key] = input.value === 'true'
        } else {
          values[key] = input.value
        }
        save(values)
      })
      const remove = button(
        '删除',
        () => {
          delete values[key]
          save(values)
          render()
        },
        'text-button danger'
      )
      remove.disabled = disabled
      row.append(name, input, remove)
      root.append(row)
    }
    const key = node('input')
    key.placeholder = '新字段名'
    key.setAttribute('aria-label', field.description + ' 新字段名')
    key.disabled = disabled
    const add = button(
      '添加字段',
      () => {
        const name = key.value.trim()
        if (
          !name ||
          ['__proto__', 'constructor', 'prototype'].includes(name) ||
          Object.hasOwn(values, name)
        ) {
          return
        }
        values[name] = ''
        const declared = (field.template_schema ?? field.items)?.[name]
        if (declared?.default !== undefined) {
          values[name] = z.union([z.string(), z.number(), z.boolean(), z.null()]).parse(declared.default)
        }
        save(values)
        render()
      },
      'button secondary small'
    )
    add.disabled = disabled
    const row = node('div', 'inline-controls')
    row.append(key, add)
    root.append(row)
  }
  render()
  return root
}
