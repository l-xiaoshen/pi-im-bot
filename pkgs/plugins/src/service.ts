import { validateComfyDelivery } from "./comfy-delivery"
import type { Settings } from "@pi-im-bot/settings/schema"
import { namedService, serviceRevision } from "@pi-im-bot/integrations/resources"
import type { Configuration } from "@pi-im-bot/config/load"
import type { PluginWorkerManager } from "./runtime/manager"
import { PluginOperationOutcomeSchema, type PluginAction, type PluginOperationOutcome } from "./rpc/protocol"
import { pluginInvocationView, pluginOperations, type PluginInvocation } from "./invocation"
import type { PluginOperationEntry, PluginBinding, PluginCapabilityEntry, PluginRegistry } from "./registry"
import type { OrderedHook } from "./hooks/order"
import { pluginHookId, pluginOperationId } from "./identity"
import { AsyncLocalStorage } from "node:async_hooks"
import { workerScopeKey } from "./runtime/container-spec"
import { executePluginPoint } from "./points"
import { RunLimiter } from "@pi-im-bot/support/limiter"
import { pluginHostServices } from "./host"
import { PluginArgumentsSchema } from "./result"
import { PluginInvocationError } from "./rpc/peer"
import { gsviExecutionRevision } from "@pi-im-bot/integrations/gsvi/identity"
import type { RenderPlan } from "@pi-im-bot/contracts/rendering"
import { serviceOperationBudget } from "./operation-budget"

interface PluginCallScope {
  chain: readonly string[]
  execution: "foreground" | "background"
}

export class PluginService {
  managed?: import("./managed").PluginManagedServices
  observePoint?: (invocation: PluginInvocation, point: string, id: string, value: unknown) => string | undefined
  private readonly active = new Map<string, Set<AbortController>>()
  private readonly owners = new Map<AbortController, string>()
  private readonly calls = new AsyncLocalStorage<PluginCallScope>()
  private readonly schemaCalls: RunLimiter
  private changingRuntime = false

  constructor(
    private readonly configuration: () => Configuration,
    public manager: PluginWorkerManager
  ) {
    this.schemaCalls = new RunLimiter(manager.config.maxValidators)
  }

  available() {
    return !this.changingRuntime && this.configuration().bot.plugins.enabled && this.manager.config.enabled
  }
  async changeRuntime(operation: () => Promise<void>) {
    if (
      this.changingRuntime ||
      this.owners.size ||
      this.manager.status().invocations ||
      this.manager.status().waiting
    ) {
      throw new Error("插件仍有活动调用，请完成后再调整执行环境")
    }
    this.changingRuntime = true
    try {
      await operation()
    } finally {
      this.changingRuntime = false
    }
  }

  withoutParentCall<T>(operation: () => Promise<T>) {
    return this.calls.run({ chain: [], execution: "foreground" }, operation)
  }

  configurationChanged() {
    const enabled = new Set(
      this.configuration()
        .resources.config.plugins.filter((instance) => {
          return instance.enabled
        })
        .map((instance) => {
          return instance.id
        })
    )
    for (const [controller, instanceId] of this.owners) {
      if (!enabled.has(instanceId)) {
        controller.abort(new Error("插件已停用或移除"))
      }
    }
    this.manager.retainInstances(enabled)
  }

  async scoped<T>(
    roomId: string,
    instanceId: string,
    parentSignal: AbortSignal,
    operation: (signal: AbortSignal) => Promise<T>
  ) {
    const controller = new AbortController()
    const controllers = this.active.get(roomId) ?? new Set<AbortController>()
    controllers.add(controller)
    this.active.set(roomId, controllers)
    this.owners.set(controller, instanceId)
    try {
      return await operation(AbortSignal.any([parentSignal, controller.signal]))
    } finally {
      controllers.delete(controller)
      this.owners.delete(controller)
      if (controllers.size === 0) {
        this.active.delete(roomId)
      }
    }
  }

  validateDelivery(config: Configuration, settings: Settings, capability: string) {
    validateComfyDelivery(config, this.configuration(), settings, capability)
  }
  operation(invocation: PluginInvocation, capability: string) {
    const entry = pluginOperations(invocation.config, invocation.input).find((entry) => {
      return entry.capabilityId === capability
    })
    if (!entry) {
      throw new Error("插件操作未登记或未在当前范围启用：" + capability)
    }
    return entry
  }

