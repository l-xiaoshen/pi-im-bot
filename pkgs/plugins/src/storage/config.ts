import { z } from 'zod'
import { isAbsolute } from 'node:path'

const ExecutableSchema = z.string().min(1).refine(isAbsolute, '文件系统工具必须为绝对路径')
export const PluginStorageSchema = z
  .object({
    volumeMiB: z.number().int().min(32).max(4096).default(64),
    pluginMiB: z.number().int().min(32).max(65536).default(1024),
    totalMiB: z.number().int().min(32).max(1048576).default(8192),
    maxVolumes: z.number().int().min(1).max(4096).default(128),
    formatCommand: ExecutableSchema.default('/usr/sbin/mke2fs'),
    checkCommand: ExecutableSchema.default('/usr/sbin/e2fsck'),
    mountCommand: ExecutableSchema.default('/usr/bin/fuse2fs'),
    unmountCommand: ExecutableSchema.default('/usr/bin/fusermount3'),
    timeoutMs: z.number().int().min(1000).max(60000).default(15000)
  })
  .superRefine((value, context) => {
    if (value.volumeMiB > value.pluginMiB || value.pluginMiB > value.totalMiB) {
      context.addIssue({ code: 'custom', message: '插件存储额度须满足 volumeMiB ≤ pluginMiB ≤ totalMiB' })
    }
  })
  .prefault({})
export type PluginStorageConfig = z.infer<typeof PluginStorageSchema>
