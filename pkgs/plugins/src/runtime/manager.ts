import { mkdir, chmod, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { RunLimiter } from '@pi-im-bot/support/limiter'
import { deadlineScope } from '@pi-im-bot/support/deadline'
import type { PluginBinding } from '../registry'
import { pluginPackageRoot, verifyPlugin } from '../package'
import { PluginPeer, PluginInvocationError } from '../rpc/peer'
import type { PluginAction, PluginInvocationView } from '../rpc/protocol'
import { PluginRuntimeSchema, pluginPaths, hostPluginPath, type PluginRuntimeConfig } from './config'
import { DockerPluginBackend, type PluginContainerBackend } from './docker'
import { pluginContainerSpec, workerScopeKey } from './container-spec'
import { buildPluginRunner } from './runner-bundle'
import { BACKGROUND_CONTEXT, awaitWithContext, withAbortSignal } from '@earendil-works/chord/context'
import { ManagedPluginVolumes } from '../storage/volumes'
import type { PluginVolumes, PluginVolumeLease } from '../storage/contracts'
import { openPluginDataFile } from '../storage/files'

interface Worker {
  mode: 'plugin' | 'validator' | 'stateless'
  key: string
  instanceId: string
  scopeKey: string
  name: string
  id?: string
  peer: PluginPeer
  rpcDirectory: string
  busy: boolean
  lastUsed: number
  stopping?: Promise<void>
  creating?: Promise<string>
  controller: AbortController
  cleanupError?: string
  destroyed?: boolean
  volumeReleased?: boolean
  release(): void
  volume: PluginVolumeLease
}

interface WorkerLock {
  limiter: RunLimiter
  users: number
}

interface WorkerFault {
  count: number
  retryAt: number
  message: string
}

export class PluginWorkerManager {
  readonly config: PluginRuntimeConfig
  readonly paths: ReturnType<typeof pluginPaths>
  readonly owner: string
  private readonly backend: PluginContainerBackend
  readonly volumes: PluginVolumes
  private readonly slots: RunLimiter
  private readonly validators: RunLimiter
  private readonly backgroundStatelessSlots: RunLimiter
  private backgroundStatelessCalls = 0
  private readonly workers = new Map<string, Worker>()
  private readonly locks = new Map<string, WorkerLock>()
  private readonly faults = new Map<string, WorkerFault>()
  private runner?: Promise<string>
  private image?: Promise<string>
  private housekeeping?: ReturnType<typeof setInterval>
  private waiting = 0
  private invocations = 0
  private validationCalls = 0
  private closed = false
  private readonly shutdown = new AbortController()
  private readonly starting = new Set<Promise<Worker>>()

  constructor(
    projectDir: string,
    configuration: PluginRuntimeConfig,
    backend?: PluginContainerBackend,
    deployment = projectDir,
    volumes?: PluginVolumes
  ) {
    this.config = PluginRuntimeSchema.parse(configuration)
    this.paths = pluginPaths(projectDir, this.config)
    this.owner = createHash('sha256')
      .update(JSON.stringify([deployment, this.paths.hostRuntimeDir]))
      .digest('hex')
      .slice(0, 16)
    this.backend = backend ?? new DockerPluginBackend(this.config.socketPath)
    this.slots = new RunLimiter(this.config.maxWorkers)
    this.validators = new RunLimiter(this.config.maxValidators)
    this.backgroundStatelessSlots = new RunLimiter(Math.max(0, this.config.maxWorkers - 1))
    this.volumes = volumes ?? new ManagedPluginVolumes(this.paths.dataDir, this.owner, this.config.storage)
  }

  async start() {
    if (!this.config.enabled) {
      return
    }
    await mkdir(this.paths.runtimeDir, { recursive: true, mode: 0o700 })
    for (const worker of await this.backend.owned(this.owner)) {
      await this.backend.destroy(worker.id, worker.name, this.owner)
    }
    await this.volumes.prepare()
    this.housekeeping = setInterval(
      () => {
        for (const worker of this.workers.values()) {
          if (!worker.busy && Date.now() - worker.lastUsed > this.config.idleMs) {
            void this.stopWorker(worker).catch(() => {})
          }
        }
      },
      Math.min(this.config.idleMs, 10000)
    )
  }

  status() {
    return {
      enabled: this.config.enabled,
      invocations: this.invocations,
      waiting: this.waiting,
      workers: [...this.workers.values()].map((worker) => {
        return {
          key: worker.key,
          mode: worker.mode,
          name: worker.name,
          busy: worker.busy,
          stopping: Boolean(worker.stopping),
          cleanupError: worker.cleanupError,
          lastUsed: worker.lastUsed
        }
      }),
      faults: [...this.faults.entries()].map(([key, value]) => {
        return { key, ...value }
      })
    }
  }

  canStartInlinePresentation() {
    // Count admitted business calls (including waiters), independently of validators.
    // invoke() increments this count before yielding, so Core check + invocation
    // leaves one foreground slot without widening the configured total budget.
    return this.invocations - this.validationCalls < this.config.maxWorkers - 1
  }

  openDataFile(instance: string, generation: string, scope: string, relative: string) {
    const worker = this.workers.get(workerScopeKey(instance, generation, scope))
    if (!worker || worker.stopping || !worker.busy) {
      throw new Error('插件数据文件只能在绑定的活动调用中发布')
    }
    return openPluginDataFile(worker.volume.path, relative)
  }

  async invoke(
    binding: PluginBinding,
    action: PluginAction,
    context: PluginInvocationView,
    input: unknown,
    signal: AbortSignal,
    host: Parameters<PluginPeer['invoke']>[4],
    chain: readonly string[] = [],
    beforeDispatch?: () => void,
    mode: 'plugin' | 'validator' | 'stateless' = 'plugin',
    execution: 'foreground' | 'background' = 'foreground'
  ) {
    if (!this.config.enabled) {
      throw new Error('插件执行后端尚未启用，插件代码不会在 Bot 宿主运行')
    }
    if (this.closed) {
      throw new Error('插件运行时已关闭')
    }
    const backgroundStateless = mode === 'stateless' && execution === 'background'
    if (backgroundStateless && this.config.maxWorkers < 2) {
      throw new Error('无数据后台操作需要至少 2 个业务 Worker，保留一个前台容量')
    }
    if (context.instanceId !== binding.instance.id || context.generation !== binding.bundle.revision) {
      throw new Error('插件调用与固定版本不匹配')
    }
    const remaining = context.deadlineAt - Date.now()
    if (remaining <= 0) {
      throw new Error('插件调用期限已到')
    }
    signal = AbortSignal.any([signal, this.shutdown.signal])
    const key = workerScopeKey(
      binding.instance.id,
      binding.bundle.revision,
      context.scope.id,
      mode,
      execution
    )
    const scopeKey = workerScopeKey(binding.instance.id, 'persistent-data', context.scope.id, mode, execution)
    if (chain.includes(key)) {
      throw new Error('插件调用形成重入环路：' + binding.instance.id)
    }
    if (chain.length >= 8) {
      throw new Error('插件嵌套调用超过深度预算')
    }
    const problem = this.faults.get(key)
    if (problem && problem.retryAt > Date.now()) {
      throw new Error('此插件 Worker 暂时熔断：' + problem.message)
    }
    let lock = this.locks.get(scopeKey)
    let calls = this.invocations - this.validationCalls
    let maximum = this.config.maxWorkers
    if (mode === 'validator') {
      calls = this.validationCalls
      maximum = this.config.maxValidators
    }
    if (calls >= maximum + this.config.maxPending) {
      throw new Error('插件调用等待队列已满')
    }
    if (
      backgroundStateless &&
      this.backgroundStatelessCalls >= this.config.maxWorkers - 1 + Math.max(0, this.config.maxPending - 1)
    ) {
      throw new Error('无数据后台操作等待队列已满，保留前台受理容量')
    }
    this.invocations += 1
    if (backgroundStateless) {
      this.backgroundStatelessCalls += 1
    }
    if (mode === 'validator') {
      this.validationCalls += 1
    }
    if (!lock) {
      lock = { limiter: new RunLimiter(1), users: 0 }
      this.locks.set(scopeKey, lock)
    }
    lock.users += 1
    let release: (() => void) | undefined
    let worker: Worker | undefined
    let releaseStateless: (() => void) | undefined
    const deadline = deadlineScope(signal, context.deadlineAt)
    signal = deadline.signal
    try {
      if (backgroundStateless) {
        if (chain.length > 0) {
          releaseStateless = this.backgroundStatelessSlots.tryAcquire()
          if (!releaseStateless) {
            throw new Error('嵌套无数据操作没有后台容量，未持锁等待')
          }
        } else {
          releaseStateless = await this.backgroundStatelessSlots.acquire(signal)
        }
      }
      if (chain.length > 0) {
        release = lock.limiter.tryAcquire()
        if (!release) {
          throw new Error('嵌套插件调用的 Worker 正忙，未持锁等待')
        }
      } else {
        release = await lock.limiter.acquire(signal)
      }
      const starting = this.getWorker(
        key,
        scopeKey,
        binding,
        context.scope.id,
        signal,
        chain.length > 0,
        mode
      )
      this.starting.add(starting)
      try {
        worker = await starting
      } finally {
        this.starting.delete(starting)
      }
      worker.busy = true
      signal.throwIfAborted()
      beforeDispatch?.()
      const result = await worker.peer.invoke(action, context, input, signal, host)
      this.faults.delete(key)
      return result
    } catch (error) {
      if (worker && !(error instanceof PluginInvocationError)) {
        const previous = this.faults.get(key)?.count ?? 0
        this.faults.set(key, {
          count: previous + 1,
          retryAt: Date.now() + Math.min(30000, 500 * 2 ** previous),
          message: String(error).slice(0, 300)
        })
        if (this.faults.size > 256) {
          this.faults.delete(this.faults.keys().next().value!)
        }
        void this.stopWorker(worker).catch(() => {})
      }
      throw error
    } finally {
      deadline.close()
      if (worker) {
        worker.busy = false
        worker.lastUsed = Date.now()
        if (this.waiting > 0) {
          void this.stopWorker(worker).catch(() => {})
        }
      }
      release?.()
      releaseStateless?.()
      lock.users -= 1
      if (lock.users === 0) {
        this.locks.delete(scopeKey)
      }
      this.invocations -= 1
      if (backgroundStateless) {
        this.backgroundStatelessCalls -= 1
      }
      if (mode === 'validator') {
        this.validationCalls -= 1
      }
    }
  }

  private async getWorker(
    key: string,
    scopeKey: string,
    binding: PluginBinding,
    scopeId: string,
    signal: AbortSignal,
    nested: boolean,
    mode: 'plugin' | 'validator' | 'stateless'
  ) {
    for (const previous of this.workers.values()) {
      if (previous.scopeKey === scopeKey && previous.key !== key) {
        await awaitWithContext(this.stopWorker(previous), withAbortSignal(signal, BACKGROUND_CONTEXT))
      }
    }
    const existing = this.workers.get(key)
    if (existing && !existing.stopping && !existing.cleanupError) {
      existing.busy = true
      return existing
    }
    if (existing && (existing.stopping || existing.cleanupError)) {
      if (nested) {
        throw new Error('嵌套插件调用的 Worker 正在回收，未持锁等待')
      }
      await awaitWithContext(this.stopWorker(existing), withAbortSignal(signal, BACKGROUND_CONTEXT))
    }
    const workers = [...this.workers.values()].filter((worker) => {
      return (worker.mode === 'validator') === (mode === 'validator')
    })
    let maximum = this.config.maxWorkers
    let slots = this.slots
    if (mode === 'validator') {
      maximum = this.config.maxValidators
      slots = this.validators
    }
    const idle = workers
      .filter((worker) => {
        return !worker.busy && !worker.stopping
      })
      .sort((a, b) => {
        return a.lastUsed - b.lastUsed
      })[0]
    if (workers.length >= maximum && idle) {
      await awaitWithContext(this.stopWorker(idle), withAbortSignal(signal, BACKGROUND_CONTEXT))
    }
    this.waiting += 1
    let release: () => void
    try {
      if (nested) {
        const available = slots.tryAcquire()
        if (!available) {
          throw new Error('嵌套插件调用没有空闲 Worker 名额，未持锁等待')
        }
        release = available
      } else {
        release = await slots.acquire(signal)
      }
    } finally {
      this.waiting -= 1
    }
    const controller = new AbortController()
    const startup = AbortSignal.any([
      signal,
      controller.signal,
      AbortSignal.timeout(this.config.startTimeoutMs)
    ])
    let worker: Worker | undefined
    let volume: PluginVolumeLease | undefined
    try {
      await verifyPlugin(this.paths.packageDir, binding.bundle, startup)
      this.runner ??= buildPluginRunner(this.paths.runtimeDir).catch((error) => {
        this.runner = undefined
        throw error
      })
      this.image ??= this.backend
        .image(
          this.config.image,
          AbortSignal.any([this.shutdown.signal, AbortSignal.timeout(this.config.startTimeoutMs)])
        )
        .catch((error) => {
          this.image = undefined
          throw error
        })
      const [runner, image] = await awaitWithContext(
        Promise.all([this.runner, this.image]),
        withAbortSignal(startup, BACKGROUND_CONTEXT)
      )
      let data = ''
      if (mode === 'plugin') {
        volume = await this.volumes.acquire(binding.instance.id, scopeId, startup)
        data = volume.path
      }
      const rpc = join(this.paths.runtimeDir, this.owner.slice(0, 8), key)
      const socket = join(rpc, 'core.sock')
      if (Buffer.byteLength(socket) > 100) {
        throw new Error('插件 RPC 路径过长，请配置较短的 runtimeDir')
      }
      await mkdir(rpc, { recursive: true, mode: 0o700 })
      if (volume) {
        await chmod(data, 0o700)
      }
      await rm(socket, { force: true })
      const token = crypto.randomUUID() + crypto.randomUUID()
      const name = 'pi-im-plugin-' + this.owner.slice(0, 8) + '-' + key
      const peer = new PluginPeer(socket, token, this.config.maxRpcCalls, () => {
        if (worker && !worker.stopping) {
          void this.stopWorker(worker).catch(() => {})
        }
      })
      worker = {
        key,
        mode,
        instanceId: binding.instance.id,
        scopeKey,
        name,
        peer,
        rpcDirectory: rpc,
        busy: true,
        lastUsed: Date.now(),
        release,
        controller,
        volume: volume ?? { path: '', bindPath: '', async release() {} }
      }
      this.workers.set(key, worker)
      await peer.listen()
      let dataPath = ''
      if (volume) {
        dataPath = hostPluginPath(this.paths.dataDir, this.paths.hostDataDir, volume.bindPath)
      }
      const spec = pluginContainerSpec({
        owner: this.owner,
        key,
        binding,
        image,
        config: this.config,
        packagePath: hostPluginPath(
          this.paths.packageDir,
          this.paths.hostPackageDir,
          pluginPackageRoot(this.paths.packageDir, binding.bundle)
        ),
        dataPath,
        rpcPath: hostPluginPath(this.paths.runtimeDir, this.paths.hostRuntimeDir, rpc),
        runnerPath: hostPluginPath(this.paths.runtimeDir, this.paths.hostRuntimeDir, runner),
        token,
        mode
      })
      startup.throwIfAborted()
      worker.creating = this.backend.create(name, spec, startup)
      worker.id = await worker.creating
      startup.throwIfAborted()
      await this.backend.start(worker.id, name, startup)
      await peer.ready(startup)
      startup.throwIfAborted()
      return worker
    } catch (error) {
      if (worker) {
        void this.stopWorker(worker).catch(() => {})
      } else {
        await volume?.release()
        release()
      }
      throw error
    }
  }

  private stopWorker(worker: Worker) {
    worker.stopping ??= (async () => {
      worker.controller.abort(new Error('插件 Worker 正在回收'))
      await worker.peer.close()
      const id = await worker.creating?.catch(() => {
        return undefined
      })
      if (!worker.destroyed) {
        await this.backend.destroy(id ?? worker.name, worker.name, this.owner)
        worker.destroyed = true
      }
      if (!worker.volumeReleased) {
        await worker.volume.release()
        worker.volumeReleased = true
      }
      await rm(worker.rpcDirectory, { recursive: true, force: true })
      if (this.workers.get(worker.key) === worker) {
        this.workers.delete(worker.key)
      }
      worker.release()
    })().catch((error) => {
      worker.cleanupError = String(error).slice(0, 500)
      worker.stopping = undefined
      throw error
    })
    return worker.stopping
  }
  retainInstances(enabled: ReadonlySet<string>) {
    for (const worker of this.workers.values()) {
      if (!enabled.has(worker.instanceId)) {
        void this.stopWorker(worker).catch(() => {})
      }
    }
  }
  async close() {
    this.closed = true
    this.shutdown.abort(new Error('插件运行时已关闭'))
    if (this.housekeeping) {
      clearInterval(this.housekeeping)
    }
    await Promise.allSettled([...this.starting])
    await Promise.all(
      [...this.workers.values()].map((worker) => {
        return this.stopWorker(worker)
      })
    )
    await this.volumes.close()
  }
}
