import { z } from 'zod'
import { ComfyOutputRefused } from './errors'
const FileSchema = z
  .object({
    filename: z.string().min(1).max(240),
    subfolder: z.string().max(240).default(''),
    type: z.literal('output')
  })
  .strict()
  .superRefine((file, context) => {
    for (const value of [file.filename, file.subfolder]) {
      if (
        value.startsWith('/') ||
        value.includes('\\') ||
        value.includes('\0') ||
        value.split('/').some((part) => {
          return part === '.' || part === '..'
        }) ||
        /[?:#%]/u.test(value)
      ) {
        context.addIssue({ code: 'custom', message: '输出路径不合法' })
      }
    }
    if (file.filename.includes('/')) {
      context.addIssue({ code: 'custom', message: '输出文件名不能含目录' })
    }
  })
const HistoryEntrySchema = z
  .object({
    outputs: z
      .record(z.string(), z.object({ images: z.array(FileSchema).max(16).optional() }).passthrough())
      .default({}),
    status: z.object({ status_str: z.string().optional(), completed: z.boolean().optional() }).optional()
  })
  .passthrough()
export const HistorySchema = z.record(z.string().max(128), HistoryEntrySchema)
export function outputFiles(history: unknown, promptId: string, nodes: readonly string[]) {
  const entry = HistorySchema.parse(history)[promptId]
  if (!entry) {
    return { status: 'running' as const, files: [] }
  }
  if (entry.status?.status_str === 'error') {
    return { status: 'failed' as const, files: [] }
  }
  if (entry.status?.completed === false) {
    return { status: 'running' as const, files: [] }
  }
  const files = nodes.flatMap((node) => {
    return entry.outputs[node]?.images ?? []
  })
  if (files.length > 16) {
    throw new ComfyOutputRefused('本任务输出数量超过16项')
  }
  if (files.length === 0) {
    return { status: 'failed' as const, files: [] }
  }
  return { status: 'succeeded' as const, files }
}
export function validateImage(bytes: Uint8Array, mimeType?: string) {
  const b = Buffer.from(bytes)
  let valid = false
  if (mimeType === 'image/png') {
    valid =
      b.length >= 24 &&
      b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
      b.readUInt32BE(16) > 0 &&
      b.readUInt32BE(20) > 0
  }
  if (mimeType === 'image/jpeg') {
    valid = b.length >= 4 && b[0] === 255 && b[1] === 216 && b.at(-2) === 255 && b.at(-1) === 217
  }
  if (mimeType === 'image/webp') {
    valid =
      b.length >= 16 && b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP'
  }
  if (!valid) {
    throw new ComfyOutputRefused('输出不是受支持的PNG/JPEG/WebP图像')
  }
}
