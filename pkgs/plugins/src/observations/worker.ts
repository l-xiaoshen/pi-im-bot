import type { Context } from '@earendil-works/chord/context'
import type { Coordinator } from '@pi-im-bot/runtime/coordinator'
import type { DurableAgentRuntime } from '@pi-im-bot/agent/durable/runtime'
import { RunLimiter } from '@pi-im-bot/support/limiter'
import { projectHistory } from '@pi-im-bot/messages/projection'
import { pluginHookId } from '../identity'
import { ObserverIndex } from './documents'
import type { ObserverRecord } from './schema'
import type { ObserverTaskInput, ObserverTaskRuntime, ActiveObserver } from './task'

export class ObservationWorker {
  private readonly slots: RunLimiter
  private readonly actions = new RunLimiter(2)
  constructor(
    private readonly coordinator: Coordinator,
    private readonly runtime: DurableAgentRuntime,
    private readonly admit: (
      input: ObserverTaskInput,
      conversation: Awaited<ReturnType<DurableAgentRuntime['ensureConversation']>>
    ) => Promise<number | undefined>,
    private readonly wake: () => void
  ) {
    this.slots = new RunLimiter(Math.max(1, (coordinator.plugins?.manager.config.maxWorkers ?? 2) - 1))
  }

  async run(task: ActiveObserver, runtime: ObserverTaskRuntime, context: Context) {
    const { event, handler: key, recall } = task.input
    if (recall && recall.dueAt > Date.now()) {
      await runtime.sleepUntil(recall.dueAt, { phase: 'run' }, context)
      return
    }
    let slots = this.slots
    if (recall) {
      slots = this.actions
    }
    const release = await slots.acquire(runtime.signal)
    let dispatched = false
    try {
      if (event.deadlineAt <= Date.now()) {
        await this.finish(task, runtime, context, 'expired', '观察事件超过期限')
        return
      }
      const config = await this.coordinator.loadConfigurationSnapshot(event.configSnapshot)
      const room = { ...this.coordinator.requireRoom(event.roomId), mode: event.mode }
      const plugins = this.coordinator.plugins
      if (!plugins?.available()) {
        throw new Error('插件执行后端已关闭')
      }
      const registry = config.resources.pluginRegistry(event.input.context.effective.settings)
      const handler = (registry.handlers.get(event.point) ?? []).find((entry) => {
        return entry.key === key
      })
      if (!handler) {
        throw new Error('固定版本没有此观察处理器')
      }
      const authorize = (capability: string) => {
        this.coordinator.authorizeRetainedContext(room.id, room.mode, event.input.context, capability)
      }
      authorize(pluginHookId(handler.instanceId, handler.hook.id))
      let budget = plugins.manager.config.maxObserverMs
      if (recall) {
        budget = 30000
      }
      const signal = AbortSignal.any([
        runtime.signal,
        AbortSignal.timeout(Math.min(budget, Math.max(1, event.deadlineAt - Date.now())))
      ])
      await runtime.commit(async (tx) => {
        const index = await tx.doc(ObserverIndex)
        index.requests[task.input.key].state = 'running'
        return { status: 'running', checkpoint: { phase: 'dispatched' } }
      }, context)
      dispatched = true
      if (recall) {
        authorize('message_recall')
        await this.coordinator.delivery.recall(room, recall.messageId, () => {
          signal.throwIfAborted()
          authorize(pluginHookId(handler.instanceId, handler.hook.id))
          authorize('message_recall')
        })
      } else {
        const output = await plugins.withoutParentCall(() => {
          return plugins.hook(
            {
              config,
              room,
              input: event.input,
              origin: event.origin,
              services: {
                authorize,
                history: (limit) => {
                  return projectHistory(
                    this.coordinator.store.listMessages(room.id, limit),
                    event.input.context.effective.settings
                  )
                },
                async send() {
                  throw new Error('观察处理器不能发送消息')
                },
                recall: async (messageId, delayMs) => {
                  signal.throwIfAborted()
                  authorize('message_recall')
                  if (
                    event.point !== 'delivery.receipt@1' ||
                    event.payload.messageId !== messageId ||
                    event.payload.state !== 'sent'
                  ) {
                    throw new Error('观察处理器只能撤回本次已确认发送的消息')
                  }
                  const dueAt = Date.now() + delayMs
                  const child = {
                    event: { ...event, deadlineAt: dueAt + 30000 },
                    handler: key,
                    key: task.input.key + ':recall:' + messageId,
                    recall: { messageId, dueAt }
                  }
                  const native = await this.runtime.ensureConversation(config, room, event.input)
                  const taskId = await this.admit(child, native)
                  if (!taskId) {
                    throw new Error('观察动作队列已满')
                  }
                  return { taskId }
                }
              }
            },
            registry,
            {
              ...handler,
              hook: {
                ...handler.hook,
                timeoutMs: Math.min(handler.hook.timeoutMs, plugins.manager.config.maxObserverMs)
              }
            },
            event.payload,
            task.input.key,
            signal
          )
        })
        const point = registry.points.get(event.point)
        if (point?.owner && point.definition) {
          await plugins.validatePoint(
            {
              config,
              room,
              input: event.input,
              services: {
                authorize,
                history: () => {
                  return []
                },
                async send() {
                  throw new Error('观察不发送消息')
                }
              }
            },
            point.owner,
            point.definition.id,
            output,
            'output',
            signal
          )
        }
      }
      await this.finish(task, runtime, context, 'done')
    } catch (error) {
      if (runtime.signal.aborted) {
        throw error
      }
      let state: ObserverRecord['state'] = 'failed'
      if (dispatched) {
        state = 'unknown'
      }
      await this.finish(task, runtime, context, state, this.coordinator.publicError(error))
    } finally {
      release()
    }
  }

  async finish(
    task: ActiveObserver,
    runtime: ObserverTaskRuntime,
    context: Context,
    state: ObserverRecord['state'],
    error?: string
  ) {
    await runtime.commit(async (tx) => {
      const index = await tx.doc(ObserverIndex)
      const previous = index.requests[task.input.key]
      if (previous) {
        const record = { ...previous, state, at: Date.now() }
        if (error) {
          record.error = error
        }
        index.requests[task.input.key] = record
        index.recent = [
          ...index.recent.filter((item) => {
            return item.taskId !== task.id
          }),
          record
        ].slice(-40)
      }
      return { status: 'terminal', outcome: { status: 'completed', result: {} } }
    }, context)
    this.wake()
  }
}
