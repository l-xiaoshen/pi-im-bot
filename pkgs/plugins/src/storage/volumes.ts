import { mkdir, open, rename, unlink, lstat, readdir, statfs } from "node:fs/promises"
import { join } from "node:path"
import { createHash } from "node:crypto"
import { RunLimiter } from "@pi-im-bot/support/limiter"
import { PluginStorageSchema, type PluginStorageConfig } from "./config"
import { VolumeCatalogSchema, type PluginVolume, type PluginVolumes, type PluginVolumeLease } from "./contracts"
import { FuseFilesystem, filesystemMount, storageDependencies, runStorageCommand } from "./filesystem"
import { PluginIdSchema } from "../manifest"

const MiB = 1024 * 1024
function hash(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 20)
}
interface MountedVolume {
  volume: PluginVolume
  references: number
}

export class ManagedPluginVolumes implements PluginVolumes {
  private readonly root: string
  private readonly lock = new RunLimiter(1)
  private readonly mounted = new Map<string, MountedVolume>()
  private readonly filesystem: FuseFilesystem
  readonly config: PluginStorageConfig

  constructor(dataDir: string, owner: string, configuration: PluginStorageConfig) {
    this.config = PluginStorageSchema.parse(configuration)
    this.root = join(dataDir, owner)
    this.filesystem = new FuseFilesystem(this.config)
  }
  private paths(volume: Pick<PluginVolume, "instanceId" | "scopeKey">) {
    const directory = join(this.root, volume.instanceId, volume.scopeKey)
    const view = join(this.root, "views", volume.instanceId, volume.scopeKey)
    return { directory, image: join(directory, "volume.img"), view, mount: join(view, "files") }
  }
  private async catalog() {
    const file = Bun.file(join(this.root, "volumes.json"))
    if (!(await file.exists())) {
      return VolumeCatalogSchema.parse({ version: 1, volumes: [] })
    }
    return VolumeCatalogSchema.parse(await file.json())
  }
  private async save(catalog: ReturnType<typeof VolumeCatalogSchema.parse>) {
    await mkdir(this.root, { recursive: true, mode: 0o700 })
    const target = join(this.root, "volumes.json")
    const temporary = target + "." + crypto.randomUUID() + ".tmp"
    const file = await open(temporary, "wx", 0o600)
    try {
      await file.writeFile(JSON.stringify(catalog))
      await file.sync()
    } finally {
      await file.close()
    }
    try {
      await rename(temporary, target)
    } finally {
      await unlink(temporary).catch(() => {})
    }
    const directory = await open(this.root, "r")
    try {
      await directory.sync()
    } finally {
      await directory.close()
    }
  }
  async prepare() {
    if (!(await storageDependencies(this.config))) {
      throw new Error("插件持久数据需要 Linux、/dev/fuse、fuse2fs、mke2fs、e2fsck 和 fusermount3；未回退普通目录")
    }
    for (const volume of (await this.catalog()).volumes) {
      const paths = this.paths(volume)
      if (await filesystemMount(paths.mount)) {
        await this.filesystem.unmount(paths.image, paths.mount)
      }
    }
  }

