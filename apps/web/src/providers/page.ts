import { element, button, time } from '../dom'
import type { Snapshot } from '@pi-im-bot/contracts/http'
import type { PageActions } from '../pages'
import {
  providerDraft,
  type ProviderEditorSnapshot,
  type ProviderView,
  type ModelDraft
} from '@pi-im-bot/providers/editor-contracts'
import {
  loadProviders,
  saveProvider,
  deleteProvider,
  fetchModels,
  testModel,
  defaultCandidate
} from './client'
import { editProvider } from './provider-form'
import { editModel } from './model-form'
import { pickModels } from './model-picker'
import { editorDialog, formError } from './dialog'
import { groupPanel } from './groups'

const preferences = { tab: 'providers', providerId: '', search: '' }

export function showProviders(container: HTMLElement, _status: Snapshot, actions: PageActions) {
  const root = element('div', 'providers-page')
  container.replaceChildren(root)
  let snapshot: ProviderEditorSnapshot | undefined
  const feedback = element('div', 'provider-feedback')
  feedback.setAttribute('role', 'status')

  function message(text: string, error = false) {
    feedback.textContent = text
    feedback.classList.toggle('is-error', error)
  }
  function saved(value: ProviderEditorSnapshot) {
    snapshot = value
    render()
    actions.notify('配置已保存，新任务立即生效。')
    void actions.refresh().catch(actions.notify)
  }
  async function load() {
    try {
      snapshot = await loadProviders()
      render()
    } catch (error) {
      root.replaceChildren(
        element('p', 'form-error', formError(error)),
        button('重试', () => {
          void load()
        })
      )
    }
  }
  function newProvider() {
    if (!snapshot) {
      return
    }
    editProvider(snapshot, (value, id, fetchAfter) => {
      preferences.providerId = id
      saved(value)
      if (fetchAfter) {
        const provider = value.providers.find((item) => {
          return item.id === id
        })!
        void getModels(value, provider)
      }
    })
  }
  async function getModels(
    state: ProviderEditorSnapshot,
    provider: ProviderView,
    control?: HTMLButtonElement
  ) {
    if (control) {
      control.disabled = true
      control.textContent = '获取中…'
    }
    message('正在获取模型列表…')
    try {
      const result = await fetchModels(state, providerDraft(provider), provider.id)
      message(`已获取 ${result.models.length} 个模型。`)
      pickModels(state, provider, result.models, saved)
    } catch (error) {
      message(formError(error), true)
      actions.notify(error)
    } finally {
      if (control) {
        control.disabled = false
        control.textContent = '获取模型列表'
      }
    }
  }
  function render() {
    if (!snapshot || !root.isConnected) {
      return
    }
    const state = snapshot
    const header = element('header', 'page-header')
    const title = element('div')
    title.append(
      element('h1', '', '模型与 Provider'),
      element('p', 'subtitle', '配置服务、选择模型，再安排主选与备用顺序。保存后直接生效。')
    )
    const tools = element('div', 'button-row')
    tools.append(
      button(
        '刷新',
        () => {
          void load()
        },
        'button secondary'
      ),
      button(
        '从文件重载',
        () => {
          void actions.reload().catch(actions.notify)
        },
        'button secondary'
      )
    )
    header.append(title, tools)
    const tabs = element('div', 'provider-tabs')
    for (const [id, label] of [
      ['providers', '服务与模型'],
      ['groups', '候选组']
    ]) {
      const tab = button(
        label,
        () => {
          preferences.tab = id
          render()
        },
        'provider-tab'
      )
      tab.classList.toggle('active', preferences.tab === id)
      tabs.append(tab)
    }
    root.replaceChildren(header, tabs, feedback)
    if (!state.applied) {
      root.append(
        element(
          'div',
          'provider-notice',
          '配置文件已有外部修改。编辑将以文件内容为基础；也可点击「从文件重载」应用现有文件。'
        )
      )
    }
    if (preferences.tab === 'groups') {
      root.append(groupPanel(state, saved, actions.notify))
      return
    }
    const workbench = element('div', 'provider-workbench')
    const sidebar = element('aside', 'provider-source-list')
    const sourceHead = element('div', 'provider-source-heading')
    sourceHead.append(element('strong', '', '服务提供商'), button('＋ 新增', newProvider, 'text-button'))
    sourceHead.querySelector('button')?.setAttribute('aria-label', '新增提供商')
    sidebar.append(sourceHead)
    let selected = state.providers.find((provider) => {
      return provider.id === preferences.providerId
    })
    if (!selected) {
      selected = state.providers[0]
      preferences.providerId = selected?.id ?? ''
    }
    const mobile = element('select', 'provider-mobile-select')
    mobile.setAttribute('aria-label', '选择服务提供商')
    for (const provider of state.providers) {
      const option = element('option', '', provider.name || provider.id)
      option.value = provider.id
      mobile.append(option)
      const item = button(
        '',
        () => {
          preferences.providerId = provider.id
          preferences.search = ''
          render()
        },
        'provider-source'
      )
      item.classList.toggle('active', provider.id === selected?.id)
      const identity = element('div')
      identity.append(
        element('strong', '', provider.name || provider.id),
        element('small', '', provider.baseUrl)
      )
      item.append(element('span', 'provider-source-icon', 'O'), identity)
      if (!provider.enabled) {
        item.append(element('span', 'provider-off-dot'))
      }
      sidebar.append(item)
    }
    mobile.value = preferences.providerId
    mobile.addEventListener('change', () => {
      preferences.providerId = mobile.value
      preferences.search = ''
      render()
    })
    sidebar.insertBefore(mobile, sourceHead.nextSibling)
    const content = element('section', 'provider-content')
    if (selected) {
      renderSource(content, state, selected)
    } else {
      content.append(
        element('div', 'provider-empty', '还没有服务提供商。先添加一个 OpenAI Responses 服务。'),
        button('新增提供商', newProvider, 'button primary')
      )
    }
    workbench.append(sidebar, content)
    root.append(workbench)
  }

  function renderSource(content: HTMLElement, state: ProviderEditorSnapshot, provider: ProviderView) {
    const heading = element('div', 'provider-detail-header')
    const identity = element('div')
    identity.append(element('h2', '', provider.name || provider.id), element('p', 'muted', provider.baseUrl))
    const controls = element('div', 'button-row')
    const enabled = element('input')
    enabled.type = 'checkbox'
    enabled.role = 'switch'
    enabled.checked = provider.enabled
    enabled.setAttribute('aria-label', '启用提供商')
    enabled.addEventListener('change', () => {
      const draft = providerDraft(provider)
      draft.enabled = enabled.checked
      enabled.disabled = true
      void saveProvider(state, draft, provider.id)
        .then(saved)
        .catch((error) => {
          enabled.checked = provider.enabled
          actions.notify(error)
        })
        .finally(() => {
          enabled.disabled = false
        })
    })
    const label = element('label', 'provider-switch')
    label.append(enabled, element('span', '', '启用'))
    controls.append(
      label,
      button(
        '编辑连接',
        () => {
          editProvider(
            state,
            (value, id, fetchAfter) => {
              preferences.providerId = id
              saved(value)
              if (fetchAfter) {
                void getModels(
                  value,
                  value.providers.find((item) => {
                    return item.id === id
                  })!
                )
              }
            },
            provider
          )
        },
        'button secondary'
      ),
      button(
        '删除',
        () => {
          const related = state.groups
            .filter((group) => {
              return group.candidates.some((candidate) => {
                return candidate.provider === provider.id
              })
            })
            .map((group) => {
              return group.name || group.id
            })
          const modal = editorDialog('删除提供商', '删除提供商', async () => {
            preferences.providerId = ''
            saved(await deleteProvider(state, provider.id))
          })
          modal.body.append(
            element('p', '', `删除「${provider.name || provider.id}」及其 ${provider.models.length} 个模型？`)
          )
          if (related.length) {
            modal.body.append(element('p', 'muted', `将同时移出候选组：${related.join('、')}。`))
          }
        },
        'text-button danger-text'
      )
    )
    heading.append(identity, controls)
    const connection = element('div', 'provider-connection-summary')
    let credential = '未设置 API Key'
    if (provider.hasApiKey) {
      credential = 'API Key 已保存'
    }
    if (provider.apiKeyEnv) {
      credential = `环境变量：${provider.apiKeyEnv}`
    }
    connection.append(
      element('span', 'badge', 'OpenAI Responses'),
      element('span', '', credential),
      element('span', '', `超时 ${provider.timeoutMs / 1000}s`)
    )
    const toolbar = element('div', 'provider-model-toolbar')
    const search = element('input')
    search.placeholder = '搜索已配置模型'
    search.setAttribute('aria-label', '搜索已配置模型')
    search.value = preferences.search
    const fetchButton = button(
      '获取模型列表',
      () => {
        void getModels(state, provider, fetchButton)
      },
      'button primary'
    )
    toolbar.append(
      search,
      fetchButton,
      button(
        '手动添加',
        () => {
          editModel(state, provider, saved)
        },
        'button secondary'
      )
    )
    const models = element('div', 'provider-model-list')
    function filter() {
      preferences.search = search.value
      models.replaceChildren()
      const filtered = provider.models.filter((model) => {
        return `${model.id} ${model.name ?? ''}`.toLowerCase().includes(search.value.toLowerCase())
      })
      for (const model of filtered) {
        models.append(modelRow(state, provider, model))
      }
      if (!filtered.length) {
        models.append(element('p', 'provider-empty', '暂无模型。获取服务模型列表，或手动填写模型 ID。'))
      }
    }
    search.addEventListener('input', filter)
    content.append(
      heading,
      connection,
      toolbar,
      element('div', 'provider-section-caption', `已配置模型 · ${provider.models.length}`),
      models
    )
    filter()
  }

  function modelRow(state: ProviderEditorSnapshot, provider: ProviderView, model: ModelDraft) {
    const row = element('div', 'provider-model-row')
    row.dataset.model = model.id
    const identity = button(
      '',
      () => {
        editModel(state, provider, saved, model)
      },
      'provider-model-identity'
    )
    identity.append(element('strong', '', model.name || model.id))
    if (model.name) {
      identity.append(element('small', '', model.id))
    }
    const badges = element('div', 'model-badges')
    badges.append(element('span', 'badge', `${Math.round(model.contextWindow / 1000)}k 上下文`))
    if (model.reasoning) {
      badges.append(element('span', 'badge', '推理'))
    }
    if (model.images) {
      badges.append(element('span', 'badge', '图片'))
    }
    const primary = state.groups.find((group) => {
      return group.id === state.defaultGroup
    })?.candidates[0]
    if (primary?.provider === provider.id && primary.model === model.id) {
      badges.append(element('span', 'badge completed', '默认主选'))
    }
    identity.append(badges)
    const controls = element('div', 'model-row-actions')
    const enabled = element('input')
    enabled.type = 'checkbox'
    enabled.role = 'switch'
    enabled.checked = model.enabled
    enabled.setAttribute('aria-label', `启用模型 ${model.id}`)
    enabled.addEventListener('change', () => {
      const draft = providerDraft(provider)
      draft.models.find((item) => {
        return item.id === model.id
      })!.enabled = enabled.checked
      enabled.disabled = true
      void saveProvider(state, draft, provider.id)
        .then(saved)
        .catch((error) => {
          enabled.checked = model.enabled
          actions.notify(error)
        })
        .finally(() => {
          enabled.disabled = false
        })
    })
    const test = button(
      '测试',
      () => {
        test.disabled = true
        test.textContent = '测试中…'
        message(`正在测试 ${model.id}（最多 256 输出 token）…`)
        void testModel(state, providerDraft(provider), model.id, provider.id)
          .then((result) => {
            let label = '测试失败'
            if (result.ok) {
              label = '连接成功'
            }
            if (result.ok && result.status === 'length') {
              label = '接口已响应，达到测试输出上限'
            }
            const report = `${model.id} · ${label} · ${(result.durationMs / 1000).toFixed(2)} 秒\n${result.text}`
            message(report, !result.ok)
            actions.notify(report)
          })
          .catch((error) => {
            message(formError(error), true)
          })
          .finally(() => {
            test.disabled = false
            test.textContent = '测试'
          })
      },
      'text-button'
    )
    test.setAttribute('aria-label', `测试模型 ${model.id}`)
    const primaryButton = button(
      '设为主选',
      () => {
        void defaultCandidate(state, { provider: provider.id, model: model.id })
          .then(saved)
          .catch(actions.notify)
      },
      'text-button'
    )
    primaryButton.disabled = !provider.enabled || !model.enabled
    controls.append(
      enabled,
      test,
      primaryButton,
      button(
        '配置',
        () => {
          editModel(state, provider, saved, model)
        },
        'text-button'
      ),
      button(
        '删除',
        () => {
          const modal = editorDialog('删除模型', '删除模型', async () => {
            const draft = providerDraft(provider)
            draft.models = draft.models.filter((item) => {
              return item.id !== model.id
            })
            saved(await saveProvider(state, draft, provider.id))
          })
          modal.body.append(element('p', '', `删除模型「${model.id}」？该模型也会从候选组中移除。`))
        },
        'text-button danger-text'
      )
    )
    row.append(identity, controls)
    return row
  }
  root.append(element('p', 'empty-note', '正在读取 Provider 配置…'))
  void load()
}
