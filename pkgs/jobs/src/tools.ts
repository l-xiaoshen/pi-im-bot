import { z } from "zod"
import { obj, str, int, opt, arr, map, unknown as unknownSchema } from "@earendil-works/pi-schema"
import type { BotTool } from "@pi-im-bot/capabilities/tool"
import type { JobSpec, JobSummary } from "./schema"

const DelegateSchema = z.object({
  title: z.string().min(1).max(100),
  prompt: z.string().min(1).max(20000),
  sourceMessageIds: z.array(z.string()).optional()
})
const OperationSchema = z.object({
  title: z.string().min(1).max(100),
  capability: z.string().min(1),
  arguments: z.record(z.string(), z.json()),
  sourceMessageIds: z.array(z.string()).optional()
})
const TargetSchema = z.object({ id: z.uuid() })
const UpdateSchema = TargetSchema.extend({
  revision: z.number().int().positive(),
  instruction: z.string().min(1).max(20000)
})

export interface JobToolServices {
  start(title: string, spec: JobSpec, callId: string, sourceMessageIds?: string[]): Promise<JobSummary>
  list(): Promise<JobSummary[]>
  status(id: string): Promise<JobSummary>
  cancel(id: string): Promise<JobSummary>
  update(id: string, revision: number, instruction: string, callId: string): Promise<JobSummary>
  wait(id: string, signal?: AbortSignal): Promise<JobSummary>
  operation(
    title: string,
    capability: string,
    args: Extract<JobSpec, { kind: "tool" }>["arguments"],
    callId: string
  ): Promise<JobSummary>
}

function result(value: JobSummary | JobSummary[]) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value) }], details: {} }
}

export function createJobTools(services: JobToolServices): BotTool[] {
  return [
    {
      name: "delegate_task",
      label: "后台子 Agent",
      description:
        "Delegate a focused task to a persistent background agent with separate context and sandbox. Include needed media IDs and quoted facts in the prompt; the child does not copy the full root context. Use for multi-step research, files, analysis, or long tool chains. Returns acceptance immediately; the host delivers the result later. Do not wait in the root conversation. sourceMessageIds can link a subset of this batch but never increase authority.",
      parameters: obj({ title: str(), prompt: str(), sourceMessageIds: opt(arr(str())) }),
      async execute(callId, args) {
        const input = DelegateSchema.parse(args)
        return result(
          await services.start(input.title, { kind: "agent", prompt: input.prompt }, callId, input.sourceMessageIds)
        )
      }
    },
    {
      name: "start_job",
      label: "后台操作",
      description:
        "Run one authorized MCP tool, plugin operation or sandbox bash command in the background without another LLM. Use its stable capability ID (mcp:server/tool, plugin:instance/operation, or bash) and its normal arguments. The sandbox is separate from the root workspace. Returns queued/running acceptance, not a completed result.",
      parameters: obj({
        title: str(),
        capability: str(),
        arguments: map(unknownSchema()),
        sourceMessageIds: opt(arr(str()))
      }),
      async execute(callId, args) {
        const input = OperationSchema.parse(args)
        return result(
          await services.start(
            input.title,
            { kind: "tool", capability: input.capability, arguments: input.arguments },
            callId,
            input.sourceMessageIds
          )
        )
      }
    },
    {
      name: "job_list",
      label: "查看群任务",
      description: "List recent work in this shared chat scope, regardless of which member initiated it.",
      parameters: obj({}),
      async execute() {
        return result(await services.list())
      }
    },
    {
      name: "job_status",
      label: "查看任务结果",
      description: "Read the current revision, status and compact result of one job in this chat scope.",
      parameters: obj({ id: str() }),
      async execute(_id, args) {
        return result(await services.status(TargetSchema.parse(args).id))
      }
    },
    {
      name: "job_cancel",
      label: "停止指定任务",
      description:
        "Request cancellation of one job in the current scope. cancel_requested does not claim an external service has stopped.",
      parameters: obj({ id: str() }),
      async execute(_id, args) {
        return result(await services.cancel(TargetSchema.parse(args).id))
      }
    },
    {
      name: "job_update",
      label: "修订共享任务",
      description:
        "Revise an agent job using the current triggering identity and expected revision. Other authorized group members can contribute. Prior revisions are stopped and their late replies suppressed.",
      parameters: obj({ id: str(), revision: int({ minimum: 1 }), instruction: str() }),
      async execute(callId, args) {
        const input = UpdateSchema.parse(args)
        return result(await services.update(input.id, input.revision, input.instruction, callId))
      }
    },
    {
      name: "job_wait",
      label: "等待子任务",
      description:
        "For background agents only: wait for a child job result. Waiting uses no model request slot. The root should return to the group instead of waiting.",
      parameters: obj({ id: str() }),
      async execute(_id, args, signal) {
        return result(await services.wait(TargetSchema.parse(args).id, signal))
      }
    }
  ]
}
