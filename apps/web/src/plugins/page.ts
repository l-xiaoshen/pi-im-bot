import { node, button, pill, pluginIcon } from './dom'
import { request } from '../api'
import type { PageActions } from '../pages'
import { PluginEditorViewSchema, type PluginEditorView, type PluginView } from '@pi-im-bot/plugins/contracts'
import { type Installation } from '@pi-im-bot/plugins/install/contracts'
import { requestedGrants } from '@pi-im-bot/plugins/management'
import { installDialog, watchInstallation } from './install'
import { configurationPanel } from './configuration'
import { marketPanel } from './catalog'
import { pluginActions } from './actions'
import { usagePanel } from './usage'
import { environmentPanel } from './environment'
import { pipelinePanel } from './pipeline'
import { grantLabel } from './grants'

export function showPluginCenter(container: HTMLElement, actions: PageActions) {
  const page = node('div', 'plugin-center settings-page')
  const content = node('div')
  const progress = node('div', 'install-progress')
  const header = node('header', 'page-header')
  const controls = node('div', 'button-row')
  header.append(node('h1', '', '插件'), controls)
  const tabs = node('nav', 'tabs')
  const runtime = node('div')
  page.append(header, runtime, progress, tabs, content)
  container.replaceChildren(page)
  let state: PluginEditorView
  let selected = ''
  let tab = '配置'
  let mode = '已安装'
  let config: ReturnType<typeof configurationPanel> | undefined
  const manage = pluginActions(
    () => {
      return state
    },
    async () => {
      await load()
    },
    begin,
    actions.notify
  )
  function canLeave() {
    if (config?.hasDraft()) {
      actions.notify('请先保存或放弃修改')
      return false
    }
    return true
  }
  async function change(operation: () => Promise<void>) {
    if (!canLeave()) {
      return
    }
    content.inert = true
    try {
      await operation()
    } catch (error) {
      actions.notify(error)
    } finally {
      content.inert = false
    }
  }
  function open(id: string, section = '配置') {
    if (!canLeave()) {
      return
    }
    selected = id
    tab = section
    draw()
  }
  function environment() {
    if (!canLeave()) {
      return
    }
    selected = ''
    mode = '运行环境'
    draw()
  }
  async function load(render = true) {
    state = await request('/api/plugins', PluginEditorViewSchema)
    if (!page.isConnected) {
      return
    }
    runtime.replaceChildren()
    if (!state.runtimeEnabled) {
      const notice = node('div', 'runtime-blocker')
      notice.append(
        node('strong', '', '插件执行环境未启用'),
        button('配置运行环境', environment, 'button primary small')
      )
      runtime.append(notice)
    }
    if (render) {
      draw()
    }
  }
  controls.append(
    button('运行环境', environment, 'button secondary'),
    button(
      '安装插件',
      () => {
        if (state && canLeave()) {
          installDialog(state.revision, installed, actions.notify)
        }
      },
      'button primary'
    )
  )
  async function installed(job: Installation) {
    await load(false)
    if (job.stage !== 'succeeded') {
      actions.notify(job.error ?? '安装失败')
      return
    }
    progress.replaceChildren()
    if (!canLeave()) {
      return
    }
    selected = job.pluginId ?? ''
    tab = '配置'
    draw()
    actions.notify('插件已安装')
  }
  function begin(job: Installation) {
    void watchInstallation(progress, job.id, installed, actions.notify)
  }
  function status(plugin: PluginView) {
    if (!plugin.bundle) {
      return pill('未导入', 'amber')
    }
    if (!plugin.enabled) {
      return pill('已停用', 'neutral')
    }
    if (!state.runtimeEnabled) {
      return pill('环境未启用', 'amber')
    }
    if (plugin.issues.length) {
      return pill('配置待完成', 'amber')
    }
    if (missing(plugin).length) {
      return pill('缺少所需能力', 'amber')
    }
    return pill('已启用', 'green')
  }
  function missing(plugin: PluginView) {
    if (!plugin.bundle) {
      return []
    }
    return requestedGrants(plugin.bundle).filter((grant) => {
      return !plugin.grants.includes(grant)
    })
  }
  function operations(plugin: PluginView) {
    const row = node('div', 'plugin-actions')
    row.append(
      button(
        '配置',
        () => {
          open(plugin.id)
        },
        'button primary small'
      ),
      button(
        '使用方法',
        () => {
          open(plugin.id, '使用方法')
        },
        'button secondary small'
      )
    )
    const more = node('details', 'plugin-menu')
    more.append(node('summary', '', '更多'))
    const menu = node('div', 'plugin-menu-items')
    menu.append(
      button(
        '强制更新',
        () => {
          if (canLeave()) {
            manage.update(plugin)
          }
        },
        'text-button'
      ),
      button(
        '删除',
        () => {
          if (canLeave()) {
            manage.remove(plugin)
          }
        },
        'text-button danger'
      )
    )
    more.append(menu)
    row.append(more)
    return row
  }
  function draw() {
    config = undefined
    runtime.hidden = mode === '运行环境'
    container.scrollTop = 0
    tabs.replaceChildren()
    content.replaceChildren()
    for (const label of ['已安装', '发现插件', '编排']) {
      const item = button(
        label,
        () => {
          if (!canLeave()) {
            return
          }
          selected = ''
          mode = label
          draw()
        },
        'tab'
      )
      if ((!selected && mode === label) || (selected && label === '已安装')) {
        item.classList.add('active')
      }
      tabs.append(item)
    }
    if (selected) {
      const plugin = state.plugins.find((entry) => {
        return entry.id === selected
      })
      if (plugin) {
        detail(plugin)
        return
      }
      selected = ''
    }
    if (mode === '运行环境') {
      void environmentPanel(content, actions.notify, async () => {
        await load(false)
      }).catch(actions.notify)
      return
    }
    if (mode === '编排') {
      void pipelinePanel(content, actions.notify).catch(actions.notify)
      return
    }
    if (mode === '发现插件') {
      void marketPanel(content, state, actions.notify, open, begin).catch(actions.notify)
      return
    }
    const search = node('input', 'search')
    search.placeholder = '搜索插件'
    search.setAttribute('aria-label', '搜索已安装插件')
    const list = node('div', 'installed-list')
    content.append(search, list)
    function rows() {
      list.replaceChildren()
      for (const plugin of state.plugins.filter((plugin) => {
        return (plugin.name + (plugin.bundle?.manifest.description ?? '')).includes(search.value)
      })) {
        const card = node('article', 'plugin-card')
        card.dataset.plugin = plugin.id
        const info = node('div', 'plugin-info')
        const title = node('div', 'plugin-title-line')
        title.append(
          button(
            plugin.name,
            () => {
              open(plugin.id)
            },
            'plugin-name'
          ),
          node('span', 'plugin-version', plugin.bundle?.manifest.version ?? '未导入'),
          status(plugin)
        )
        info.append(title, node('p', 'description', plugin.bundle?.manifest.description ?? '未导入'))
        const toggle = button(
          '启用',
          () => {
            void change(() => {
              return manage.toggle(plugin)
            })
          },
          'plugin-switch'
        )
        toggle.setAttribute('role', 'switch')
        toggle.setAttribute('aria-label', plugin.name + ' 启用')
        toggle.setAttribute('aria-checked', String(plugin.enabled))
        if (plugin.enabled) {
          toggle.textContent = '已启用'
          toggle.classList.add('on')
        }
        card.append(pluginIcon(plugin.name), info, toggle, operations(plugin))
        list.append(card)
      }
      if (!state.plugins.length) {
        list.append(node('p', 'empty', '还没有插件。'))
      }
    }
    search.addEventListener('input', rows)
    rows()
  }
  function detail(plugin: PluginView) {
    content.append(
      button(
        '← 插件列表',
        () => {
          if (canLeave()) {
            selected = ''
            mode = '已安装'
            draw()
          }
        },
        'back-link'
      )
    )
    const heading = node('header', 'detail-header')
    const title = node('div', 'detail-title')
    const text = node('div')
    text.append(
      node('h2', '', plugin.name),
      node('span', 'plugin-version', plugin.bundle?.manifest.version ?? '未导入')
    )
    title.append(pluginIcon(plugin.name), text, status(plugin))
    const controls = node('div', 'button-row')
    let toggleLabel = '启用'
    if (plugin.enabled) {
      toggleLabel = '停用'
    }
    controls.append(
      button(
        toggleLabel,
        () => {
          if (canLeave()) {
            void change(() => {
              return manage.toggle(plugin)
            })
          }
        },
        'button secondary'
      ),
      button(
        '强制更新',
        () => {
          if (canLeave()) {
            manage.update(plugin)
          }
        },
        'button secondary'
      ),
      button(
        '删除',
        () => {
          if (canLeave()) {
            manage.remove(plugin)
          }
        },
        'text-button danger'
      )
    )
    heading.append(title, controls)
    content.append(heading)
    if (missing(plugin).length) {
      const warning = node('div', 'runtime-blocker')
      warning.append(
        node('span', '', '运行还需要：' + missing(plugin).map(grantLabel).join('、')),
        button(
          '允许所需能力',
          () => {
            void change(() => {
              return manage.allow(plugin)
            })
          },
          'button secondary small'
        )
      )
      content.append(warning)
    }
    const sections = node('nav', 'tabs')
    const names = ['配置', '使用方法']
    if (plugin.bundle?.manifest.hooks.length) {
      names.push('编排')
    }
    for (const name of names) {
      const item = button(
        name,
        () => {
          open(plugin.id, name)
        },
        'tab'
      )
      if (name === tab) {
        item.classList.add('active')
      }
      sections.append(item)
    }
    const body = node('div')
    content.append(sections, body)
    if (tab === '配置') {
      config = configurationPanel(body, plugin.id, actions.notify, async () => {
        await load(false)
      })
    } else if (tab === '使用方法') {
      void usagePanel(body, plugin).catch(actions.notify)
    } else {
      void pipelinePanel(body, actions.notify, plugin.id).catch(actions.notify)
    }
  }
  void load().catch(actions.notify)
  return {
    connected() {
      return page.isConnected
    }
  }
}
