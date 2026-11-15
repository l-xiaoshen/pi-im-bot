import type { AgentMessage } from "@earendil-works/pi-agent-core"
import type { BotTool } from "@pi-im-bot/capabilities/tool"
import { z } from "zod"
import { obj, int, str, opt, arr } from "@earendil-works/pi-schema"
import type { ChatMessage } from "@pi-im-bot/contracts/message"
import type { projectHistory } from "@pi-im-bot/messages/projection"
import { createJobTools, type JobToolServices } from "@pi-im-bot/jobs/tools"
import { createScheduleTools, type ScheduleToolServices } from "./schedule-tools"
import type { Message } from "@earendil-works/pi-ai"
import type { MediaToolServices } from "@pi-im-bot/media/tool"
import type { PluginService } from "@pi-im-bot/plugins/service"
import { chatSendTool } from "./chat-send"

export interface HostToolServices {
  mediaSources?: Set<string>
  plugins?: PluginService
  recall?(messageId: string, delayMs: number): Promise<{ taskId: number }>
  history(limit: number): ReturnType<typeof projectHistory>
  send(
    text: string,
    callId?: string,
    artifactIds?: string[],
    beforePart?: () => void,
    lifetime?: { signal: AbortSignal; deadlineAt?: number }
  ): Promise<ChatMessage>
  present?(
    text: string,
    callId: string,
    artifactIds: string[]
  ): Promise<{
    delivered: boolean
    messageId?: string
    jobId?: string
    admissionUnknown?: boolean
    outboundId?: string
  }>
  assertActive?(): void
  authorize(capability: string): void
  schedules?: ScheduleToolServices
  jobs?: JobToolServices
  media?: MediaToolServices
  projectModelHistory?<T extends AgentMessage>(messages: readonly T[]): Promise<T[]>
  projectContext?(messages: readonly Message[]): Promise<Message[]>
}

const HistoryInputSchema = z.object({ limit: z.number().int().min(1).max(100) })
const SendInputSchema = z
  .object({ text: z.string().max(20000), artifactIds: z.array(z.uuid()).max(8).default([]) })
  .refine((value) => {
    return value.text.length > 0 || value.artifactIds.length > 0
  }, "消息和产物不能同时为空")

export function createHostTools(services: HostToolServices): BotTool[] {
  const tools: BotTool[] = [
    {
      name: "chat_history",
      label: "会话历史",
      description: "Read recent messages from the current IM conversation. Use when earlier chat context is needed.",
      parameters: obj({ limit: int({ minimum: 1, maximum: 100 }) }),
      async execute(_id, input) {
        const { limit } = HistoryInputSchema.parse(input)
        const messages = services.history(limit)
        return {
          content: [{ type: "text", text: JSON.stringify(messages) }],
          details: { count: messages.length }
        }
      }
    },
    chatSendTool(services)
  ]
  if (services.present) {
    tools.push({
      name: "chat_present",
      label: "受管呈现消息",
      description:
        "Accept an explicit Agent notification for managed presentation. Returns delivered:true only after platform ACK, or delivered:false with an accepted render jobId. Do not resend accepted messages. Final replies are delivered automatically.",
      parameters: obj({ text: str(), artifactIds: opt(arr(str(), { maxItems: 8 })) }),
      async execute(id, input, signal) {
        signal?.throwIfAborted()
        const { text, artifactIds } = SendInputSchema.parse(input)
        const result = await services.present!(text, id, artifactIds)
        return { content: [{ type: "text", text: JSON.stringify(result) }], details: result }
      }
    })
  }
  if (services.schedules) {
    tools.push(...createScheduleTools(services.schedules))
  }
  if (services.jobs) {
    tools.push(...createJobTools(services.jobs))
  }
  return tools
}
