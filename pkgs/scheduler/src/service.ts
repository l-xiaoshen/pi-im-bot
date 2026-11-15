import { Cron } from "croner"
import type { StateStore } from "@pi-im-bot/storage/state"
import type { Coordinator } from "@pi-im-bot/runtime/coordinator"
import { ScheduleSchema, ScheduleInputSchema, type ScheduleInput } from "./definition"
import type { Authority } from "@pi-im-bot/permissions/identity"
import { ScheduleOverlap } from "./occurrences"

export function nextOccurrence(expression: string, timezone: string, after = new Date()) {
  const cron = new Cron(expression, { timezone, paused: true })
  const next = cron.nextRun(after)
  cron.stop()
  return next?.getTime() ?? null
}

export class Scheduler {
  private timer?: ReturnType<typeof setInterval>
  private ticking?: Promise<void>
  constructor(
    private readonly store: Pick<StateStore, keyof StateStore>,
    private readonly coordinator: Coordinator
  ) {}

  start() {
    // Accepted occurrences recover through Jobs. Unadmitted missed ticks are skipped, never replayed in a burst.
    for (const schedule of this.store.listSchedules()) {
      if (schedule.enabled && (!schedule.nextRunAt || schedule.nextRunAt < Date.now())) {
        schedule.nextRunAt = nextOccurrence(schedule.cron, schedule.timezone)
        this.store.saveSchedule(schedule)
      }
    }
    this.timer = setInterval(() => {
      void this.tick().catch((error) => {
        console.warn("Schedule tick:", this.coordinator.publicError(error))
      })
    }, 1000)
  }

  save(input: ScheduleInput, authority: Authority) {
    const parsed = ScheduleInputSchema.parse(input)
    this.coordinator.requireRoom(parsed.roomId)
    if (this.store.listSchedules().length >= 200) {
      throw new Error("计划任务总数已达上限 200")
    }
    const schedule = ScheduleSchema.parse({
      ...parsed,
      authority: structuredClone(authority),
      id: crypto.randomUUID(),
      createdAt: Date.now(),
      nextRunAt: nextOccurrence(parsed.cron, parsed.timezone)
    })
    this.store.saveSchedule(schedule)
    this.changed()
    return schedule
  }

  private require(id: string) {
    const schedule = this.store.listSchedules().find((item) => {
      return item.id === id
    })
    if (!schedule) {
      throw new Error("计划任务不存在")
    }
    return schedule
  }

  async run(id: string, occurrence = "manual:" + crypto.randomUUID(), scheduledAt = Date.now()) {
    const schedule = this.require(id)
    if (!schedule.authority) {
      throw new Error("旧计划缺少触发来源，请在网页重新授权后运行")
    }
    try {
      const job = await this.coordinator.startSchedule(schedule, occurrence, scheduledAt)
      const current = this.store.listSchedules().find((item) => {
        return item.id === id
      })
      if (current) {
        this.store.saveSchedule({
          ...current,
          lastRunAt: Date.now(),
          lastTriggerAt: scheduledAt,
          lastJobId: job.id,
          lastOutcome: "accepted",
          lastError: undefined
        })
        this.changed()
      }
      return job
    } catch (error) {
      const current = this.store.listSchedules().find((item) => {
        return item.id === id
      })
      if (current) {
        let lastOutcome: "skipped" | "failed" = "failed"
        if (error instanceof ScheduleOverlap) {
          lastOutcome = "skipped"
        }
        this.store.saveSchedule({
          ...current,
          lastTriggerAt: scheduledAt,
          lastOutcome,
          lastError: this.coordinator.publicError(error)
        })
        this.changed()
      }
      throw error
    }
  }

  setEnabled(id: string, enabled: boolean, revision: number) {
    const current = this.require(id)
    if (current.revision !== revision) {
      throw new Error("计划配置已变化，请刷新后重试")
    }
    let nextRunAt: number | null = null
    if (enabled) {
      nextRunAt = nextOccurrence(current.cron, current.timezone)
    }
    const schedule = { ...current, enabled, nextRunAt, revision: current.revision + 1 }
    this.store.saveSchedule(schedule)
    this.changed()
    return schedule
  }

  async stopOccurrence(id: string) {
    const schedule = this.require(id)
    this.store.saveSchedule({ ...schedule, executionEpoch: schedule.executionEpoch + 1 })
    await this.coordinator.cancelSchedule(id)
    this.changed()
  }

  async remove(id: string) {
    this.require(id)
    // Disable admission before requesting cancellation; a concurrent timer may still be returning.
    const current = this.require(id)
    this.store.saveSchedule({
      ...current,
      enabled: false,
      nextRunAt: null,
      revision: current.revision + 1,
      executionEpoch: current.executionEpoch + 1
    })
    await this.coordinator.cancelSchedule(id)
    this.store.deleteSchedule(id)
    this.changed()
  }

  private changed() {
    this.coordinator.events.emit({ type: "schedules", schedules: this.store.listSchedules() })
  }

  tick(now = Date.now()) {
    if (this.ticking) {
      return this.ticking
    }
    this.ticking = this.runTick(now).finally(() => {
      this.ticking = undefined
    })
    return this.ticking
  }

  private async runTick(now: number) {
    for (const schedule of this.store.listSchedules()) {
      const due = schedule.nextRunAt
      if (!schedule.enabled || !schedule.authority || !due || due > now) {
        continue
      }
      try {
        await this.run(schedule.id, "cron:" + due, due)
      } catch (error) {
        if (!(error instanceof ScheduleOverlap)) {
          console.warn("Schedule admission:", this.coordinator.publicError(error))
        }
      }
      const current = this.store.listSchedules().find((item) => {
        return item.id === schedule.id
      })
      if (current?.enabled && current.nextRunAt === due) {
        this.store.saveSchedule({
          ...current,
          nextRunAt: nextOccurrence(current.cron, current.timezone, new Date(now))
        })
        this.changed()
      }
    }
  }

  async stop() {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = undefined
    }
    await this.ticking
  }
}