  async validatePoint(
    invocation: PluginInvocation,
    owner: PluginBinding,
    point: string,
    value: unknown,
    validation: "input" | "output",
    signal: AbortSignal
  ) {
    const context = pluginInvocationView(
      invocation,
      owner,
      value,
      [],
      Math.min(this.configuredPointMs(invocation), 3000),
      "schema:" + point
    )
    context.settings = {}
    context.actors = []
    const release = await this.schemaCalls.acquire(signal)
    try {
      await this.manager.invoke(
        owner,
        { kind: "validate", handler: point, validation, phase: "execute" },
        context,
        value,
        signal,
        async () => {
          throw new Error("契约验证 Worker 不提供宿主能力")
        },
        [],
        undefined,
        "validator"
      )
    } finally {
      release()
    }
  }
  private configuredPointMs(invocation: PluginInvocation) {
    return invocation.config.bot.plugins.maxPointMs
  }

  private authorize(invocation: PluginInvocation, entry: PluginCapabilityEntry) {
    if (!this.available()) {
      throw new Error("插件执行后端未启用")
    }
    invocation.services.assertActive?.()
    invocation.services.authorize(entry.capabilityId)
    const current = this.configuration().resources.config.plugins.find((instance) => {
      return instance.id === entry.instance.id
    })
    if (!current?.enabled) {
      throw new Error("插件实例已停用")
    }
    return current
  }

  async execute(
    invocation: PluginInvocation,
    capability: string,
    input: unknown,
    callId: string,
    signal: AbortSignal,
    phase: PluginAction["phase"] = "execute"
  ): Promise<PluginOperationOutcome> {
    return this.executeOperation(invocation, capability, input, callId, signal, phase)
  }

  async executeInlinePresentation(
    invocation: PluginInvocation,
    capability: string,
    input: unknown,
    callId: string,
    signal: AbortSignal,
    timeoutMs: number
  ) {
    if (!this.manager.canStartInlinePresentation()) {
      throw new Error("短时呈现没有可用容量，保留前台控制槽并使用原文")
    }
    const entry = this.operation(invocation, capability)
    if (
      entry.operation.data !== "none" ||
      entry.operation.execution !== "background" ||
      entry.operation.grants.some((grant) => !grant.startsWith("service:") && grant !== "artifact.write")
    ) {
      throw new Error("短时呈现只允许无私有数据、无再次发送能力的服务渲染操作")
    }
    return this.executeOperation(invocation, capability, input, callId, signal, "execute", timeoutMs)
  }

  validateInlinePresentation(invocation: PluginInvocation, plan: RenderPlan) {
    const entry = this.operation(invocation, plan.capability)
    const current = this.authorize(invocation, entry)
    if (this.configuration().resources.pluginPackage(current.id)?.revision !== entry.bundle.revision) {
      throw new Error("短时呈现插件版本已改变")
    }
    const access = plan.access.plugin
    if (!access || access.instanceId !== current.id || access.grants.some((grant) => !current.grants.includes(grant))) {
      throw new Error("短时呈现授权已撤销")
    }
    for (const [alias, saved] of Object.entries(access.services)) {
      const live = namedService(this.configuration(), saved.id)
      if (current.services[alias] !== saved.id || !live?.enabled || serviceRevision(live) !== saved.revision) {
        throw new Error("短时呈现服务绑定或版本已撤销")
      }
    }
    for (const capability of plan.access.capabilities) {
      invocation.services.authorize(capability)
    }
  }

  private async executeOperation(
    invocation: PluginInvocation,
    capability: string,
    input: unknown,
    callId: string,
    signal: AbortSignal,
    phase: PluginAction["phase"],
    inlineMs?: number
  ): Promise<PluginOperationOutcome> {
    const entry = this.operation(invocation, capability)
    this.authorize(invocation, entry)
    for (const action of entry.operation.actions) {
      invocation.services.authorize(action)
    }
    let handler = entry.operation.id
    if (phase === "reconcile") {
      handler = entry.operation.poll ?? ""
    }
    if (phase === "recover") {
      handler = entry.operation.recover ?? ""
    }
    if (phase === "poll") {
      handler = entry.operation.poll ?? ""
    }
    if (phase === "cancel") {
      handler = entry.operation.cancel ?? ""
    }
    if (!handler) {
      throw new Error("插件没有声明 " + phase + " 处理器")
    }
    const result = await this.invoke(
      invocation,
      entry,
      { kind: "operation", handler, operation: entry.operation.id, phase },
      input,
      callId,
      signal,
      entry.operation.grants,
      Math.max(
        1,
        Math.min(
          inlineMs ?? serviceOperationBudget(invocation.config, entry) ?? entry.operation.timeoutMs,
          (invocation.deadlineAt ?? Infinity) - Date.now()
        )
      )
    )
    this.authorize(invocation, entry)
    for (const action of entry.operation.actions) {
      invocation.services.authorize(action)
    }
    return PluginOperationOutcomeSchema.parse(result)
  }

