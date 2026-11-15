import type { PluginInstance, PluginPackage, PluginOverrides } from './config'
import type { PluginHook, PluginOperation, PluginPointSchema } from './manifest'
import type { z } from 'zod'
import { builtinPluginPoints } from './hooks/points'
import { orderHooks, type OrderedHook } from './hooks/order'
import { pluginCommandId, pluginOperationId, pluginToolName } from './identity'
import { patchPathSegments, writablePath } from './hooks/path'

export interface PluginBinding {
  instance: PluginInstance
  bundle: PluginPackage
}
export interface PluginCapabilityEntry extends PluginBinding {
  capabilityId: string
}
export interface PluginOperationEntry extends PluginCapabilityEntry {
  operation: PluginOperation
  modelName: string
}
export interface PluginPoint {
  id: string
  mode: PluginHook['mode']
  writable: readonly string[]
  owner?: PluginBinding
  definition?: z.infer<typeof PluginPointSchema>
}

interface PluginCommandEntry {
  binding: PluginBinding
  command: PluginPackage['manifest']['commands'][number]
  capabilityId: string
}

export interface HookSelector {
  channel: string
  origin: string
  phase?: string
}

const reservedCommands = new Set(['help', 'status', 'stop', 'new', 'skills', 'skill', 'jobs', 'job'])

export class PluginRegistry {
  readonly points = new Map<string, PluginPoint>()
  readonly operations = new Map<string, PluginOperationEntry>()
  readonly commands = new Map<string, PluginCommandEntry>()
  readonly handlers = new Map<string, OrderedHook[]>()
  readonly bindings = new Map<string, PluginBinding>()

  constructor(
    bindings: readonly PluginBinding[],
    readonly overrides: PluginOverrides
  ) {
    for (const point of builtinPluginPoints) {
      this.points.set(point.id, point)
    }
    for (const binding of bindings) {
      const { instance, bundle } = binding
      if (this.bindings.has(instance.id)) {
        throw new Error('插件实例重复：' + instance.id)
      }
      this.bindings.set(instance.id, binding)
      for (const point of bundle.manifest.points) {
        const id = 'plugin.' + instance.id + '.' + point.id
        this.points.set(id, {
          id,
          mode: point.mode,
          writable: point.writable,
          owner: binding,
          definition: point
        })
      }
      for (const operation of bundle.manifest.operations) {
        const id = pluginOperationId(instance.id, operation.id)
        this.operations.set(id, {
          ...binding,
          operation,
          capabilityId: id,
          modelName: pluginToolName(instance.id, operation.id)
        })
      }
    }
    for (const binding of bindings) {
      const { instance, bundle } = binding
      for (const command of bundle.manifest.commands) {
        const id = pluginCommandId(instance.id, command.id)
        if (overrides.disabled[instance.id + '/command:' + command.id]) {
          continue
        }
        for (const name of command.names) {
          const key = name.toLowerCase()
          if (reservedCommands.has(key) || this.commands.has(key)) {
            throw new Error('命令别名冲突：/' + name)
          }
          this.commands.set(key, { binding, command, capabilityId: id })
        }
      }
      for (const hook of bundle.manifest.hooks) {
        const key = instance.id + '/' + hook.id
        if (overrides.disabled[key]) {
          continue
        }
        const pointId = this.pointId(instance, hook.point)
        const point = this.points.get(pointId)
        if (!point) {
          throw new Error(key + ' 引用了不存在的切入点：' + pointId)
        }
        if (point.mode !== hook.mode) {
          throw new Error(key + ' 的切入点模式不匹配')
        }
        if (
          hook.writes?.some((path) => {
            return !writablePath(patchPathSegments(path), point.writable.map(patchPathSegments))
          })
        ) {
          throw new Error(key + ' 声明了切入点范围以外的可写字段')
        }
        const resolved: PluginHook = {
          ...hook,
          point: pointId,
          before: hook.before.map((id) => {
            return this.handlerId(instance, id)
          }),
          after: hook.after.map((id) => {
            return this.handlerId(instance, id)
          }),
          requires: hook.requires.map((id) => {
            return this.handlerId(instance, id)
          })
        }
        const handlers = this.handlers.get(pointId) ?? []
        handlers.push({
          key,
          instanceId: instance.id,
          generation: bundle.revision,
          hook: resolved,
          priority: overrides.priorities[key] ?? hook.priority
        })
        this.handlers.set(pointId, handlers)
      }
    }
    for (const [point, handlers] of this.handlers) {
      if (this.points.get(point)?.mode === 'exclusive' && handlers.length > 1) {
        throw new Error('独占切入点存在多个处理器：' + point)
      }
      this.handlers.set(point, orderHooks(handlers))
    }
  }

  private handlerId(instance: PluginInstance, id: string) {
    const [owner, handler] = id.split('/')
    let target = instance.dependencies[owner] ?? owner
    if (owner === 'self') {
      target = instance.id
    }
    return target + '/' + handler
  }
  pointId(instance: PluginInstance, id: string) {
    if (!id.startsWith('plugin.')) {
      return id
    }
    const [, owner, ...name] = id.split('.')
    let target = instance.dependencies[owner] ?? owner
    if (owner === 'self') {
      target = instance.id
    }
    return ['plugin', target, ...name].join('.')
  }
  plan(point: string, selector: HookSelector) {
    return (this.handlers.get(point) ?? []).filter((entry) => {
      const match = entry.hook.selector
      return (
        (!match.channels || match.channels.includes(selector.channel)) &&
        (!match.origins ||
          match.origins.some((origin) => {
            return origin === selector.origin
          })) &&
        (!match.phases ||
          match.phases.some((phase) => {
            return phase === selector.phase
          }))
      )
    })
  }
}
