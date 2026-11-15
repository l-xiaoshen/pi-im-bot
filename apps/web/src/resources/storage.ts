import { element, button } from '../dom'
import { request, mutate } from '../api'
import type { PageActions } from '../pages'
import { StorageOverviewSchema } from '@pi-im-bot/plugins/storage/status'

function size(bytes: number) {
  return (bytes / (1024 * 1024)).toLocaleString('zh-CN', { maximumFractionDigits: 1 }) + ' MiB'
}

export function storagePanel(container: HTMLElement, actions: PageActions) {
  const root = element('details', 'card')
  root.append(element('summary', '', '插件数据与产物额度'))
  const content = element('div')
  const buttons = element('div', 'button-row')
  buttons.append(
    button(
      '刷新存储状态',
      () => {
        void load().catch(actions.notify)
      },
      'button secondary'
    ),
    button(
      '核对已移除的产物文件',
      () => {
        void mutate('/api/plugins/storage/reconcile').then(load).catch(actions.notify)
      },
      'button secondary'
    )
  )
  root.append(buttons, content)
  container.append(root)
  async function load() {
    const status = await request('/api/plugins/storage', StorageOverviewSchema)
    if (!root.isConnected) {
      return
    }
    content.replaceChildren(
      element(
        'p',
        '',
        '插件数据预留 ' + size(status.data.reservedBytes) + ' / ' + size(status.data.totalBytes)
      ),
      element(
        'p',
        'muted',
        '每卷 ' +
          size(status.data.volumeBytes) +
          '；每插件 ' +
          size(status.data.pluginBytes) +
          '；最多 ' +
          status.data.maxVolumes +
          ' 卷。'
      )
    )
    if (!status.data.dependenciesReady) {
      content.append(
        element('p', 'muted', '持久数据文件系统依赖未就绪，执行前需要安装并配置 fuse2fs 等工具。')
      )
    }
    content.append(
      element(
        'p',
        '',
        '产物 ' +
          size(status.artifacts.bytes) +
          ' / ' +
          size(status.artifacts.limits.maxTotalBytes) +
          ' · ' +
          status.artifacts.items +
          ' 项 · 正在写入 ' +
          status.artifacts.pending
      ),
      element(
        'p',
        'muted',
        '单文件上限 ' +
          size(status.artifacts.limits.maxFileBytes) +
          '。核对只释放已不存在文件的额度，不删除现有数据。'
      )
    )
    for (const volume of status.data.volumes) {
      const item = element('div', 'resource-tool')
      item.append(
        element('p', '', volume.instanceId + ' · ' + volume.scopeKey.slice(0, 8) + ' · ' + volume.state),
        element('p', 'muted', '预留 ' + size(volume.bytes))
      )
      if (volume.usedBytes !== undefined) {
        item.append(element('p', 'muted', '上次测量占用 ' + size(volume.usedBytes)))
      }
      if (volume.error) {
        item.append(element('p', 'form-error', volume.error))
      }
      content.append(item)
    }
  }
  void load().catch(actions.notify)
}
