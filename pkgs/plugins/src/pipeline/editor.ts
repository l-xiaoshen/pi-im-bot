import { z } from 'zod'
import type { PluginConfigurationEditor } from '../configuration/editor'
import { builtinPluginPoints } from '../hooks/points'
import { revision } from '@pi-im-bot/settings/resolve'
import { SettingsEditError } from '@pi-im-bot/settings/editor'
import type { SavePipelineSchema } from './contracts'

export class PluginPipelineEditor {
  constructor(private readonly editor: PluginConfigurationEditor) {}
  async read() {
    const framework = await this.editor.framework.read()
    const resources = await this.editor.plugins.read()
    const config = this.editor.plugins.configuration()
    const settings = framework.config.defaults
    const registry = config.resources.pluginRegistry(settings)
    return {
      revision: revision({ framework: framework.version, resources: resources.revision }),
      nodes: [...builtinPluginPoints]
        .sort((a, b) => {
          return a.order - b.order
        })
        .map((node) => {
          const planned = registry.handlers.get(node.id) ?? []
          const handlers = resources.plugins
            .flatMap((plugin) => {
              return (plugin.bundle?.manifest.hooks ?? [])
                .filter((hook) => {
                  return hook.point === node.id
                })
                .map((hook) => {
                  const key = plugin.id + '/' + hook.id
                  return {
                    key,
                    pluginId: plugin.id,
                    pluginName: plugin.name,
                    enabled: !(settings.extensions.disabled[key] ?? false),
                    available: planned.some((entry) => {
                      return entry.key === key
                    }),
                    priority: settings.extensions.priorities[key] ?? hook.priority,
                    before: hook.before,
                    after: hook.after,
                    requires: hook.requires
                  }
                })
            })
            .sort((a, b) => {
              const left = planned.findIndex((entry) => {
                return entry.key === a.key
              })
              const right = planned.findIndex((entry) => {
                return entry.key === b.key
              })
              if (left >= 0 && right >= 0) {
                return left - right
              }
              if (left >= 0) {
                return -1
              }
              if (right >= 0) {
                return 1
              }
              return a.key.localeCompare(b.key)
            })
          return {
            id: node.id,
            title: node.title,
            stage: node.stage,
            position: node.position,
            mode: node.mode,
            summary: node.summary,
            flow: node.flow,
            source: node.source,
            writable: [...node.writable],
            input: z.toJSONSchema(node.input),
            output: z.toJSONSchema(node.output),
            handlers
          }
        })
    }
  }
  async save(input: z.infer<typeof SavePipelineSchema>) {
    const state = await this.read()
    if (state.revision !== input.revision) {
      throw new SettingsEditError('流程或插件版本已变化，请刷新后重试', 409)
    }
    const keys = new Set(
      state.nodes.flatMap((node) => {
        return node.handlers.map((handler) => {
          return handler.key
        })
      })
    )
    const framework = await this.editor.framework.read()
    for (const change of input.changes) {
      if (!keys.has(change.key)) {
        throw new Error('只能配置已经声明在真实节点上的处理器')
      }
      framework.config.defaults.extensions.priorities[change.key] = change.priority
      framework.config.defaults.extensions.disabled[change.key] = change.disabled
    }
    await this.editor.framework.save(framework.version, framework.config, async () => {
      if ((await this.read()).revision !== input.revision) {
        throw new SettingsEditError('流程或插件配置已变化，未覆盖', 409)
      }
    })
    return this.read()
  }
}
