import { ObservationWorker } from './worker'
import type { ObserverTaskInput, ObserverCheckpoint } from './task'
import { z } from 'zod'
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import { defineTask, defineExtension, type TaskId } from '@earendil-works/pi-durable'
import type { Coordinator } from '@pi-im-bot/runtime/coordinator'
import type { DurableAgentRuntime } from '@pi-im-bot/agent/durable/runtime'
import type { Configuration } from '@pi-im-bot/config/load'
import type { Room } from '@pi-im-bot/contracts/message'
import type { PreparedRunInput } from '@pi-im-bot/contracts/run'
import { pluginHookId } from '../identity'
import { ObserverIndex } from './documents'
import { ObservationSchema, ObserverStatusSchema, type Observation, type ObserverRecord } from './schema'
import type { PluginInvocation } from '../invocation'

export class PluginObservations {
  private readonly task
  private pumping?: Promise<void>
  private timer?: ReturnType<typeof setInterval>
  private opened = false
  private dropped = 0
  private lastError?: string
  private dirty = false

  constructor(
    private readonly coordinator: Coordinator,
    private readonly runtime: DurableAgentRuntime
  ) {
    const worker = new ObservationWorker(
      coordinator,
      runtime,
      (input, conversation) => {
        return this.admit(input, conversation)
      },
      () => {
        this.dirty = true
        this.wake()
      }
    )
    this.task = defineTask<ObserverTaskInput, ObserverCheckpoint, object>({
      name: 'bot.plugin-observer',
      version: 1,
      initial: () => ({ phase: 'run' }),
      phases: {
        run: worker.run.bind(worker),
        dispatched: async (task, runtime, context) => {
          await worker.finish(task, runtime, context, 'unknown', '服务在观察动作期间中断，未自动重放')
        }
      },
      abort: async (task, runtime, context) => {
        let state: ObserverRecord['state'] = 'cancelled'
        if (task.state.checkpoint.phase === 'dispatched') {
          state = 'unknown'
        }
        await worker.finish(task, runtime, context, state, '观察动作已停止')
      }
    })
    runtime.registry.install(defineExtension({ name: 'bot-plugin-observers', tasks: [this.task] }))
  }

  create(
    config: Configuration,
    room: Room,
    input: PreparedRunInput,
    point: Observation['point'],
    id: string,
    payload: unknown,
    origin: PluginInvocation['origin'] = input.source
  ) {
    if (!this.coordinator.plugins?.available()) {
      return undefined
    }
    const registry = config.resources.pluginRegistry(input.context.effective.settings)
    const raw = z.record(z.string(), z.json()).parse(JSON.parse(JSON.stringify(payload)))
    let phase: string | undefined
    if (typeof raw.phase === 'string') {
      phase = raw.phase
    }
    const pending = this.coordinator.store.listObservations(true)
    const handlers = registry
      .plan(point, { channel: room.address.channel, origin: origin ?? input.source, phase })
      .filter((entry) => {
        return input.context.authority.capabilities.includes(pluginHookId(entry.instanceId, entry.hook.id))
      })
      .filter((entry) => {
        const count = pending.filter((event) => {
          return event.handlers.some((key) => {
            return key.startsWith(entry.instanceId + '/')
          })
        }).length
        if (count >= config.bot.plugins.maxObserverPendingPerPlugin) {
          this.dropped += 1
          return false
        }
        return true
      })
      .map((entry) => {
        return entry.key
      })
    if (handlers.length === 0) {
      return undefined
    }
    if (this.coordinator.store.observationCount() >= config.bot.plugins.maxObserverQueue) {
      this.dropped += 1
      return undefined
    }
    const event = ObservationSchema.parse({
      id: point + ':' + id,
      roomId: room.id,
      createdAt: Date.now(),
      deadlineAt: Date.now() + 60000,
      point,
      origin,
      configSnapshot: this.coordinator.snapshotConfiguration(config),
      mode: room.mode,
      input,
      payload: raw,
      handlers: handlers.slice(0, 64)
    })
    const encoded = JSON.stringify(event)
    if (Buffer.byteLength(encoded, 'utf8') > 256 * 1024) {
      this.dropped += 1
      return undefined
    }
    return ObservationSchema.parse(JSON.parse(encoded))
  }

  start() {
    this.opened = true
    this.dirty = Boolean(this.coordinator.plugins?.available())
    this.timer = setInterval(() => {
      this.wake()
    }, 250)
    this.wake()
  }
  close() {
    this.opened = false
    if (this.timer) {
      clearInterval(this.timer)
    }
  }
  wake() {
    if (!this.opened || this.pumping) {
      return
    }
    this.pumping = this.pump()
      .catch(() => {})
      .finally(() => {
        this.pumping = undefined
      })
  }

