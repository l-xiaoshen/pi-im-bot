import { obj, arr, str, opt } from "@earendil-works/pi-schema"
import type { BotTool } from "@pi-im-bot/capabilities/tool"
import type { HostToolServices } from "./host-tools"
import { SendMessageInputSchema, logicalMessages } from "@pi-im-bot/contracts/logical-message"
import { DeliverySuppressed } from "@pi-im-bot/contracts/presentation"
import { sendLogicalSequence } from "@pi-im-bot/runtime/logical-send"
export function chatSendTool(services: HostToolServices): BotTool {
  return {
    name: "chat_send",
    label: "发送消息",
    description:
      "Send an explicit extra notification to this conversation. Use text/artifactIds for one whole message, or messages for ordered complete logical messages separated by breaks. Each mixed-media group stays whole. Do not resend final replies or accepted/uncertain groups.",
    parameters: obj({
      text: opt(str()),
      artifactIds: opt(arr(str(), { maxItems: 8 })),
      messages: opt(arr(obj({ text: str(), artifactIds: opt(arr(str(), { maxItems: 8 })) })))
    }),
    async execute(id, input, signal) {
      signal?.throwIfAborted()
      const parsed = SendMessageInputSchema.parse(input)
      let lifetime: { signal: AbortSignal } | undefined
      if (signal) {
        lifetime = { signal }
      }
      if ("messages" in parsed) {
        const result = await sendLogicalSequence(
          logicalMessages(parsed),
          (part, index) => services.send(part.text, id + ":message:" + index, part.artifactIds, undefined, lifetime),
          () => {
            signal?.throwIfAborted()
            services.authorize("chat_send")
          }
        )
        const value = { delivered: result.complete && result.messages.length > 0, ...result }
        return { content: [{ type: "text", text: JSON.stringify(value) }], details: value }
      }
      try {
        const message = await services.send(parsed.text, id, parsed.artifactIds, undefined, lifetime)
        return {
          content: [{ type: "text", text: JSON.stringify({ delivered: true, messageId: message.id }) }],
          details: { messageId: message.id }
        }
      } catch (error) {
        if (!(error instanceof DeliverySuppressed)) {
          throw error
        }
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                delivered: false,
                suppressed: true,
                reason: error.message,
                instruction: "Delivery was suppressed by configuration. Do not retry it."
              })
            }
          ],
          details: { suppressed: true }
        }
      }
    }
  }
}
