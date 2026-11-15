import type { OneBotTarget } from '@pi-im-bot/channels/onebot/config'
import { targetKey } from '@pi-im-bot/channels/onebot/config'
import {
  OneBotPublicSettingsSchema,
  type OneBotPublicSettings,
  type OneBotSettingsInput,
  type OneBotStatus,
  type DiscoveredChat
} from '@pi-im-bot/channels/onebot/status'
import { request } from '../api'
import { element, field, showDialog } from '../dom'
import type { PageActions } from '../pages'

export async function saveSettings(settings: OneBotPublicSettings, changes: Partial<OneBotSettingsInput>) {
  return request('/api/onebot/settings', OneBotPublicSettingsSchema, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      version: settings.version,
      enabled: settings.enabled,
      commandPrefix: settings.commandPrefix,
      targets: settings.targets,
      ...changes
    })
  })
}

export function connectionDialog(settings: OneBotPublicSettings, actions: PageActions) {
  const enabled = element('input')
  enabled.type = 'checkbox'
  enabled.checked = settings.enabled
  const prefix = element('input')
  prefix.value = settings.commandPrefix
  prefix.required = true
  prefix.maxLength = 32
  const token = element('input')
  const mediaOrigins = element('textarea')
  mediaOrigins.rows = 2
  mediaOrigins.value = settings.mediaOrigins.join('\n')
  mediaOrigins.placeholder = '例如 http://media.example:8080；QQ 官方图片域名已内置'
  token.type = 'password'
  token.autocomplete = 'new-password'
  token.placeholder = '可选，与 NapCat 的 Token 保持一致'
  if (settings.tokenConfigured) {
    token.placeholder = '已配置；留空保留原 Token'
  }
  const clear = element('input')
  clear.type = 'checkbox'
  clear.addEventListener('change', () => {
    token.disabled = clear.checked
    if (clear.checked) {
      token.value = ''
    }
  })
  showDialog(
    'QQ 连接设置',
    [
      field('启用 QQ 接入', enabled),
      field('Agent 消息前缀', prefix),
      field('额外媒体来源（每行一个 HTTP(S) origin）', mediaOrigins),
      field('Access Token', token),
      field('清除已保存的 Token', clear),
      element(
        'p',
        'muted',
        'Token 不会回显。修改 Token 后现有连接会断开，请在 NapCat 填写相同值，等待自动重连。留空且不勾选清除会保留原值。'
      )
    ],
    '保存连接设置',
    async () => {
      await saveSettings(settings, {
        enabled: enabled.checked,
        commandPrefix: prefix.value,
        mediaOrigins: mediaOrigins.value.split(/\s+/u).filter(Boolean),
        accessToken: token.value,
        clearToken: clear.checked
      })
      await actions.refresh()
    }
  )
}

export function targetDialog(
  settings: OneBotPublicSettings,
  status: OneBotStatus,
  actions: PageActions,
  replace?: OneBotTarget,
  selected?: DiscoveredChat
) {
  const account = element('input')
  account.required = true
  account.pattern = '[0-9]+'
  account.value = selected?.selfId ?? replace?.selfId ?? status.accounts[0] ?? ''
  const group = element('input')
  group.required = true
  group.pattern = '[0-9]+'
  group.value = selected?.chatId ?? ''
  const name = element('input')
  name.maxLength = 100
  name.value = ''
  if (selected) {
    name.value = 'QQ ' + selected.name
  }
  const choice = element('select')
  choice.append(element('option', '', '从已发现会话选择，或手动填写'))
  const chats = status.chats.filter((chat) => {
    return chat.kind === 'group'
  })
  for (const chat of chats) {
    const option = element('option', '', chat.name + ' · ' + chat.chatId + ' · 账号 ' + chat.selfId)
    option.value = targetKey(chat)
    choice.append(option)
  }
  if (selected) {
    choice.value = targetKey(selected)
  }
  choice.addEventListener('change', () => {
    const chat = chats.find((item) => {
      return targetKey(item) === choice.value
    })
    if (chat) {
      account.value = chat.selfId
      group.value = chat.chatId
      name.value = 'QQ ' + chat.name
    }
  })
  let title = '新增测试渠道'
  const content: HTMLElement[] = [
    field('选择已发现会话', choice),
    field('机器人 QQ 号', account),
    field('群号 / 讨论组标识', group),
    field('显示名称', name)
  ]
  if (replace) {
    title = '更换测试渠道'
    content.push(element('p', 'muted', '更换后停用 ' + replace.name + '，停止其在途任务并保留历史记录。'))
  }
  showDialog(title, content, '保存并启用', async () => {
    const next: OneBotTarget = {
      selfId: account.value.trim(),
      chatId: group.value.trim(),
      name: name.value.trim() || 'QQ ' + group.value.trim(),
      enabled: true
    }
    const targets = settings.targets
      .map((target) => {
        if (replace && targetKey(target) === targetKey(replace)) {
          return { ...target, enabled: false }
        }
        return { ...target }
      })
      .filter((target) => {
        return targetKey(target) !== targetKey(next)
      })
    targets.push(next)
    await saveSettings(settings, { targets })
    await actions.refresh()
  })
}
