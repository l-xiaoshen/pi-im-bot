import { element, field } from '../dom'

export function selectOptions(items: Array<{ id: string; name: string }>, value: string) {
  const select = element('select')
  for (const item of items) {
    const option = element('option', '', item.name)
    option.value = item.id
    select.append(option)
  }
  select.value = value
  return select
}

export function overrideControl<T>(
  label: string,
  input: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  value: T | undefined,
  defaults: boolean,
  source: string,
  read: () => T
) {
  input.setAttribute('aria-label', label)
  const wrapper = element('div', 'setting-field')
  const override = element('input')
  override.type = 'checkbox'
  override.checked = defaults || value !== undefined
  override.setAttribute('aria-label', `覆盖${label}`)
  const toggle = element('label', 'setting-override')
  toggle.append(override, document.createTextNode('在此设置'))
  if (defaults) {
    toggle.hidden = true
  }
  const hint = element('small', 'muted', `生效来源：${source}`)
  input.disabled = !override.checked
  override.addEventListener('change', () => {
    input.disabled = !override.checked
  })
  wrapper.append(field(label, input), toggle, hint)
  return {
    node: wrapper,
    read() {
      if (!override.checked) {
        return undefined
      }
      return read()
    }
  }
}

export function booleanInput(value: boolean) {
  return selectOptions(
    [
      { id: 'true', name: '开启' },
      { id: 'false', name: '关闭' }
    ],
    String(value)
  )
}
