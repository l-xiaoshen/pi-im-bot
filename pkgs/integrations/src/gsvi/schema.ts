import { z } from 'zod'
import { GsviCatalogueSchema } from './catalogue-contract'
import { pythonStrip } from './unicode'

export const ServiceIdSchema = z.string().regex(/^[a-z][a-z0-9_-]{0,31}$/u)
export const ServiceUrlSchema = z
  .url()
  .max(2048)
  .refine((input) => {
    const url = new URL(input)
    return (
      ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash
    )
  }, '服务地址必须是无凭据、查询和片段的 HTTP 地址')
// GSVI's source HttpUrl has no plugin-defined 2048-character truncation.
// Keep the shared ServiceUrlSchema unchanged for other managed services.
export const GsviUrlSchema = z.url().refine((value) => {
  return ['http:', 'https:'].includes(new URL(value).protocol)
}, 'GSVI地址必须使用HTTP或HTTPS')
const HeadersSchema = z
  .record(
    z.string().regex(/^[A-Za-z0-9-]{1,80}$/u),
    z
      .string()
      .max(4096)
      .refine((value) => {
        return !/[\r\n]/u.test(value)
      })
  )
  .refine((headers) => {
    const names = Object.keys(headers).map((name) => {
      return name.toLowerCase()
    })
    return new Set(names).size === names.length
  }, 'Header 名称不可重复（不区分大小写）')
  .refine((headers) => {
    return (
      Object.keys(headers).length <= 24 &&
      !Object.keys(headers).some((key) => {
        return [
          'host',
          'content-length',
          'connection',
          'cookie',
          'proxy-authorization',
          'transfer-encoding'
        ].includes(key.toLowerCase())
      })
    )
  }, '不支持该请求 Header')
export const GsviNativeHeadersSchema = z.record(
  z.string().regex(/^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/u),
  z.string().refine((value) => {
    return !/[\r\n]/u.test(value)
  })
)
export const GsviServiceSchema = z
  .object({
    id: ServiceIdSchema,
    name: z.string().min(1),
    kind: z.literal('gsvi'),
    enabled: z.boolean().default(false),
    url: GsviUrlSchema,
    headers: HeadersSchema.default({}),
    apiKey: z
      .string()
      .refine((value) => {
        return !/[\r\n]/u.test(value)
      })
      .optional(),
    nativeRequestHeaders: GsviNativeHeadersSchema.optional(),
    nativeDownloadHeaders: GsviNativeHeadersSchema.optional(),
    sourceCompatibleDownloads: z.boolean().optional(),
    downloadHeaders: HeadersSchema.default({}),
    downloadOrigins: z
      .array(
        ServiceUrlSchema.refine((value) => {
          return new URL(value).pathname === '/'
        }, '下载源只接受 origin')
      )
      .max(8)
      .default([]),
    timeoutMs: z.number().int().min(1000).default(180000),
    // Old persisted resource documents can still be opened. The transport uses
    // the shared Artifact budget, never this former GSVI-only limit.
    maxAudioBytes: z.number().int().positive().optional()
  })
  .strict()
export type GsviService = z.infer<typeof GsviServiceSchema>
export const GsviVersionSchema = z.enum(['v1', 'v2', 'v4'])
export const GsviModelsSchema = z.object({
  models: z.record(z.string(), z.record(z.string(), z.array(z.string())))
})
export const GsviInputSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('voices'), version: GsviVersionSchema.default('v4') }).strict(),
  z
    .object({
      action: z.literal('synthesize'),
      version: GsviVersionSchema.default('v4'),
      text: z.string().transform(pythonStrip).pipe(z.string().min(1)),
      voice: z.string().min(1),
      textLang: z.string().min(1).default('中文'),
      emotion: z.string().min(1).default('默认'),
      promptTextLang: z.string().default('')
    })
    .strict()
])
export type GsviInput = z.infer<typeof GsviInputSchema>
export const GsviResultSchema = z.discriminatedUnion('status', [
  GsviCatalogueSchema,
  z.object({ status: z.literal('voices'), models: GsviModelsSchema.shape.models }).strict(),
  z
    .object({
      status: z.literal('audio'),
      artifactId: z.uuid(),
      bytes: z.number().int().positive(),
      mimeType: z.literal('audio/wav')
    })
    .strict(),
  z
    .object({
      status: z.enum(['failed', 'unknown']),
      code: z.enum(['unavailable', 'protocol', 'budget', 'remote_unknown']),
      message: z.string().max(300)
    })
    .strict()
])
export type GsviResult = z.infer<typeof GsviResultSchema>
