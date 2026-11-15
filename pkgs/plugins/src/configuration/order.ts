import { z } from 'zod'
import type { PluginConfigurationEditor } from './editor'
import { PluginConfigTargetSchema } from './contracts'
import { SavePluginOrderSchema } from './order-contracts'
import { resolveSettings } from '@pi-im-bot/settings/resolve'
import { PluginRegistry } from '../registry'
import { writePluginScope } from './scopes'
import { SettingsEditError } from '@pi-im-bot/settings/editor'

export class PluginOrderEditor {
  constructor(readonly editor: PluginConfigurationEditor) {}
  async read(id: string, target: z.infer<typeof PluginConfigTargetSchema>) {
    const state = await this.editor.prepare(id, target)
    const { config } = state
    let settings = state.frameworkView.config.defaults
    if (target.level === 'account') {
      settings = resolveSettings(
        state.frameworkView.config,
        {
          channel: target.channel,
          accountId: target.accountId,
          kind: 'group',
          chatId: 'configuration-preview'
        },
        {},
        {},
        undefined,
        config.resources.pluginConfigurations()
      ).settings
    } else if (target.level === 'room') {
      settings = this.editor.coordinator.effective(target.roomId).settings
    } else if (target.level === 'conversation') {
      settings = this.editor.coordinator.effective(target.roomId, target.conversationId).settings
    }
    const handlers = state.bundle.manifest.hooks.map((hook) => {
      const key = id + '/' + hook.id
      return {
        key,
        point: hook.point,
        priority: settings.extensions.priorities[key] ?? hook.priority,
        disabled: settings.extensions.disabled[key] ?? false,
        before: hook.before,
        after: hook.after,
        requires: hook.requires
      }
    })
    let error: string | undefined
    let order: Array<{ point: string; handlers: string[] }> = []
    try {
      const bindings = config.resources.plugins(settings).filter((binding) => {
        return binding.instance.id !== id
      })
      bindings.push({ instance: state.instance, bundle: state.bundle })
      const registry = new PluginRegistry(bindings, settings.extensions)
      order = [...registry.handlers].map(([point, entries]) => {
        return {
          point,
          handlers: entries.map((entry) => {
            return entry.key
          })
        }
      })
    } catch (cause) {
      error = String(cause)
    }
    const selection = settings.resources.plugins
    return {
      revision: state.token,
      release: state.bundle.revision,
      target,
      selected: selection.mode === 'all' || selection.ids.includes(id),
      handlers,
      order,
      error
    }
  }
  async save(id: string, input: z.infer<typeof SavePluginOrderSchema>) {
    const state = await this.editor.prepare(id, input.target)
    const before = async () => {
      const current = await this.editor.prepare(id, input.target)
      if (current.token !== input.revision || current.bundle.revision !== input.release) {
        throw new SettingsEditError('配置或插件版本已变化，请刷新后重试', 409)
      }
    }
    await before()
    let patch = structuredClone(state.patch)
    if (input.target.level === 'instance') {
      patch = structuredClone(state.frameworkView.config.defaults)
    }
    patch.extensions ??= {}
    patch.extensions.priorities ??= {}
    patch.extensions.disabled ??= {}
    if (input.reset) {
      for (const key of Object.keys(patch.extensions.priorities)) {
        if (key.startsWith(id + '/')) {
          delete patch.extensions.priorities[key]
        }
      }
      for (const key of Object.keys(patch.extensions.disabled)) {
        if (key.startsWith(id + '/')) {
          delete patch.extensions.disabled[key]
        }
      }
    }
    for (const change of input.changes) {
      if (
        !state.bundle.manifest.hooks.some((hook) => {
          return id + '/' + hook.id === change.key
        })
      ) {
        throw new Error('只能调整当前实例的处理器')
      }
      patch.extensions.priorities[change.key] = change.priority
      patch.extensions.disabled[change.key] = change.disabled
    }
    if (input.selected !== undefined) {
      const resources = state.config.resources.config.plugins.map((plugin) => {
        return plugin.id
      })
      let ids = resources
      const selection = patch.resources?.plugins
      if (selection?.mode === 'selected') {
        ids = selection.ids
      }
      ids = ids.filter((entry) => {
        return entry !== id
      })
      if (input.selected) {
        ids.push(id)
      }
      patch.resources ??= {}
      patch.resources.plugins = { mode: 'selected', ids }
    }
    await writePluginScope(
      input.target,
      patch,
      state.frameworkView,
      this.editor.framework,
      this.editor.coordinator,
      before
    )
    return this.read(id, input.target)
  }
}
