import { z } from 'zod'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { node } from './dom'
import { request } from '../api'
import type { PluginView } from '@pi-im-bot/plugins/contracts'

export async function usagePanel(root: HTMLElement, plugin: PluginView) {
  const usage = node('section', 'surface usage-panel')
  for (const command of plugin.bundle?.manifest.commands ?? []) {
    const commandRow = node('div', 'usage-command')
    commandRow.append(
      node(
        'code',
        '',
        command.names
          .map((name) => {
            return '/' + name
          })
          .join(' · ')
      ),
      node('p', '', command.description)
    )
    usage.append(commandRow)
  }
  for (const operation of plugin.bundle?.manifest.operations ?? []) {
    const missing = operation.grants.filter((grant) => {
      return !plugin.grants.includes(grant)
    })
    let availability = '实例能力已就绪，实际调用仍需当前范围与触发人的权限'
    if (missing.length) {
      availability = '不可调用：缺少授权 ' + missing.join('、')
    }
    if (plugin.state !== 'configured') {
      availability = '不可调用：请检查实例状态、执行环境或服务绑定'
    }
    usage.append(node('p', 'muted', operation.title + ' · ' + availability))
    if (operation.tool) {
      usage.append(node('p', '', '模型工具：' + operation.title))
    }
  }
  const result = await request(
    '/api/plugins/' + plugin.id + '/documents/README.md',
    z.object({ text: z.string(), name: z.string() })
  )
  if (!root.isConnected) {
    return
  }
  const readme = node('div', 'plugin-readme')
  readme.innerHTML = DOMPurify.sanitize(marked.parse(result.text, { async: false }), {
    USE_PROFILES: { html: true }
  })
  for (const link of readme.querySelectorAll('a')) {
    link.rel = 'noreferrer noopener'
  }
  usage.append(readme)
  root.replaceChildren(usage)
}
