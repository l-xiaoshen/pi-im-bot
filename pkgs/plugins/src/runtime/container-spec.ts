import { createHash } from 'node:crypto'
import type { PluginBinding } from '../registry'
import type { PluginContainerSpec } from './docker'
import type { PluginRuntimeConfig } from './config'

export function workerScopeKey(
  instance: string,
  generation: string,
  roomId: string,
  mode: 'plugin' | 'validator' | 'stateless' = 'plugin',
  execution: 'foreground' | 'background' = 'foreground'
) {
  let scope = roomId
  if (mode !== 'plugin') {
    scope += ':' + mode
  }
  if (mode === 'stateless') {
    scope += ':' + execution
  }
  return createHash('sha256')
    .update(JSON.stringify([instance, generation, scope]))
    .digest('hex')
    .slice(0, 20)
}
export function pluginContainerSpec(input: {
  owner: string
  key: string
  binding: PluginBinding
  image: string
  config: PluginRuntimeConfig
  packagePath: string
  dataPath: string
  rpcPath: string
  runnerPath: string
  token: string
  mode?: 'plugin' | 'validator' | 'stateless'
}): PluginContainerSpec {
  const memory = input.config.memoryMiB * 1024 * 1024
  const spec: PluginContainerSpec = {
    Image: input.image,
    Cmd: ['bun', '--no-env-file', '--no-install', '/runner/worker.mjs'],
    Entrypoint: [],
    User: `${process.getuid?.() ?? 1000}:${process.getgid?.() ?? 1000}`,
    WorkingDir: '/tmp',
    Env: [
      'BOT_PLUGIN_RPC=/rpc/core.sock',
      'BOT_PLUGIN_TOKEN=' + input.token,
      'BOT_PLUGIN_ENTRY=/plugin/' + input.binding.bundle.manifest.entry,
      'BOT_PLUGIN_DATA=/data/files',
      'BOT_PLUGIN_MODE=' + (input.mode ?? 'plugin')
    ],
    Labels: {
      'io.pi-im.plugin-owner': input.owner,
      'io.pi-im.plugin-worker': input.key,
      'io.pi-im.plugin-instance': input.binding.instance.id,
      'io.pi-im.plugin-generation': input.binding.bundle.revision,
      'io.pi-im.plugin-mode': input.mode ?? 'plugin'
    },
    HostConfig: {
      NetworkMode: 'none',
      ReadonlyRootfs: true,
      Privileged: false,
      CapDrop: ['ALL'],
      SecurityOpt: ['no-new-privileges:true'],
      Init: true,
      Memory: memory,
      MemorySwap: memory,
      NanoCpus: Math.round(input.config.cpu * 1e9),
      PidsLimit: 64,
      Tmpfs: { '/tmp': 'rw,noexec,nosuid,size=67108864' },
      Mounts: [
        { Type: 'bind', Source: input.packagePath, Target: '/plugin', ReadOnly: true },
        {
          Type: 'bind',
          Source: input.dataPath,
          Target: '/data',
          ReadOnly: true,
          BindOptions: { ReadOnlyNonRecursive: true }
        },
        { Type: 'bind', Source: input.rpcPath, Target: '/rpc', ReadOnly: true },
        { Type: 'bind', Source: input.runnerPath, Target: '/runner', ReadOnly: true }
      ],
      LogConfig: { Type: 'json-file', Config: { 'max-size': '1m', 'max-file': '2' } }
    }
  }
  if (input.mode === 'validator' || input.mode === 'stateless') {
    spec.WorkingDir = '/tmp'
    spec.HostConfig.Memory = memory
    if (input.mode === 'validator') {
      spec.HostConfig.Memory = Math.min(memory, 128 * 1024 * 1024)
    }
    spec.HostConfig.MemorySwap = spec.HostConfig.Memory
    spec.HostConfig.Mounts = spec.HostConfig.Mounts.filter((mount) => {
      return mount.Target !== '/data'
    })
  }
  return spec
}
