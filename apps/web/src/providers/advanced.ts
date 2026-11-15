import { z } from 'zod'
import { element, field } from '../dom'
import { ExtraBodySchema, HeadersSchema } from '@pi-im-bot/providers/schema'
import { formError } from './dialog'

let fieldSequence = 0

export function jsonField<T>(label: string, value: T, schema: z.ZodType<T>) {
  const input = element('textarea', 'json-input')
  input.rows = 6
  input.spellcheck = false
  input.value = JSON.stringify(value, null, 2)
  function read() {
    let parsed: unknown
    try {
      parsed = JSON.parse(input.value || '{}')
    } catch {
      throw new Error(`${label} 必须是有效的 JSON 对象。`)
    }
    return schema.parse(parsed)
  }
  return { input, row: field(label, input), read }
}

export function requestFields(
  headers: Record<string, string | null>,
  body: Record<string, unknown>,
  inherited: boolean
) {
  const root = element('div', 'request-fields')
  const headersControl = jsonField('自定义 Headers（JSON）', headers, HeadersSchema)
  const bodyControl = jsonField('附加 Body（JSON）', body, ExtraBodySchema)
  const quick = element('div', 'provider-form-grid')
  const effort = element('input')
  const tier = element('input')
  const effortList = element('datalist')
  const tierList = element('datalist')
  fieldSequence += 1
  effortList.id = `provider-effort-${fieldSequence}`
  tierList.id = `provider-tier-${fieldSequence}`
  effort.setAttribute('list', effortList.id)
  tier.setAttribute('list', tierList.id)
  for (const value of ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']) {
    const option = element('option')
    option.value = value
    effortList.append(option)
  }
  for (const value of ['auto', 'default', 'priority', 'flex', 'fast']) {
    const option = element('option')
    option.value = value
    tierList.append(option)
  }
  let hint = '留空使用服务默认值'
  if (inherited) {
    hint = '留空继承提供商设置'
  }
  effort.placeholder = hint
  tier.placeholder = hint
  const error = element('p', 'form-error')
  function sync() {
    try {
      const value = bodyControl.read()
      const reasoning = z.object({ effort: z.string().optional() }).safeParse(value.reasoning)
      effort.value = ''
      if (reasoning.success) {
        effort.value = reasoning.data.effort ?? ''
      }
      const serviceTier = z.string().safeParse(value.service_tier)
      tier.value = ''
      if (serviceTier.success) {
        tier.value = serviceTier.data
      }
      error.textContent = ''
    } catch {
      /* Invalid drafts remain editable in the JSON textarea. */
    }
  }
  function update(kind: 'effort' | 'tier') {
    try {
      const value = bodyControl.read()
      if (kind === 'effort') {
        const current = z.record(z.string(), z.unknown()).safeParse(value.reasoning)
        let reasoning: Record<string, unknown> = {}
        if (current.success) {
          reasoning = current.data
        }
        if (effort.value.trim()) {
          reasoning.effort = effort.value.trim()
        } else {
          delete reasoning.effort
        }
        if (Object.keys(reasoning).length) {
          value.reasoning = reasoning
        } else {
          delete value.reasoning
        }
      } else {
        if (tier.value.trim()) {
          value.service_tier = tier.value.trim()
        } else {
          delete value.service_tier
        }
      }
      bodyControl.input.value = JSON.stringify(value, null, 2)
      error.textContent = ''
    } catch (cause) {
      error.textContent = formError(cause)
    }
  }
  effort.addEventListener('change', () => {
    update('effort')
  })
  tier.addEventListener('change', () => {
    update('tier')
  })
  bodyControl.input.addEventListener('input', sync)
  quick.append(
    field('推理强度 · reasoning.effort', effort),
    field('服务等级 · service_tier', tier),
    effortList,
    tierList
  )
  root.append(
    quick,
    error,
    headersControl.row,
    bodyControl.row,
    element(
      'small',
      'muted',
      '支持直接输入其他取值。模型设置覆盖提供商设置；嵌套对象合并，数组替换。已保存的凭据占位保持原值。'
    )
  )
  sync()
  return {
    root,
    read() {
      return { headers: headersControl.read(), body: bodyControl.read() }
    }
  }
}