  async parse(
    invocation: PluginInvocation,
    entry: PluginOperationEntry,
    parser: string,
    text: string,
    callId: string,
    signal: AbortSignal
  ) {
    return PluginArgumentsSchema.parse(
      await this.invoke(
        invocation,
        entry,
        { kind: "parser", handler: parser, operation: entry.operation.id, phase: "execute" },
        { text },
        callId,
        signal,
        [],
        entry.operation.timeoutMs
      )
    )
  }

  async hook(
    invocation: PluginInvocation,
    registry: PluginRegistry,
    handler: OrderedHook,
    input: unknown,
    callId: string,
    signal: AbortSignal
  ) {
    if (["collect", "policy", "transform"].includes(handler.hook.mode)) {
      invocation = { ...invocation, readOnly: true }
    }
    const binding = registry.bindings.get(handler.instanceId)
    if (!binding || binding.bundle.revision !== handler.generation) {
      throw new Error("处理器与固定插件版本不匹配")
    }
    const entry = { ...binding, capabilityId: pluginHookId(handler.instanceId, handler.hook.id) }
    const grants = handler.hook.grants.filter((grant) => {
      if (grant === "delivery.send") {
        return false
      }
      if (grant === "artifact.write" && handler.hook.mode !== "select") {
        return false
      }
      return true
    })
    const result = await this.invoke(
      invocation,
      entry,
      { kind: "hook", handler: handler.hook.id, phase: "execute" },
      input,
      callId,
      signal,
      grants,
      handler.hook.timeoutMs
    )
    this.authorize(invocation, entry)
    return result
  }

