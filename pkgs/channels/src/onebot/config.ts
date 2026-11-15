import { z } from "zod"
import type { Address } from "@pi-im-bot/contracts/message"
import { MediaOriginsSchema } from "./media"

export const QQIdSchema = z.string().regex(/^\d{1,20}$/u, "请输入数字 QQ 号或群号")
export const OneBotTargetSchema = z.object({
  selfId: QQIdSchema,
  chatId: QQIdSchema,
  name: z.string().trim().min(1).max(100),
  enabled: z.boolean()
})
export const OneBotTargetsSchema = z
  .array(OneBotTargetSchema)
  .max(200)
  .refine((targets) => {
    return new Set(targets.map(targetKey)).size === targets.length
  }, "同一机器人和群号不能重复配置")
export const OneBotConfigSchema = z
  .object({
    enabled: z.boolean().default(true),
    path: z.string().startsWith("/").default("/onebot/v11/ws"),
    accessToken: z.string().max(4096).default(""),
    targets: OneBotTargetsSchema.default([]),
    commandPrefix: z.string().trim().min(1).max(32).default("!pi"),
    allowPrivate: z.boolean().default(false),
    mediaOrigins: MediaOriginsSchema.default([])
  })
  .prefault({})
export type OneBotConfig = z.infer<typeof OneBotConfigSchema>
export type OneBotTarget = z.infer<typeof OneBotTargetSchema>

export function targetKey(target: Pick<OneBotTarget, "selfId" | "chatId">) {
  return target.selfId + ":" + target.chatId
}

export function oneBotAllowed(config: Pick<OneBotConfig, "enabled" | "targets" | "allowPrivate">, address: Address) {
  if (!config.enabled) {
    return false
  }
  if (address.kind === "direct") {
    return config.allowPrivate
  }
  return config.targets.some((target) => {
    return target.enabled && target.selfId === address.accountId && target.chatId === address.chatId
  })
}
