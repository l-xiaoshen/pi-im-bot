import { z } from 'zod'
import { resolve, relative, isAbsolute, join } from 'node:path'
import { PluginStorageSchema } from '../storage/config'

export const PluginRuntimeSchema = z
  .object({
    enabled: z.boolean().default(false),
    socketPath: z.string().min(1).default('/var/run/docker.sock'),
    image: z.string().min(1).max(300).default('oven/bun:1.4.4'),
    packageDir: z.string().default('plugins'),
    dataDir: z.string().default('plugin-data'),
    runtimeDir: z.string().default('data/plugin-runtime'),
    hostPackageDir: z.string().optional(),
    hostDataDir: z.string().optional(),
    hostRuntimeDir: z.string().optional(),
    maxWorkers: z.number().int().min(1).max(32).default(4),
    maxValidators: z.number().int().min(1).max(4).default(1),
    maxPointHandlers: z.number().int().min(1).max(64).default(32),
    maxPointBytes: z
      .number()
      .int()
      .min(1024)
      .max(384000)
      .default(256 * 1024),
    maxPointMs: z.number().int().min(100).max(30000).default(10000),
    maxPending: z.number().int().min(0).max(1000).default(64),
    maxOutstandingJobs: z.number().int().min(1).max(256).default(8),
    maxPollFailures: z.number().int().min(1).max(20).default(3),
    maxPresentationMs: z.number().int().min(100).max(60000).default(15000),
    maxContextChars: z.number().int().min(0).max(32000).default(8000),
    maxHookConcurrency: z.number().int().min(1).max(16).default(4),
    maxObserverQueue: z.number().int().min(1).max(1000).default(64),
    maxObserverPerPlugin: z.number().int().min(1).max(100).default(8),
    maxObserverPendingPerPlugin: z.number().int().min(1).max(100).default(8),
    maxObserverActions: z.number().int().min(1).max(1000).default(128),
    maxObserverActionsPerPlugin: z.number().int().min(1).max(500).default(64),
    maxObserverMs: z.number().int().min(50).max(10000).default(1000),
    memoryMiB: z.number().int().min(64).max(4096).default(256),
    cpu: z.number().min(0.1).max(8).default(0.5),
    idleMs: z.number().int().min(1000).max(3600000).default(60000),
    startTimeoutMs: z.number().int().min(1000).max(120000).default(30000),
    maxRpcCalls: z.number().int().min(1).max(1000).default(256),
    storage: PluginStorageSchema
  })
  .prefault({})
export type PluginRuntimeConfig = z.infer<typeof PluginRuntimeSchema>

export function pluginPaths(projectDir: string, config: PluginRuntimeConfig) {
  const packageDir = resolve(projectDir, config.packageDir)
  const dataDir = resolve(projectDir, config.dataDir)
  const runtimeDir = resolve(projectDir, config.runtimeDir)
  return {
    packageDir,
    dataDir,
    runtimeDir,
    hostPackageDir: config.hostPackageDir ?? packageDir,
    hostDataDir: config.hostDataDir ?? dataDir,
    hostRuntimeDir: config.hostRuntimeDir ?? runtimeDir
  }
}
export type PluginPaths = ReturnType<typeof pluginPaths>
export function hostPluginPath(localRoot: string, hostRoot: string, path: string) {
  const suffix = relative(localRoot, path)
  if (isAbsolute(suffix) || suffix === '..' || suffix.startsWith('../')) {
    throw new Error('插件挂载路径越界')
  }
  return join(hostRoot, suffix)
}