  private async invoke(
    invocation: PluginInvocation,
    entry: PluginCapabilityEntry,
    action: PluginAction,
    input: unknown,
    callId: string,
    parentSignal: AbortSignal,
    declared: readonly string[],
    timeoutMs: number
  ): Promise<unknown> {
    const operation = entry.bundle.manifest.operations.find((operation) => {
      return (action.kind === "operation" || action.kind === "parser") && operation.id === action.operation
    })
    invocation = {
      ...invocation,
      services: {
        ...invocation.services,
        mediaSources: invocation.services.mediaSources ?? new Set<string>()
      }
    }
    const current = this.authorize(invocation, entry)
    const grants = declared.filter((grant) => {
      return current.grants.includes(grant) && entry.instance.grants.includes(grant)
    })
    const serviceRevisions = new Map(
      Object.entries(entry.instance.services).map(([alias, id]) => {
        const service = namedService(invocation.config, id)
        if (!service) {
          return [alias, ""]
        }
        return [alias, serviceRevision(service)]
      })
    )
    const context = pluginInvocationView(invocation, entry, input, grants, timeoutMs, callId)
    context.limits = { backgroundStatelessConcurrency: Math.max(0, this.manager.config.maxWorkers - 1) }
    const controller = new AbortController()
    const controllers = this.active.get(invocation.room.id) ?? new Set<AbortController>()
    controllers.add(controller)
    this.owners.set(controller, entry.instance.id)
    this.active.set(invocation.room.id, controllers)
    const signal = AbortSignal.any([parentSignal, controller.signal])
    const authorizeGrant = (grant: string) => {
      if (!grants.includes(grant)) {
        throw new Error("此处理器未声明或未获准使用该宿主能力")
      }
      const current = this.authorize(invocation, entry)
      if (!current.grants.includes(grant)) {
        throw new Error("插件宿主服务授权已撤销")
      }
      if (grant.startsWith("service:")) {
        const alias = grant.slice(8)
        const id = entry.instance.services[alias]
        const saved = namedService(invocation.config, id)
        const now = namedService(this.configuration(), id)
        if (
          !id ||
          current.services[alias] !== id ||
          !saved?.enabled ||
          !now?.enabled ||
          serviceRevisions.get(alias) !== serviceRevision(now)
        ) {
          throw new Error("插件具名服务绑定已撤销或变更")
        }
      }
      if (grant.startsWith("connector:")) {
        const alias = grant.slice("connector:".length)
        if (!entry.instance.connectors[alias] || current.connectors[alias] !== entry.instance.connectors[alias]) {
          throw new Error("插件连接器映射已撤销或变更")
        }
      }
    }
    const services = pluginHostServices(
      invocation,
      entry,
      callId,
      authorizeGrant,
      {
        grants: declared,
        invoke: async (grant, input, signal) => {
          if (invocation.readOnly) {
            throw new Error("只读切入点不能启动插件操作")
          }
          authorizeGrant(grant)
          const [alias, operation] = grant.slice("operation:".length).split("/")
          const target = entry.instance.dependencies[alias]
          const current = this.authorize(invocation, entry)
          if (!target || current.dependencies[alias] !== target) {
            throw new Error("插件操作没有显式依赖映射或映射已变化")
          }
          return this.execute(
            {
              ...invocation,
              services: {
                ...invocation.services,
                authorize: (capability) => {
                  const current = this.authorize(invocation, entry)
                  if (!current.grants.includes(grant) || current.dependencies[alias] !== target) {
                    throw new Error("插件操作依赖授权已撤销")
                  }
                  invocation.services.authorize(capability)
                }
              }
            },
            pluginOperationId(target, operation),
            input.arguments,
            callId + ":" + grant,
            signal,
            input.phase
          )
        }
      },
      (path) => {
        if (operation?.data === "none") {
          throw new Error("无数据操作不能发布私有文件")
        }
        return this.manager.openDataFile(entry.instance.id, entry.bundle.revision, invocation.room.id, path)
      },
      async (grant, value, sequence, signal) => {
        authorizeGrant(grant)
        const result = await executePluginPoint(
          this,
          invocation,
          entry,
          grant.slice("point:".length),
          value,
          callId + ":" + sequence,
          signal
        )
        authorizeGrant(grant)
        return result
      },
      this.managed,
      action.phase
    )
    const host = services.bind(entry, context, declared, authorizeGrant)
    const parent = this.calls.getStore()
    const chain = parent?.chain ?? []
    let execution: PluginCallScope["execution"] = "foreground"
    const observer = entry.bundle.manifest.hooks.some((hook) => {
      return action.kind === "hook" && hook.id === action.handler && hook.mode === "observe"
    })
    if (
      parent?.execution === "background" ||
      invocation.input.context.jobId ||
      (action.kind === "operation" && operation?.execution === "background") ||
      observer
    ) {
      execution = "background"
    }
    let mode: "plugin" | "stateless" = "plugin"
    if (operation?.data === "none") {
      mode = "stateless"
    }
    const nested: PluginCallScope = {
      chain: [...chain, workerScopeKey(entry.instance.id, entry.bundle.revision, invocation.room.id, mode, execution)],
      execution
    }
    try {
      const result = await this.manager.invoke(
        entry,
        action,
        context,
        input,
        signal,
        (method, params, signal) => {
          return this.calls.run(nested, () => {
            return host(method, params, signal)
          })
        },
        chain,
        () => {
          this.authorize(invocation, entry)
        },
        mode,
        execution
      )
      signal.throwIfAborted()
      services.validateResult()
      return result
    } catch (error) {
      const message = redactPluginError(error, context.settings)
      if (error instanceof PluginInvocationError) {
        throw new PluginInvocationError({ ...error.failure, message })
      }
      throw new Error(message)
    } finally {
      controllers.delete(controller)
      this.owners.delete(controller)
      if (controllers.size === 0) {
        this.active.delete(invocation.room.id)
      }
    }
  }

  cancelScope(roomId: string) {
    for (const controller of this.active.get(roomId) ?? []) {
      controller.abort(new Error("插件调用已停止"))
    }
  }
}

function redactPluginError(error: unknown, settings: PluginBinding["instance"]["settings"]) {
  let text = String(error)
  function redact(value: unknown) {
    if (typeof value === "string" && value.length > 0) {
      text = text.replaceAll(value, "[plugin-setting]")
    } else if (Array.isArray(value)) {
      for (const item of value) {
        redact(item)
      }
    } else if (value !== null && typeof value === "object") {
      for (const item of Object.values(value)) {
        redact(item)
      }
    }
  }
  redact(settings)
  return text.slice(0, 2000)
}
