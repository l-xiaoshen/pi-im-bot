import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { PluginInstanceSchema } from '@pi-im-bot/plugins/config'
import { PluginManifestSchema } from '@pi-im-bot/plugins/manifest'
import { importPlugin } from '@pi-im-bot/plugins/package'
import { PluginInvocationViewSchema } from '@pi-im-bot/plugins/rpc/protocol'
import { PluginWorkerManager } from '@pi-im-bot/plugins/runtime/manager'
import { PluginRuntimeSchema } from '@pi-im-bot/plugins/runtime/config'
import type { PluginContainerBackend, PluginContainerSpec } from '@pi-im-bot/plugins/runtime/docker'
import type { PluginBinding } from '@pi-im-bot/plugins/registry'
import type { PluginVolumes } from '@pi-im-bot/plugins/storage/contracts'
import { createHash } from 'node:crypto'

/** Only the authored fixture package is run on the host; this backend is never part of application configuration. */
export class FixturePluginBackend implements PluginContainerBackend {
  readonly specifications = new Map<string, PluginContainerSpec>()
  readonly stopped: string[] = []
  readonly stoppedWorker = Promise.withResolvers<void>()
  private readonly children = new Map<string, ReturnType<typeof Bun.spawn>>()
  async image() {
    return 'sha256:' + 'a'.repeat(64)
  }
  async owned() {
    return []
  }
  async create(name: string, spec: PluginContainerSpec) {
    this.specifications.set(name, spec)
    return name
  }
  async start(id: string) {
    const spec = this.specifications.get(id)!
    function mount(target: string) {
      return spec.HostConfig.Mounts.find((mount) => {
        return mount.Target === target
      })!.Source
    }
    const env: Record<string, string> = {}
    for (const item of spec.Env) {
      const split = item.indexOf('=')
      env[item.slice(0, split)] = item.slice(split + 1)
    }
    env.BOT_PLUGIN_RPC = mount('/rpc') + '/core.sock'
    env.BOT_PLUGIN_PACKAGE = mount('/plugin')
    env.BOT_PLUGIN_ENTRY = mount('/plugin') + env.BOT_PLUGIN_ENTRY.slice('/plugin'.length)
    let directory = spec.HostConfig.Mounts.find((mount) => {
      return mount.Target === '/data'
    })?.Source
    if (directory) {
      directory = join(directory, 'files')
    }
    if (!directory) {
      directory = join(mount('/rpc'), 'scratch')
      await mkdir(directory, { recursive: true })
    }
    env.BOT_PLUGIN_DATA = directory
    const child = Bun.spawn(
      [process.execPath, '--no-env-file', '--no-install', mount('/runner') + '/worker.mjs'],
      { cwd: directory, env, stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' }
    )
    this.children.set(id, child)
  }
  async destroy(id: string, name: string) {
    const child = this.children.get(id)
    if (child) {
      this.stopped.push(name)
      child.kill('SIGKILL')
      await child.exited
      this.children.delete(id)
      this.stoppedWorker.resolve()
    }
  }
}

export async function pluginFixture(options: z.input<typeof PluginRuntimeSchema> = {}) {
  const root = await mkdtemp('/tmp/pi-plugin-fixture-')
  const backend = new FixturePluginBackend()
  const config = PluginRuntimeSchema.parse({
    enabled: true,
    packageDir: 'packages',
    dataDir: 'private',
    runtimeDir: 'rpc',
    maxWorkers: 2,
    ...options
  })
  const volumes: PluginVolumes = {
    async prepare() {},
    async acquire(instance, scope, signal) {
      signal.throwIfAborted()
      const bindPath = join(
        root,
        'private',
        instance,
        createHash('sha256').update(scope).digest('hex').slice(0, 20)
      )
      const path = join(bindPath, 'files')
      await mkdir(path, { recursive: true, mode: 0o700 })
      return { path, bindPath, async release() {} }
    },
    async status() {
      return {
        reservedBytes: 0,
        totalBytes: 8192 * 1024 * 1024,
        pluginBytes: 1024 * 1024 * 1024,
        volumeBytes: 64 * 1024 * 1024,
        maxVolumes: 128,
        dependenciesReady: true,
        volumes: []
      }
    },
    async close() {}
  }
  const manager = new PluginWorkerManager(root, config, backend, root, volumes)
  await manager.start()
  async function register(
    id: string,
    source: string,
    manifest: Partial<z.input<typeof PluginManifestSchema>> = {}
  ): Promise<PluginBinding> {
    const directory = join(root, 'source', id)
    await mkdir(directory, { recursive: true })
    const definition = PluginManifestSchema.parse({
      apiVersion: 1,
      id,
      name: id,
      version: '1.0.0',
      description: 'Fixture',
      entry: 'main.mjs',
      files: ['main.mjs'],
      operations: [
        { id: 'echo', title: 'Echo', description: 'Echo', inputSchema: { type: 'object', properties: {} } }
      ],
      ...manifest
    })
    await Bun.write(join(directory, 'plugin.json'), JSON.stringify(definition))
    await Bun.write(join(directory, 'main.mjs'), source)
    const instance = PluginInstanceSchema.parse({ id, name: id, sourceDir: directory, enabled: true })
    const bundle = await importPlugin(instance, root, manager.paths.packageDir)
    return { instance, bundle }
  }
  function context(binding: PluginBinding, deadline = 5000) {
    return PluginInvocationViewSchema.parse({
      id: crypto.randomUUID(),
      instanceId: binding.instance.id,
      generation: binding.bundle.revision,
      scope: { id: 'room', address: { channel: 'mock', accountId: 'bot', kind: 'group', chatId: 'room' } },
      conversationId: 'conversation',
      conversationEpoch: 0,
      origin: 'tool',
      deadlineAt: Date.now() + deadline,
      actors: [{ id: 'alice', name: 'Alice', origin: 'local' }],
      settings: {},
      inputRevision: 'fixture',
      grants: []
    })
  }
  return {
    root,
    backend,
    volumes,
    manager,
    register,
    context,
    async close() {
      await manager.close()
      await rm(root, { recursive: true, force: true })
    }
  }
}
