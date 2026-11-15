import { element, button, field } from '../dom'
import { request, mutate } from '../api'
import { pageTitle, type PageActions } from '../pages'
import {
  FrameworkEditorSchema,
  RoomDetailSchema,
  type FrameworkEditorState,
  type RoomDetail,
  type Snapshot
} from '@pi-im-bot/contracts/http'
import { SettingsSchema, type SettingsPatch } from '@pi-im-bot/settings/schema'
import { settingsForm } from './form'
import { personaLibrary } from './personas'

interface Target {
  id: string
  label: string
  kind: 'defaults' | 'account' | 'scope' | 'conversation'
  roomId?: string
  channel?: string
  accountId?: string
}

export function showFramework(
  container: HTMLElement,
  snapshot: Snapshot,
  actions: PageActions,
  initialRoom = ''
) {
  const page = element('div', 'settings-page framework-page')
  const header = pageTitle(
    'Bot 设置',
    '默认 → 平台账号 → 渠道 → 会话上下文。群内成员共享渠道设置，会话只承载上下文。'
  )
  const body = element('div', 'framework-body')
  const feedback = element('p', 'provider-feedback')
  const targets: Target[] = [{ id: 'defaults', label: '全局默认', kind: 'defaults' }]
  const selector = element('select')
  selector.setAttribute('aria-label', '设置作用域')
  const accountKeys = new Set<string>()
  for (const room of snapshot.rooms) {
    const key = JSON.stringify([room.address.channel, room.address.accountId])
    if (!accountKeys.has(key)) {
      accountKeys.add(key)
      targets.push({
        id: `account:${key}`,
        label: `账号 · ${room.address.channel}/${room.address.accountId}`,
        kind: 'account',
        channel: room.address.channel,
        accountId: room.address.accountId
      })
    }
    targets.push({ id: `scope:${room.id}`, label: `渠道 · ${room.name}`, kind: 'scope', roomId: room.id })
    targets.push({
      id: `conversation:${room.id}`,
      label: `会话上下文 · ${room.name}`,
      kind: 'conversation',
      roomId: room.id
    })
  }
  for (const target of targets) {
    const option = element('option', '', target.label)
    option.value = target.id
    selector.append(option)
  }
  if (initialRoom) {
    selector.value = `scope:${initialRoom}`
  }
  const targetBar = element('div', 'card')
  targetBar.append(field('设置作用域', selector))
  page.append(header, targetBar, feedback, body)
  container.replaceChildren(page)
  let library: FrameworkEditorState
  let loadSequence = 0

  async function load() {
    const sequence = ++loadSequence
    body.inert = true
    body.setAttribute('aria-busy', 'true')
    try {
      const target = targets.find((item) => {
        return item.id === selector.value
      })!
      const nextLibrary = await request('/api/framework', FrameworkEditorSchema)
      let detail: RoomDetail | undefined
      if (target.roomId) {
        detail = await request(`/api/rooms/${target.roomId}`, RoomDetailSchema)
      }
      if (sequence !== loadSequence || !page.isConnected) {
        return
      }
      library = nextLibrary
      let patch: SettingsPatch = library.config.defaults
      let effective = library.config.defaults
      let sources: Record<string, string> = {}
      if (target.kind === 'account') {
        patch =
          library.config.accounts.find((account) => {
            return account.channel === target.channel && account.accountId === target.accountId
          })?.settings ?? {}
        // Only ancestors supply defaults; room/conversation overrides are displayed in their own views.
        effective = SettingsSchema.parse({
          ...effective,
          data: { ...effective.data, ...patch.data },
          preferences: { ...effective.preferences, ...patch.preferences },
          behavior: { ...effective.behavior, ...patch.behavior },
          output: { ...effective.output, ...patch.output },
          resources: { ...effective.resources, ...patch.resources },
          extensions: { ...effective.extensions, ...patch.extensions },
          permissions: patch.permissions ?? effective.permissions
        })
        for (const section of [
          'data',
          'preferences',
          'behavior',
          'output',
          'resources',
          'extensions'
        ] as const) {
          for (const field of Object.keys(patch[section] ?? {})) {
            sources[section + '.' + field] = '账号'
          }
        }
        if (patch.permissions) {
          sources.permissions = '账号'
        }
      }
      if (detail) {
        effective = detail.effective.settings
        sources = detail.effective.sources
        patch = detail.room.settings
        if (target.kind === 'conversation') {
          patch = detail.conversations.find((item) => {
            return item.id === detail.room.currentConversationId
          })!.settings
        }
      }
      const form = element('form')
      const fields = settingsForm(patch, effective, sources, target.kind === 'defaults', snapshot, library)
      const submit = element('button', 'button primary', '保存设置')
      submit.type = 'submit'
      const footer = element('div', 'settings-save')
      footer.append(submit, element('small', 'muted', '取消“在此设置”即恢复继承；保存后对新任务生效。'))
      form.append(fields.node, footer)
      form.addEventListener('submit', async (event) => {
        event.preventDefault()
        submit.disabled = true
        feedback.textContent = ''
        try {
          const settings = fields.read()
          if (target.kind === 'defaults') {
            await saveLibrary({
              ...library,
              config: { ...library.config, defaults: SettingsSchema.parse(settings) }
            })
          } else if (target.kind === 'account') {
            const accounts = library.config.accounts.filter((item) => {
              return item.channel !== target.channel || item.accountId !== target.accountId
            })
            accounts.push({ channel: target.channel!, accountId: target.accountId!, settings })
            await saveLibrary({ ...library, config: { ...library.config, accounts } })
          } else if (detail && target.kind === 'scope') {
            await mutate(
              `/api/rooms/${detail.room.id}`,
              { revision: detail.room.revision, settings },
              'PATCH'
            )
          } else if (detail) {
            const current = detail.conversations.find((item) => {
              return item.id === detail.room.currentConversationId
            })!
            await mutate(
              `/api/rooms/${detail.room.id}/conversations/${current.id}`,
              { revision: current.revision, settings },
              'PATCH'
            )
          }
          feedback.classList.remove('is-error')
          feedback.textContent = '设置已保存。'
          await load()
        } catch (error) {
          feedback.classList.add('is-error')
          feedback.textContent = String(error)
        } finally {
          submit.disabled = false
        }
      })
      body.dataset.target = target.id
      body.replaceChildren(
        form,
        personaLibrary(library, async (personas) => {
          await saveLibrary({ ...library, config: { ...library.config, personas } })
          await load()
        })
      )
      if (detail) {
        const effectiveView = element('details', 'card')
        effectiveView.append(
          element('summary', '', '查看最终生效值与来源'),
          element('pre', 'settings-effective', JSON.stringify(detail.effective, null, 2))
        )
        body.append(effectiveView)
      }
    } finally {
      if (sequence === loadSequence) {
        body.inert = false
        body.setAttribute('aria-busy', 'false')
      }
    }
  }
  async function saveLibrary(next: FrameworkEditorState) {
    await mutate('/api/framework', { version: next.version, config: next.config }, 'PUT')
  }
  selector.addEventListener('change', () => {
    void load().catch(actions.notify)
  })
  header.append(
    button(
      '刷新设置',
      () => {
        void load().catch(actions.notify)
      },
      'button secondary'
    )
  )
  void load().catch(actions.notify)
}
