import { z } from 'zod'
import { button, element, field } from '../dom'

export function editorDialog(title: string, label: string, save: (action: string) => Promise<void>) {
  const dialog = element('dialog', 'dialog provider-dialog')
  const form = element('form', 'provider-dialog-form')
  const header = element('header', 'provider-dialog-header')
  const body = element('div', 'provider-dialog-body')
  const footer = element('footer', 'dialog-footer')
  const error = element('p', 'form-error')
  error.setAttribute('role', 'alert')
  const controller = new AbortController()
  let busy = false
  const close = button(
    '×',
    () => {
      dialog.close()
    },
    'dialog-close'
  )
  close.setAttribute('aria-label', '关闭配置')
  header.append(element('h2', '', title), close)
  const cancel = button(
    '取消',
    () => {
      dialog.close()
    },
    'button secondary'
  )
  const submit = element('button', 'button primary', label)
  submit.type = 'submit'
  submit.dataset.action = 'save'
  footer.append(cancel, submit)
  form.append(header, body, error, footer)
  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    if (busy) {
      return
    }
    busy = true
    form.inert = true
    error.textContent = ''
    const original = submit.textContent
    submit.textContent = '保存中…'
    try {
      await save(event.submitter?.dataset.action ?? 'save')
      dialog.close()
    } catch (cause) {
      error.textContent = formError(cause)
    } finally {
      busy = false
      form.inert = false
      submit.textContent = original
    }
  })
  dialog.addEventListener('cancel', (event) => {
    if (busy) {
      event.preventDefault()
    }
  })
  dialog.addEventListener('close', () => {
    controller.abort()
    dialog.remove()
  })
  dialog.append(form)
  document.body.append(dialog)
  dialog.showModal()
  return { dialog, body, footer, error, submit, signal: controller.signal }
}

export function formError(error: unknown) {
  if (error instanceof z.ZodError) {
    return error.issues
      .map((issue) => {
        return `${issue.path.join('.')}：${issue.message}`
      })
      .join('\n')
  }
  if (error instanceof Error) {
    return error.message
  }
  return String(error)
}

export function textField(label: string, value = '', placeholder = '') {
  const input = element('input')
  input.value = value
  input.placeholder = placeholder
  return { input, row: field(label, input) }
}

export function numberField(label: string, value: number, min: number) {
  const control = textField(label, String(value))
  control.input.type = 'number'
  control.input.min = String(min)
  control.input.required = true
  return control
}

export function checkbox(label: string, checked: boolean) {
  const input = element('input')
  input.type = 'checkbox'
  input.checked = checked
  const row = element('label', 'provider-checkbox')
  row.append(input, element('span', '', label))
  return { input, row }
}

export function nextId(prefix: string, existing: string[]) {
  let index = 1
  while (existing.includes(`${prefix}-${index}`)) {
    index += 1
  }
  return `${prefix}-${index}`
}
