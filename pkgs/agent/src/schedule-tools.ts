import type { BotTool } from "@pi-im-bot/capabilities/tool"
import { z } from "zod"
import { obj, str, opt } from "@earendil-works/pi-schema"
import type { Schedule } from "@pi-im-bot/scheduler/definition"

const CreateScheduleSchema = z.object({
  name: z.string().min(1).max(100),
  cron: z.string().min(1),
  prompt: z.string().min(1).max(20000),
  timezone: z.string().default("Asia/Shanghai")
})
const RemoveScheduleSchema = z.object({ id: z.string() })

export interface ScheduleToolServices {
  create(input: z.infer<typeof CreateScheduleSchema>): Schedule
  list(): Schedule[]
  remove(id: string): Promise<void>
}

export function createScheduleTools(services: ScheduleToolServices): BotTool[] {
  return [
    {
      name: "schedule_create",
      label: "创建计划任务",
      description:
        "Create a persistent cron schedule that runs the agent with the given prompt and delivers to the current conversation. Each occurrence uses an isolated Pi session. Use a standard five-field cron expression and an IANA timezone.",
      parameters: obj({ name: str(), cron: str(), prompt: str(), timezone: opt(str()) }),
      async execute(_id, input, signal) {
        signal?.throwIfAborted()
        const schedule = services.create(CreateScheduleSchema.parse(input))
        return {
          content: [{ type: "text", text: JSON.stringify(scheduleView(schedule)) }],
          details: { id: schedule.id }
        }
      }
    },
    {
      name: "schedule_list",
      label: "查看计划任务",
      description: "List schedules belonging to the current IM conversation.",
      parameters: obj({}),
      async execute() {
        return {
          content: [{ type: "text", text: JSON.stringify(services.list().map(scheduleView)) }],
          details: {}
        }
      }
    },
    {
      name: "schedule_delete",
      label: "删除计划任务",
      description: "Delete a schedule from the current IM conversation by its ID.",
      parameters: obj({ id: str() }),
      async execute(_id, input, signal) {
        signal?.throwIfAborted()
        const { id } = RemoveScheduleSchema.parse(input)
        await services.remove(id)
        return { content: [{ type: "text", text: "Schedule deleted" }], details: { id } }
      }
    }
  ]
}

function scheduleView(schedule: Schedule) {
  const { authority: _authority, ...view } = schedule
  return view
}