  async acquire(instance: string, scope: string, signal: AbortSignal): Promise<PluginVolumeLease> {
    instance = PluginIdSchema.parse(instance)
    const release = await this.lock.acquire(signal)
    const id = hash(instance + ":" + scope)
    try {
      const active = this.mounted.get(id)
      if (active) {
        active.references += 1
        return this.lease(active.volume)
      }
      const catalog = await this.catalog()
      let volume = catalog.volumes.find((volume) => {
        return volume.id === id
      })
      if (!volume) {
        const bytes = this.config.volumeMiB * MiB
        const total = catalog.volumes.reduce((sum, item) => {
          return sum + item.bytes
        }, 0)
        const plugin = catalog.volumes
          .filter((item) => {
            return item.instanceId === instance
          })
          .reduce((sum, item) => {
            return sum + item.bytes
          }, 0)
        if (
          total + bytes > this.config.totalMiB * MiB ||
          plugin + bytes > this.config.pluginMiB * MiB ||
          catalog.volumes.length >= this.config.maxVolumes
        ) {
          throw new Error("插件持久数据预留额度已满，未创建新卷")
        }
        volume = {
          id,
          instanceId: instance,
          scopeKey: hash(scope),
          uuid: crypto.randomUUID(),
          bytes,
          state: "creating",
          createdAt: Date.now(),
          lastUsedAt: Date.now()
        }
        catalog.volumes.push(volume)
        await this.save(catalog)
        const paths = this.paths(volume)
        try {
          await mkdir(paths.directory, { recursive: true, mode: 0o700 })
          if ((await readdir(paths.directory)).length > 0) {
            throw new Error("存在未登记的插件数据，拒绝覆盖或隐式迁移")
          }
          const image = await open(paths.image, "wx", 0o600)
          try {
            await image.truncate(bytes)
            await image.sync()
          } finally {
            await image.close()
          }
          await runStorageCommand(
            this.config.formatCommand,
            [
              "-q",
              "-t",
              "ext4",
              "-O",
              "^has_journal",
              "-F",
              "-m",
              "0",
              "-U",
              volume.uuid,
              "-E",
              "root_owner=" + (process.getuid?.() ?? 1000) + ":" + (process.getgid?.() ?? 1000),
              paths.image
            ],
            AbortSignal.any([signal, AbortSignal.timeout(this.config.timeoutMs)])
          )
          volume.state = "ready"
          await this.save(catalog)
        } catch (error) {
          volume.state = "quarantined"
          volume.error = String(error).slice(0, 500)
          await this.save(catalog)
          throw error
        }
      }
      if (volume.state !== "ready") {
        throw new Error("插件数据卷未完成创建或已隔离，需核对原数据；未自动重建")
      }
      const paths = this.paths(volume)
      const info = await lstat(paths.image)
      if (!info.isFile() || info.isSymbolicLink() || info.size !== volume.bytes) {
        throw new Error("插件镜像类型或容量与登记不一致")
      }
      const deadline = AbortSignal.any([signal, AbortSignal.timeout(this.config.timeoutMs)])
      deadline.throwIfAborted()
      try {
        await runStorageCommand(this.config.checkCommand, ["-p", paths.image], deadline, [0, 1])
      } catch (error) {
        volume.state = "quarantined"
        volume.error = "数据卷检查未完成，未自动重建"
        await this.save(catalog)
        throw error
      }
      volume.lastUsedAt = Date.now()
      await this.save(catalog)
      await this.filesystem.mount(paths.image, paths.mount, deadline)
      this.mounted.set(volume.id, { volume, references: 1 })
      return this.lease(volume)
    } finally {
      release()
    }
  }

  private lease(volume: PluginVolume): PluginVolumeLease {
    let released = false
    return {
      path: this.paths(volume).mount,
      bindPath: this.paths(volume).view,
      release: async () => {
        if (released) {
          return
        }
        const unlock = await this.lock.acquire()
        try {
          const active = this.mounted.get(volume.id)
          if (!active) {
            released = true
            return
          }
          if (active.references > 1) {
            active.references -= 1
            released = true
            return
          }
          const paths = this.paths(volume)
          const stats = await statfs(paths.mount)
          const catalog = await this.catalog()
          const record = catalog.volumes.find((item) => {
            return item.id === volume.id
          })!
          record.usedBytes = (stats.blocks - stats.bfree) * stats.bsize
          record.measuredAt = Date.now()
          await this.filesystem.unmount(paths.image, paths.mount)
          await this.save(catalog)
          this.mounted.delete(volume.id)
          released = true
        } finally {
          unlock()
        }
      }
    }
  }
  async status() {
    const catalog = await this.catalog()
    return {
      reservedBytes: catalog.volumes.reduce((sum, volume) => {
        return sum + volume.bytes
      }, 0),
      totalBytes: this.config.totalMiB * MiB,
      pluginBytes: this.config.pluginMiB * MiB,
      volumeBytes: this.config.volumeMiB * MiB,
      maxVolumes: this.config.maxVolumes,
      dependenciesReady: await storageDependencies(this.config),
      volumes: catalog.volumes.map((volume) => {
        return { ...volume, mounted: this.mounted.has(volume.id) }
      })
    }
  }
  async close() {
    if (this.mounted.size > 0) {
      throw new Error("仍有插件数据卷租约，未强制卸载")
    }
    await this.filesystem.close()
  }
}
