import { element, button } from '../dom'
import { editorDialog, textField, numberField, nextId } from './dialog'
import { CandidateSchema, ProviderGroupSchema, type ProviderGroup } from '@pi-im-bot/providers/schema'
import type { ProviderEditorSnapshot } from '@pi-im-bot/providers/editor-contracts'
import { saveGroup, deleteGroup, defaultGroup } from './client'

export function groupPanel(
  snapshot: ProviderEditorSnapshot,
  saved: (value: ProviderEditorSnapshot) => void,
  notify: (error: unknown) => void
) {
  const root = element('div', 'provider-groups')
  const heading = element('div', 'provider-section-heading')
  heading.append(
    element('div', '', '按顺序尝试候选模型；默认组用于新建会话。'),
    button(
      '新增候选组',
      () => {
        editGroup(snapshot, saved)
      },
      'button primary'
    )
  )
  root.append(heading)
  for (const group of snapshot.groups) {
    const card = element('section', 'provider-group-card')
    const head = element('div', 'card-heading')
    const title = element('div', 'provider-title-row')
    title.append(element('h2', '', group.name || group.id))
    if (snapshot.defaultGroup === group.id) {
      title.append(element('span', 'badge completed', '默认组'))
    }
    const actions = element('div', 'button-row')
    if (snapshot.defaultGroup !== group.id) {
      actions.append(
        button(
          '设为默认组',
          () => {
            void defaultGroup(snapshot, group.id).then(saved).catch(notify)
          },
          'button secondary'
        )
      )
    }
    actions.append(
      button(
        '编辑',
        () => {
          editGroup(snapshot, saved, group)
        },
        'button secondary'
      )
    )
    const remove = button(
      '删除',
      () => {
        const dialog = editorDialog('删除候选组', '删除候选组', async () => {
          saved(await deleteGroup(snapshot, group.id))
        })
        dialog.body.append(
          element('p', '', `删除「${group.name || group.id}」？默认组被删除后，将切换到剩余的第一个组。`)
        )
      },
      'text-button danger-text'
    )
    remove.disabled = snapshot.groups.length <= 1 || (snapshot.groupUsage[group.id]?.length ?? 0) > 0
    remove.title = '正在被会话使用的组或最后一个组不能删除'
    actions.append(remove)
    head.append(title, actions)
    card.append(head, element('p', 'muted', `${group.id} · 失败冷却 ${group.cooldownMs / 1000} 秒`))
    group.candidates.forEach((candidate, index) => {
      const provider = snapshot.providers.find((item) => {
        return item.id === candidate.provider
      })
      const model = provider?.models.find((item) => {
        return item.id === candidate.model
      })
      const row = element('div', 'candidate')
      let rank = `备用 ${index}`
      if (index === 0) {
        rank = '首选'
      }
      const identity = element('div')
      identity.append(
        element('strong', '', model?.name || candidate.model),
        element('small', '', provider?.name || candidate.provider)
      )
      row.append(element('span', 'candidate-rank', rank), identity)
      if (!provider?.enabled || !model?.enabled) {
        row.append(element('span', 'badge disabled', '已停用'))
      }
      card.append(row)
    })
    if (group.candidates.length === 0) {
      card.append(element('p', 'empty-note', '尚无候选模型，添加后才会调用真实服务。'))
    }
    root.append(card)
  }
  return root
}

function editGroup(
  snapshot: ProviderEditorSnapshot,
  saved: (value: ProviderEditorSnapshot) => void,
  current?: ProviderGroup
) {
  const id = textField(
    '候选组标识',
    current?.id ??
      nextId(
        'group',
        snapshot.groups.map((group) => {
          return group.id
        })
      )
  )
  id.input.required = true
  id.input.pattern = '[a-z][a-z0-9_-]*'
  id.input.readOnly = Boolean(current)
  const name = textField('显示名称', current?.name ?? '')
  const cooldown = numberField('失败冷却（秒）', (current?.cooldownMs ?? 60000) / 1000, 0)
  let candidates = structuredClone(current?.candidates ?? [])
  const rows = element('div', 'group-candidate-editor')
  const error = element('p', 'form-error')
  const available = snapshot.providers.flatMap((provider) => {
    return provider.models.map((model) => {
      let label = `${provider.name || provider.id} / ${model.name || model.id}`
      if (!provider.enabled || !model.enabled) {
        label += '（已停用）'
      }
      return { value: JSON.stringify({ provider: provider.id, model: model.id }), label }
    })
  })
  function renderCandidates() {
    rows.replaceChildren()
    candidates.forEach((candidate, index) => {
      const row = element('div', 'group-candidate-row')
      const select = element('select')
      select.setAttribute('aria-label', `候选模型 ${index + 1}`)
      for (const item of available) {
        const option = element('option', '', item.label)
        option.value = item.value
        select.append(option)
      }
      select.value = JSON.stringify(candidate)
      select.addEventListener('change', () => {
        candidates[index] = CandidateSchema.parse(JSON.parse(select.value))
      })
      const up = button(
        '↑',
        () => {
          const previous = candidates[index - 1]
          candidates[index - 1] = candidates[index]
          candidates[index] = previous
          renderCandidates()
        },
        'icon-button'
      )
      up.disabled = index === 0
      up.setAttribute('aria-label', `上移候选 ${index + 1}`)
      const down = button(
        '↓',
        () => {
          const next = candidates[index + 1]
          candidates[index + 1] = candidates[index]
          candidates[index] = next
          renderCandidates()
        },
        'icon-button'
      )
      down.disabled = index === candidates.length - 1
      down.setAttribute('aria-label', `下移候选 ${index + 1}`)
      const remove = button(
        '×',
        () => {
          candidates.splice(index, 1)
          renderCandidates()
        },
        'icon-button'
      )
      remove.setAttribute('aria-label', `移除候选 ${index + 1}`)
      row.append(element('span', 'candidate-number', String(index + 1)), select, up, down, remove)
      rows.append(row)
    })
  }
  let title = '新增候选组'
  if (current) {
    title = `编辑候选组 · ${current.name || current.id}`
  }
  const modal = editorDialog(title, '保存候选组', async () => {
    const group = ProviderGroupSchema.parse({
      id: id.input.value.trim(),
      name: name.input.value.trim() || undefined,
      cooldownMs: Number(cooldown.input.value) * 1000,
      candidates
    })
    saved(await saveGroup(snapshot, group, current?.id))
  })
  const grid = element('div', 'provider-form-grid')
  grid.append(name.row, id.row)
  modal.body.append(
    grid,
    cooldown.row,
    element('h3', '', '候选顺序'),
    element('p', 'muted', '第一项为首选，其余按顺序故障转移。'),
    rows,
    button(
      '添加候选',
      () => {
        const selected = new Set(
          candidates.map((candidate) => {
            return JSON.stringify(candidate)
          })
        )
        const candidate = available.find((item) => {
          return !selected.has(item.value)
        })
        if (!candidate) {
          error.textContent = '没有更多模型，请先为提供商添加模型。'
          return
        }
        candidates = [...candidates, CandidateSchema.parse(JSON.parse(candidate.value))]
        error.textContent = ''
        renderCandidates()
      },
      'button secondary'
    ),
    error
  )
  renderCandidates()
  name.input.focus()
}
