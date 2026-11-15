import { z } from 'zod'

export const ArtifactLimitsSchema = z
  .object({
    maxFileBytes: z
      .number()
      .int()
      .min(1024)
      .max(2147483648)
      .default(256 * 1024 * 1024),
    maxScopeBytes: z
      .number()
      .int()
      .min(1024)
      .max(1099511627776)
      .default(1024 * 1024 * 1024),
    maxTotalBytes: z
      .number()
      .int()
      .min(1024)
      .max(1099511627776)
      .default(8 * 1024 * 1024 * 1024),
    maxProducerBytes: z
      .number()
      .int()
      .min(1024)
      .max(1099511627776)
      .default(2 * 1024 * 1024 * 1024),
    maxScopeItems: z.number().int().min(1).max(100000).default(512),
    maxTotalItems: z.number().int().min(1).max(1000000).default(4096),
    maxProducerItems: z.number().int().min(1).max(1000000).default(1024),
    maxPending: z.number().int().min(1).max(100).default(8)
  })
  .superRefine((value, context) => {
    if (
      value.maxFileBytes > value.maxScopeBytes ||
      value.maxScopeBytes > value.maxTotalBytes ||
      value.maxFileBytes > value.maxProducerBytes ||
      value.maxProducerBytes > value.maxTotalBytes ||
      value.maxScopeItems > value.maxTotalItems ||
      value.maxProducerItems > value.maxTotalItems
    ) {
      context.addIssue({
        code: 'custom',
        message: '产物额度须满足单文件 ≤ 会话/生产者 ≤ 全局，数量额度也不得超过全局'
      })
    }
  })
  .prefault({})
export type ArtifactLimits = z.infer<typeof ArtifactLimitsSchema>
export const ArtifactUsageSchema = z.object({
  limits: ArtifactLimitsSchema,
  bytes: z.number(),
  items: z.number(),
  pending: z.number()
})
