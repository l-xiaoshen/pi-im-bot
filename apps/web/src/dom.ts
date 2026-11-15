export function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  text?: string
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  node.className = className
  if (text !== undefined) {
    node.textContent = text
  }
  return node
}

export function button(text: string, action: () => void, className = 'button') {
  const node = element('button', className, text)
  node.type = 'button'
  node.addEventListener('click', action)
  return node
}

export function field(label: string, input: HTMLElement) {
  if (['INPUT', 'SELECT', 'TEXTAREA'].includes(input.tagName) && !input.hasAttribute('aria-label')) {
    input.setAttribute('aria-label', label)
  }
  const wrapper = element('label', 'field')
  wrapper.append(element('span', 'field-label', label), input)
  return wrapper
}

export function time(value: number) {
  return new Date(value).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
}

export function count(value: number) {
  return new Intl.NumberFormat('zh-CN', { notation: 'compact', maximumFractionDigits: 1 }).format(value)
}

export function showDialog(
  title: string,
  contents: HTMLElement[],
  submitLabel: string,
  onSubmit: () => Promise<void>
) {
  const dialog = element('dialog', 'dialog')
  const form = element('form', 'dialog-form')
  form.append(element('h2', '', title), ...contents)
  const footer = element('div', 'dialog-footer')
  footer.append(
    button(
      '取消',
      () => {
        dialog.close()
      },
      'button secondary'
    )
  )
  const submit = element('button', 'button primary', submitLabel)
  submit.type = 'submit'
  footer.append(submit)
  const error = element('p', 'form-error')
  form.append(error, footer)
  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    submit.disabled = true
    error.textContent = ''
    try {
      await onSubmit()
      dialog.close()
    } catch (cause) {
      error.textContent = String(cause)
    } finally {
      submit.disabled = false
    }
  })
  dialog.append(form)
  dialog.addEventListener('close', () => {
    dialog.remove()
  })
  document.body.append(dialog)
  dialog.showModal()
  return dialog
}