  private async pump() {
    const events = this.coordinator.store.listObservations()
    if (events.length === 0 && !this.dirty) {
      return
    }
    this.dirty = false
    let failed = false
    for (const event of events) {
      if (!this.opened) {
        return
      }
      if (event.deadlineAt <= Date.now()) {
        this.dropped += 1
        this.coordinator.store.deleteObservation(event.id)
        continue
      }
      try {
        const room = { ...this.coordinator.requireRoom(event.roomId), mode: event.mode }
        const conversation = await this.runtime.ensureConversation(room, event.input)
        let complete = true
        for (const handler of event.handlers) {
          const accepted = await this.admit({ event, handler, key: event.id + ':' + handler }, conversation)
          if (!accepted) {
            complete = false
          }
        }
        if (complete) {
          this.coordinator.store.deleteObservation(event.id)
        }
      } catch (error) {
        failed = true
        this.lastError = this.coordinator.publicError(error)
        // Preserve the outbox until its deadline, while letting other events proceed.
        continue
      }
    }
    await this.runtime.native.commit(async (tx) => {
      const index = await tx.doc(ObserverIndex)
      const busy = new Set(
        Object.values(index.requests)
          .filter((record) => {
            return ['queued', 'running'].includes(record.state)
          })
          .map((record) => {
            return record.eventId
          })
      )
      for (const [key, record] of Object.entries(index.requests)) {
        if (!busy.has(record.eventId) && !this.coordinator.store.hasObservation(record.eventId)) {
          delete index.requests[key]
        }
      }
    }, BACKGROUND_CONTEXT)
    if (!failed) {
      this.lastError = undefined
    }
  }

  private async admit(
    input: ObserverTaskInput,
    conversation: Awaited<ReturnType<DurableAgentRuntime['ensureConversation']>>
  ) {
    return this.runtime.native.commit(async (tx) => {
      const index = await tx.doc(ObserverIndex)
      if (index.requests[input.key]) {
        return index.requests[input.key].taskId
      }
      const maximum = this.coordinator.plugins?.manager.config.maxObserverQueue ?? 64
      const active = Object.values(index.requests).filter((record) => {
        return ['queued', 'running'].includes(record.state)
      })
      const instance = input.handler.split('/')[0]
      const perPlugin = this.coordinator.plugins?.manager.config.maxObserverPerPlugin ?? 8
      let candidates = active.filter((record) => {
        return record.dueAt === undefined
      })
      let totalLimit = maximum
      let instanceLimit = perPlugin
      if (input.recall) {
        candidates = active.filter((record) => {
          return record.dueAt !== undefined
        })
        totalLimit = this.coordinator.plugins?.manager.config.maxObserverActions ?? 128
        instanceLimit = this.coordinator.plugins?.manager.config.maxObserverActionsPerPlugin ?? 64
      }
      if (
        candidates.length >= totalLimit ||
        candidates.filter((record) => {
          return record.handler.startsWith(instance + '/')
        }).length >= instanceLimit
      ) {
        return undefined
      }
      const taskId = await tx.createTask(this.task, input, {
        conversationId: conversation,
        ownership: { kind: 'conversation' },
        background: true
      })
      const record: ObserverRecord = {
        key: input.key,
        taskId,
        eventId: input.event.id,
        roomId: input.event.roomId,
        handler: input.handler,
        state: 'queued',
        at: Date.now()
      }
      if (input.recall) {
        record.dueAt = input.recall.dueAt
      }
      index.requests[input.key] = record
      return taskId
    }, BACKGROUND_CONTEXT)
  }

  async status() {
    const index = await this.runtime.native.snapshot(ObserverIndex, BACKGROUND_CONTEXT)
    return ObserverStatusSchema.parse({
      enabled: Boolean(this.coordinator.plugins?.available()),
      outbox: this.coordinator.store.observationCount(),
      dropped: this.dropped,
      lastError: this.lastError,
      active: Object.values(index?.requests ?? {}).filter((record) => {
        return ['queued', 'running'].includes(record.state)
      }),
      recent: index?.recent ?? []
    })
  }
  async cancel(id: number) {
    const index = await this.runtime.native.snapshot(ObserverIndex, BACKGROUND_CONTEXT)
    if (
      !Object.values(index?.requests ?? {}).some((record) => {
        return record.taskId === id && ['queued', 'running'].includes(record.state)
      })
    ) {
      throw new Error('观察动作不存在或已结束')
    }
    await this.runtime.native.abortTask(id as TaskId, BACKGROUND_CONTEXT)
    return this.status()
  }
}
