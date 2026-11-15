import { z } from "zod"
import { OneBotMessageSchema } from "./message"

/**
 * Message segment parameters are strings in the OneBot 11 array format, but
 * implementations commonly emit numbers for numeric values. Normalise both to
 * a string so segments can be converted to CQ codes without extra handling.
 */
export const OneBotSegmentParamSchema = z.union([z.string(), z.number()]).transform(String)
export type OneBotSegmentParam = z.infer<typeof OneBotSegmentParamSchema>

/**
 * Parameters documented as `0`/`1` also accept `no`/`yes` and `false`/`true`.
 * The parsed value is always `"0"` or `"1"`.
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

export const OneBotTextSegmentSchema = z.object({
  type: z.literal("text"),
  data: z.object({ text: z.string() })
})

export const OneBotFaceSegmentSchema = z.object({
  type: z.literal("face"),
  data: z.object({ id: OneBotSegmentParamSchema })
})

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

export const OneBotAtSegmentSchema = z.object({
  type: z.literal("at"),
  data: z.object({ qq: OneBotSegmentParamSchema })
})

export const OneBotRpsSegmentSchema = z.object({
  type: z.literal("rps"),
  data: z.object({}).nullish()
})

export const OneBotDiceSegmentSchema = z.object({
  type: z.literal("dice"),
  data: z.object({}).nullish()
})

export const OneBotShakeSegmentSchema = z.object({
  type: z.literal("shake"),
  data: z.object({}).nullish()
})

export const OneBotPokeSegmentSchema = z.object({
  type: z.literal("poke"),
  data: z.object({
    type: OneBotSegmentParamSchema,
    id: OneBotSegmentParamSchema,
    name: z.string().optional()
  })
})

export const OneBotAnonymousSegmentSchema = z.object({
  type: z.literal("anonymous"),
  data: z.object({ ignore: OneBotFlagSchema.optional() }).nullish()
})

export const OneBotShareSegmentSchema = z.object({
  type: z.literal("share"),
  data: z.object({
    url: z.string(),
    title: z.string(),
    content: z.string().optional(),
    image: z.string().optional()
  })
})

export const OneBotContactSegmentSchema = z.object({
  type: z.literal("contact"),
  data: z.object({
    type: z.enum(["qq", "group"]),
    id: OneBotSegmentParamSchema
  })
})

export const OneBotLocationSegmentSchema = z.object({
  type: z.literal("location"),
  data: z.object({
    lat: OneBotSegmentParamSchema,
    lon: OneBotSegmentParamSchema,
    title: z.string().optional(),
    content: z.string().optional()
  })
})

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

export const OneBotReplySegmentSchema = z.object({
  type: z.literal("reply"),
  data: z.object({ id: OneBotSegmentParamSchema })
})

export const OneBotForwardSegmentSchema = z.object({
  type: z.literal("forward"),
  data: z.object({ id: OneBotSegmentParamSchema })
})

export const OneBotNodeIdSegmentSchema = z.object({
  type: z.literal("node"),
  data: z.object({ id: OneBotSegmentParamSchema })
})

export const OneBotNodeCustomSegmentSchema = z.object({
  type: z.literal("node"),
  data: z.object({
    user_id: OneBotSegmentParamSchema,
    nickname: z.string(),
    content: z.lazy(() => OneBotMessageSchema)
  })
})

export const OneBotNodeSegmentSchema = z.union([OneBotNodeIdSegmentSchema, OneBotNodeCustomSegmentSchema])

export const OneBotXmlSegmentSchema = z.object({
  type: z.literal("xml"),
  data: z.object({ data: z.string() })
})

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
