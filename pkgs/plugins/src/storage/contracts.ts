import { z } from 'zod'
import { PluginIdSchema } from '../manifest'

export const VolumeSchema = z
  .object({
    id: z.string().regex(/^[a-f0-9]{20}$/u),
    instanceId: PluginIdSchema,
    scopeKey: z.string().regex(/^[a-f0-9]{20}$/u),
    uuid: z.uuid(),
    bytes: z.number().int().positive(),
    state: z.enum(['creating', 'ready', 'quarantined']),
    createdAt: z.number(),
    lastUsedAt: z.number(),
    usedBytes: z.number().int().nonnegative().optional(),
    measuredAt: z.number().optional(),
    error: z.string().optional()
  })
  .strict()
export type PluginVolume = z.infer<typeof VolumeSchema>
export const VolumeCatalogSchema = z
  .object({ version: z.literal(1), volumes: z.array(VolumeSchema).max(4096) })
  .strict()
  .superRefine((value, context) => {
    const ids = value.volumes.map((volume) => {
      return volume.id
    })
    const paths = value.volumes.map((volume) => {
      return volume.instanceId + '/' + volume.scopeKey
    })
    if (new Set(ids).size !== ids.length || new Set(paths).size !== paths.length) {
      context.addIssue({ code: 'custom', message: '插件卷目录包含重复标识' })
    }
  })
export const StorageStatusSchema = z.object({
  reservedBytes: z.number(),
  totalBytes: z.number(),
  pluginBytes: z.number(),
  volumeBytes: z.number(),
  maxVolumes: z.number(),
  dependenciesReady: z.boolean(),
  volumes: z.array(VolumeSchema.extend({ mounted: z.boolean() }))
})
export type StorageStatus = z.infer<typeof StorageStatusSchema>

export interface PluginVolumeLease {
  path: string
  bindPath: string
  release(): Promise<void>
}
export interface PluginVolumes {
  prepare(): Promise<void>
  acquire(instance: string, scope: string, signal: AbortSignal): Promise<PluginVolumeLease>
  status(): Promise<StorageStatus>
  close(): Promise<void>
}
