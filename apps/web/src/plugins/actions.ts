import { request } from '../api'
import { showDialog } from '../dom'
import { node } from './dom'
import { PluginEditorViewSchema, type PluginView, type PluginEditorView } from '@pi-im-bot/plugins/contracts'
import { InstallationSchema, type Installation } from '@pi-im-bot/plugins/install/contracts'
import { requestedGrants } from '@pi-im-bot/plugins/management'

export function pluginActions(
  state: () => PluginEditorView,
  refresh: () => Promise<void>,
  install: (job: Installation) => void,
  notify: (value: unknown) => void
) {
  async function manage(plugin: PluginView, enabled: boolean) {
    let grants = plugin.grants
    if (enabled && plugin.bundle) {
      grants = [...new Set([...grants, ...requestedGrants(plugin.bundle)])]
    }
    await request('/api/plugins/' + plugin.id, PluginEditorViewSchema, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ revision: state().revision, patch: { enabled, grants } })
    })
    await refresh()
  }
  return {
    toggle(plugin: PluginView) {
      return manage(plugin, !plugin.enabled)
    },
    allow(plugin: PluginView) {
      return manage(plugin, true)
    },
    update(plugin: PluginView) {
      showDialog(
        '强制更新 ' + plugin.name,
        [node('p', '', '从原始来源重新获取并校验插件。保留配置和数据，失败时保留当前版本。')],
        '强制更新',
        async () => {
          const job = await request('/api/plugins/' + plugin.id + '/update', InstallationSchema, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ revision: state().revision })
          })
          install(job)
        }
      )
    },
    remove(plugin: PluginView) {
      showDialog(
        '删除 ' + plugin.name,
        [node('p', '', '移除插件，保留数据与配置归档。')],
        '删除插件',
        async () => {
          await request('/api/plugins/' + plugin.id, PluginEditorViewSchema, {
            method: 'DELETE',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ revision: state().revision })
          })
          await refresh()
        }
      )
    }
  }
}
