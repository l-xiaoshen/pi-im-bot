import { z } from 'zod'
import { mkdir, rename, rm, readdir, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import type { PluginEditor } from '../editor'
import { PluginManifestSchema } from '../manifest'
import { PluginInstanceSchema } from '../config'
import { importPlugin, pluginPackageRoot, verifyPlugin } from '../package'
import { pluginPaths } from '../runtime/config'
import { RunLimiter } from '@pi-im-bot/support/limiter'
import { requestedGrants } from '../management'
import { unpackPluginArchive, pluginArchive, maxArchiveBytes } from './archive'
import { resolvePluginSource, downloadPluginFile } from './source'
import type { PluginOrigin } from './origin'
import type { PluginSourceReader } from './download'
import { saveUpdateSource, readUpdateSource } from './update-source'
import { InstallationListSchema, type Installation, InstallRequestSchema } from './contracts'

export class PluginInstaller {
  private readonly root: string
  private readonly slots = new RunLimiter(1)
  private readonly jobs = new Map<string, Installation>()
  private readonly controllers = new Map<string, AbortController>()
  private readonly ready: Promise<void>
  private writes: Promise<void> = Promise.resolve()
  private readonly running = new Set<Promise<void>>()
  constructor(
    readonly editor: PluginEditor,
    private readonly changed: () => void = () => {},
    private readonly download: PluginSourceReader = downloadPluginFile
  ) {
    this.root = join(editor.configuration().dataDir, 'plugin-installations')
    this.ready = this.recover()
    void this.ready.catch(() => {})
  }
  private async recover() {
    const file = Bun.file(join(this.root, 'jobs.json'))
    if (await file.exists()) {
      for (const job of InstallationListSchema.parse(await file.json())) {
        if (!['succeeded', 'failed', 'cancelled', 'interrupted'].includes(job.stage)) {
          job.stage = 'interrupted'
          job.error = '安装在重启时中断，当前已应用版本保留，可重新安装'
        }
        this.jobs.set(job.id, job)
      }
    }
  }
  private save() {
    const content = JSON.stringify([...this.jobs.values()].slice(-100))
    const operation = this.writes
      .catch(() => {})
      .then(async () => {
        await mkdir(this.root, { recursive: true, mode: 0o700 })
        const path = join(this.root, 'jobs.json')
        await Bun.write(path + '.tmp', content, { mode: 0o600 })
        await rename(path + '.tmp', path)
      })
    this.writes = operation
    return operation
  }
  async list() {
    await this.ready
    return [...this.jobs.values()].slice(-100).reverse()
  }
  async cancel(id: string) {
    await this.ready
    const job = this.jobs.get(id)
    if (!job) {
      throw new Error('安装任务不存在')
    }
    if (job.stage === 'applying') {
      throw new Error('正在原子应用版本，请等待安装结果')
    }
    this.controllers.get(id)?.abort(new Error('安装已取消'))
    return job
  }
  async updateSource(id: string) {
    const bundle = this.editor.configuration().resources.pluginPackage(id)
    if (!bundle) {
      throw new Error('插件未安装')
    }
    if (!bundle.updateSourceId) {
      return undefined
    }
    return readUpdateSource(this.root, id, bundle.updateSourceId)
  }
  async start(input: z.infer<typeof InstallRequestSchema>, archive?: Uint8Array) {
    await this.ready
    if (!archive) {
      input = InstallRequestSchema.parse(input)
    }
    const release = this.slots.tryAcquire()
    if (!release) {
      throw new Error('另一个安装任务正在进行，请稍后重试')
    }
    const job: Installation = {
      id: crypto.randomUUID(),
      name: '安装插件',
      stage: 'queued',
      createdAt: Date.now(),
      updatedAt: Date.now()
    }
    const controller = new AbortController()
    this.jobs.set(job.id, job)
    this.controllers.set(job.id, controller)
    try {
      await this.save()
    } catch (error) {
      release()
      this.controllers.delete(job.id)
      throw error
    }
    const operation = this.run(job, input, controller.signal, archive).finally(() => {
      release()
      this.controllers.delete(job.id)
      this.running.delete(operation)
    })
    this.running.add(operation)
    void operation.catch(() => {})
    return { ...job }
  }
  private async run(
    job: Installation,
    input: z.infer<typeof InstallRequestSchema>,
    cancellation: AbortSignal,
    archive?: Uint8Array
  ) {
    const staging = join(this.root, job.id)
    const signal = AbortSignal.any([cancellation, AbortSignal.timeout(120000)])
    const config = this.editor.configuration()
    async function phase(stage: Installation['stage']) {
      job.stage = stage
      job.updatedAt = Date.now()
    }
    try {
      let source = input.directory
      let origin: PluginOrigin | undefined
      if (input.builtin) {
        source = join(config.projectDir, 'examples/plugins', input.builtin)
      }
      if (!source) {
        await phase('downloading')
        await this.save()
        let content = archive
        if (!content) {
          if (!input.url) {
            throw new Error('缺少发布来源')
          }
          const resolved = await resolvePluginSource(input.url, signal, this.download)
          origin = resolved.origin
          job.origin = origin
          content = await this.download(resolved.url, signal)
        }
        const archiveSha256 = createHash('sha256').update(content).digest('hex')
        if (input.sha256 && archiveSha256 !== input.sha256) {
          throw new Error('发布包摘要与目录记录不一致')
        }
        if (origin) {
          origin.archiveSha256 = archiveSha256
        }
        source = join(staging, 'source')
        let selectedDirectory: string | undefined
        if (origin?.kind === 'github-source') {
          selectedDirectory = origin.directory ?? ''
        }
        await unpackPluginArchive(content, source, signal, selectedDirectory)
      }
      source = resolve(config.projectDir, source)
      await phase('verifying')
      await this.save()
      const manifestFile = Bun.file(join(source, 'plugin.json'))
      if (manifestFile.size > 1024 * 1024) {
        throw new Error('插件声明超过 1 MiB')
      }
      const manifest = PluginManifestSchema.parse(await manifestFile.json())
      if (origin?.kind === 'github-source' && !(await Bun.file(join(source, manifest.entry)).exists())) {
        throw new Error(
          '仓库没有包含声明的入口 ' + manifest.entry + '；请提交可运行入口或使用已构建的 Release ZIP'
        )
      }
      if (
        (input.packageId && input.packageId !== manifest.id) ||
        (input.version && input.version !== manifest.version)
      ) {
        throw new Error('发布包标识或版本与插件目录不一致')
      }
      job.name = manifest.name
      const previous = config.resources.config.plugins.find((instance) => {
        if (input.targetId) {
          return instance.id === input.targetId
        }
        return config.resources.pluginPackage(instance.id)?.manifest.id === manifest.id
      })
      if (input.targetId && !previous) {
        throw new Error('要更新的插件实例不存在')
      }
      if (previous && config.resources.pluginPackage(previous.id)?.manifest.id !== manifest.id) {
        throw new Error('不能用另一个包覆盖当前实例')
      }
      let id = manifest.id
      if (previous) {
        id = previous.id
      } else if (
        config.resources.config.plugins.some((entry) => {
          return entry.id === id
        })
      ) {
        id = id.slice(0, 22) + '-' + crypto.randomUUID().slice(0, 8)
      }
      const instance = PluginInstanceSchema.parse({
        id,
        name: manifest.name,
        enabled: false,
        sourceDir: source
      })
      const paths = pluginPaths(config.projectDir, config.bot.plugins)
      const bundle = await importPlugin(instance, config.projectDir, paths.packageDir, origin)
      instance.grants = requestedGrants(bundle)
      signal.throwIfAborted()
      await phase('applying')
      await this.save()
      const stored = pluginPackageRoot(paths.packageDir, bundle)
      bundle.updateSourceId = await saveUpdateSource(this.root, id, input)
      let create
      if (!previous) {
        create = instance
      }
      await this.editor.publish(input.revision, id, bundle, stored, create)
      this.changed()
      job.pluginId = id
      await phase('succeeded')
    } catch (error) {
      await phase('failed')
      if (cancellation.aborted) {
        job.stage = 'cancelled'
      }
      job.error = String(error)
        .replace(/https?:\/\/\S+/gu, '[发布来源]')
        .slice(0, 1500)
    } finally {
      await rm(staging, { recursive: true, force: true }).catch(() => {})
      await this.save().catch(() => {})
    }
  }
  async builtinCatalog() {
    const config = this.editor.configuration()
    const root = join(config.projectDir, 'examples/plugins')
    let names: string[] = []
    try {
      names = await readdir(root)
    } catch {
      return []
    }
    const results = []
    for (const id of names) {
      const manifest = PluginManifestSchema.safeParse(
        await Bun.file(join(root, id, 'plugin.json'))
          .json()
          .catch(() => undefined)
      )
      if (manifest.success) {
        results.push({ id, manifest: manifest.data })
      }
    }
    return results
  }
  async archive(id: string) {
    const config = this.editor.configuration()
    const bundle = config.resources.pluginPackage(id)
    if (!bundle) {
      throw new Error('插件版本不存在')
    }
    const root = pluginPaths(config.projectDir, config.bot.plugins).packageDir
    await verifyPlugin(root, bundle)
    const files = new Map<string, Uint8Array>()
    for (const file of bundle.files) {
      files.set(file.path, await readFile(join(pluginPackageRoot(root, bundle), file.path)))
    }
    const content = pluginArchive(files)
    if (content.length > maxArchiveBytes) {
      throw new Error('未压缩发布包超过 ZIP 传输预算')
    }
    return { content, name: bundle.manifest.id + '-' + bundle.manifest.version + '.zip' }
  }
  async close() {
    for (const [id, controller] of this.controllers) {
      if (this.jobs.get(id)?.stage !== 'applying') {
        controller.abort(new Error('服务正在关闭'))
      }
    }
    await Promise.allSettled([...this.running])
    await this.writes
  }
}
