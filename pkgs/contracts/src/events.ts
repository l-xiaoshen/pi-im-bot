import { z } from 'zod'
import { ChatMessageSchema, RoomSchema } from './message'
import { RunSchema, TraceSchema } from './run'
import { ScheduleSchema } from '@pi-im-bot/scheduler/definition'
import { OneBotStatusSchema } from '@pi-im-bot/channels/onebot/status'
import { JobSummarySchema } from '@pi-im-bot/jobs/schema'

export const AppEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('job'), job: JobSummarySchema }),
  z.object({
    type: z.literal('message'),
    message: ChatMessageSchema,
    removedIds: z.array(z.string()).optional()
  }),
  z.object({ type: z.literal('room'), room: RoomSchema }),
  z.object({ type: z.literal('run'), run: RunSchema }),
  z.object({ type: z.literal('trace'), trace: TraceSchema }),
  z.object({ type: z.literal('preview'), roomId: z.string(), runId: z.string(), text: z.string() }),
  z.object({ type: z.literal('schedules'), schedules: z.array(ScheduleSchema) }),
  z.object({ type: z.literal('onebot_status'), status: OneBotStatusSchema }),
  z.object({ type: z.literal('config') })
])
export type AppEvent = z.infer<typeof AppEventSchema>

export class EventHub {
  private readonly listeners = new Set<(event: AppEvent) => void>()

  emit(event: AppEvent) {
    for (const listener of this.listeners) {
      try {
        listener(event)
      } catch {
        this.listeners.delete(listener)
      }
    }
  }

  subscribe(listener: (event: AppEvent) => void) {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
}
