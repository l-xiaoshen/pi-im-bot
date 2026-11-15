import { z } from "zod"
import { OneBotMessageSchema } from "./message"

/**
 * 消息段参数在 OneBot 11 数组格式中为字符串，但实现通常会将数字值序列化为数字。
 * 这里统一转换为字符串，以便与 CQ 码相互转换。
 */
export const OneBotSegmentParamSchema = z.union([z.string(), z.number()]).transform(String)
export type OneBotSegmentParam = z.infer<typeof OneBotSegmentParamSchema>

/**
 * 值为 `0`/`1` 的参数，也可以使用 `no`/`yes` 和 `false`/`true`。
 * 解析后的值始终为 `"0"` 或 `"1"`。
 */
export const OneBotFlagSchema = z
  .union([z.boolean(), z.literal(0), z.literal(1), z.enum(["0", "1", "no", "yes", "false", "true"])])
  .transform((value) => {
    if (typeof value === "boolean") {
      if (value) {
        return "1" as const
      }
      return "0" as const
    }
    if (value === 0 || value === "0" || value === "no" || value === "false") {
      return "0" as const
    }
    return "1" as const
  })
export type OneBotFlag = z.infer<typeof OneBotFlagSchema>

/** 纯文本。 */
export const OneBotTextSegmentSchema = z.object({
  type: z.literal("text"),
  data: z.object({ text: z.string() })
})

/** QQ 表情。 */
export const OneBotFaceSegmentSchema = z.object({
  type: z.literal("face"),
  data: z.object({ id: OneBotSegmentParamSchema })
})

/** 图片。 */
export const OneBotImageSegmentSchema = z.object({
  type: z.literal("image"),
  data: z.object({
    file: OneBotSegmentParamSchema,
    type: z.literal("flash").optional(),
    url: z.string().optional(),
    cache: OneBotFlagSchema.optional(),
    proxy: OneBotFlagSchema.optional(),
    timeout: OneBotSegmentParamSchema.optional()
  })
})

/** 语音。 */
export const OneBotRecordSegmentSchema = z.object({
  type: z.literal("record"),
  data: z.object({
    file: OneBotSegmentParamSchema,
    magic: OneBotFlagSchema.optional(),
    url: z.string().optional(),
    cache: OneBotFlagSchema.optional(),
    proxy: OneBotFlagSchema.optional(),
    timeout: OneBotSegmentParamSchema.optional()
  })
})

/** 短视频。 */
export const OneBotVideoSegmentSchema = z.object({
  type: z.literal("video"),
  data: z.object({
    file: OneBotSegmentParamSchema,
    url: z.string().optional(),
    cache: OneBotFlagSchema.optional(),
    proxy: OneBotFlagSchema.optional(),
    timeout: OneBotSegmentParamSchema.optional()
  })
})

/** @某人。 */
export const OneBotAtSegmentSchema = z.object({
  type: z.literal("at"),
  data: z.object({ qq: OneBotSegmentParamSchema })
})

/** 猜拳魔法表情。 */
export const OneBotRpsSegmentSchema = z.object({
  type: z.literal("rps"),
  data: z.object({}).nullish()
})

/** 掷骰子魔法表情。 */
export const OneBotDiceSegmentSchema = z.object({
  type: z.literal("dice"),
  data: z.object({}).nullish()
})

/** 窗口抖动（戳一戳）。 */
export const OneBotShakeSegmentSchema = z.object({
  type: z.literal("shake"),
  data: z.object({}).nullish()
})

/** 戳一戳。 */
export const OneBotPokeSegmentSchema = z.object({
  type: z.literal("poke"),
  data: z.object({
    type: OneBotSegmentParamSchema,
    id: OneBotSegmentParamSchema,
    name: z.string().optional()
  })
})

/** 匿名发消息。 */
export const OneBotAnonymousSegmentSchema = z.object({
  type: z.literal("anonymous"),
  data: z.object({ ignore: OneBotFlagSchema.optional() }).nullish()
})

/** 链接分享。 */
export const OneBotShareSegmentSchema = z.object({
  type: z.literal("share"),
  data: z.object({
    url: z.string(),
    title: z.string(),
    content: z.string().optional(),
    image: z.string().optional()
  })
})

/** 推荐好友或推荐群。 */
export const OneBotContactSegmentSchema = z.object({
  type: z.literal("contact"),
  data: z.object({
    type: z.enum(["qq", "group"]),
    id: OneBotSegmentParamSchema
  })
})

/** 位置。 */
export const OneBotLocationSegmentSchema = z.object({
  type: z.literal("location"),
  data: z.object({
    lat: OneBotSegmentParamSchema,
    lon: OneBotSegmentParamSchema,
    title: z.string().optional(),
    content: z.string().optional()
  })
})

/** 音乐分享。 */
export const OneBotMusicSegmentSchema = z.object({
  type: z.literal("music"),
  data: z.union([
    z.object({
      type: z.enum(["qq", "163", "xm"]),
      id: OneBotSegmentParamSchema
    }),
    z.object({
      type: z.literal("custom"),
      url: z.string(),
      audio: z.string(),
      title: z.string(),
      content: z.string().optional(),
      image: z.string().optional()
    })
  ])
})

/** 回复。 */
export const OneBotReplySegmentSchema = z.object({
  type: z.literal("reply"),
  data: z.object({ id: OneBotSegmentParamSchema })
})

/** 合并转发。 */
export const OneBotForwardSegmentSchema = z.object({
  type: z.literal("forward"),
  data: z.object({ id: OneBotSegmentParamSchema })
})

/** 合并转发节点。 */
export const OneBotNodeIdSegmentSchema = z.object({
  type: z.literal("node"),
  data: z.object({ id: OneBotSegmentParamSchema })
})

/** 合并转发自定义节点。 */
export const OneBotNodeCustomSegmentSchema = z.object({
  type: z.literal("node"),
  data: z.object({
    user_id: OneBotSegmentParamSchema,
    nickname: z.string(),
    content: z.lazy(() => OneBotMessageSchema)
  })
})

export const OneBotNodeSegmentSchema = z.union([OneBotNodeIdSegmentSchema, OneBotNodeCustomSegmentSchema])

/** XML 消息。 */
export const OneBotXmlSegmentSchema = z.object({
  type: z.literal("xml"),
  data: z.object({ data: z.string() })
})

/** JSON 消息。 */
export const OneBotJsonSegmentSchema = z.object({
  type: z.literal("json"),
  data: z.object({ data: z.string() })
})

const OneBotTypedSegmentSchema = z.discriminatedUnion("type", [
  OneBotTextSegmentSchema,
  OneBotFaceSegmentSchema,
  OneBotImageSegmentSchema,
  OneBotRecordSegmentSchema,
  OneBotVideoSegmentSchema,
  OneBotAtSegmentSchema,
  OneBotRpsSegmentSchema,
  OneBotDiceSegmentSchema,
  OneBotShakeSegmentSchema,
  OneBotPokeSegmentSchema,
  OneBotAnonymousSegmentSchema,
  OneBotShareSegmentSchema,
  OneBotContactSegmentSchema,
  OneBotLocationSegmentSchema,
  OneBotMusicSegmentSchema,
  OneBotReplySegmentSchema,
  OneBotForwardSegmentSchema,
  OneBotXmlSegmentSchema,
  OneBotJsonSegmentSchema
])

export const OneBotSegmentSchema = z.union([OneBotTypedSegmentSchema, OneBotNodeSegmentSchema])
export type OneBotSegment = z.infer<typeof OneBotSegmentSchema>
