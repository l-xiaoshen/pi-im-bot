import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { z } from 'zod'
import type { PluginInstaller } from '../install/service'
import { downloadPluginFile } from '../install/source'
import { PluginIndexSchema, CatalogReleaseSchema, type MarketViewSchema } from './contracts'
import { PluginCatalogSourceSchema } from './contracts'

const CacheSchema = z.array(
  z.object({ sourceId: z.string(), sourceRevision: z.string(), item: CatalogReleaseSchema })
)
function displayUrl(value: string) {
  const url = new URL(value)
  url.search = ''
  url.hash = ''
  return url.href
}
export class PluginMarket {
  private cache?: z.infer<typeof CacheSchema>
  private errors: string[] = []
  constructor(readonly installer: PluginInstaller) {}
  private async load() {
    if (this.cache) {
      return
    }
    const file = Bun.file(
      join(this.installer.editor.configuration().dataDir, 'plugin-installations/market.json')
    )
    this.cache = []
    if (await file.exists()) {
      this.cache = CacheSchema.parse(await file.json())
    }
  }
  async refresh() {
    await this.load()
    const config = this.installer.editor.configuration()
    this.errors = []
    const outcomes = await Promise.allSettled(
      config.resources.config.pluginCatalogs.map(async (source) => {
        const content = await downloadPluginFile(source.url, AbortSignal.timeout(10000), 1024 * 1024)
        return { source, items: PluginIndexSchema.parse(JSON.parse(content.toString('utf8'))).plugins }
      })
    )
    for (const [index, result] of outcomes.entries()) {
      const id = config.resources.config.pluginCatalogs[index].id
      if (result.status === 'fulfilled') {
        this.cache = this.cache!.filter((entry) => {
          return entry.sourceId !== id
        })
        this.cache.push(
          ...result.value.items.map((item) => {
            return {
              sourceId: id,
              sourceRevision: createHash('sha256').update(result.value.source.url).digest('hex'),
              item
            }
          })
        )
      } else {
        this.errors.push(config.resources.config.pluginCatalogs[index].name + '：读取失败，保留缓存目录')
      }
    }
    const directory = join(config.dataDir, 'plugin-installations')
    const { mkdir, rename } = await import('node:fs/promises')
    await mkdir(directory, { recursive: true, mode: 0o700 })
    const path = join(directory, 'market.json')
    await Bun.write(path + '.tmp', JSON.stringify(this.cache), { mode: 0o600 })
    await rename(path + '.tmp', path)
    return this.read()
  }
  async read(): Promise<z.infer<typeof MarketViewSchema>> {
    await this.load()
    const config = this.installer.editor.configuration()
    const installed = (id: string) => {
      const instance = config.resources.config.plugins.find((instance) => {
        return config.resources.pluginPackage(instance.id)?.manifest.id === id
      })
      if (!instance) {
        return undefined
      }
      return { instance, bundle: config.resources.pluginPackage(instance.id)! }
    }
    const entries: z.infer<typeof MarketViewSchema>['entries'] = (await this.installer.builtinCatalog()).map(
      ({ id, manifest }) => {
        const current = installed(manifest.id)
        return {
          key: 'builtin:' + id,
          id: manifest.id,
          name: manifest.name,
          description: manifest.description,
          version: manifest.version,
          author: manifest.author,
          categories: manifest.categories,
          apiVersion: 1,
          source: '项目内样例',
          installedId: current?.instance.id,
          installedVersion: current?.bundle.manifest.version,
          updateAvailable: Boolean(current && current.bundle.manifest.version !== manifest.version)
        }
      }
    )
    for (const entry of this.cache!) {
      const source = config.resources.config.pluginCatalogs.find((source) => {
        return source.id === entry.sourceId
      })
      if (!source) {
        continue
      }
      if (createHash('sha256').update(source.url).digest('hex') !== entry.sourceRevision) {
        continue
      }
      const { url: _url, sha256: _sha, ...item } = entry.item
      const current = installed(item.id)
      entries.push({
        ...item,
        key: this.key(entry.sourceId, entry.item),
        source: source.name,
        installedId: current?.instance.id,
        installedVersion: current?.bundle.manifest.version,
        updateAvailable: Boolean(current && current.bundle.origin?.archiveSha256 !== entry.item.sha256)
      })
    }
    return {
      entries,
      sources: config.resources.config.pluginCatalogs.map((source) => {
        return { ...source, url: displayUrl(source.url) }
      }),
      errors: this.errors
    }
  }
  private key(sourceId: string, item: z.infer<typeof CatalogReleaseSchema>) {
    return (
      'catalog:' +
      createHash('sha256')
        .update(JSON.stringify([sourceId, item]))
        .digest('hex')
    )
  }
  async install(key: string, revision: string) {
    await this.load()
    if (key.startsWith('builtin:')) {
      return this.installer.start({ revision, builtin: key.slice(8) })
    }
    const entry = this.cache!.find((entry) => {
      return (
        this.key(entry.sourceId, entry.item) === key &&
        this.installer.editor.configuration().resources.config.pluginCatalogs.some((source) => {
          return (
            source.id === entry.sourceId &&
            createHash('sha256').update(source.url).digest('hex') === entry.sourceRevision
          )
        })
      )
    })
    if (!entry) {
      throw new Error('目录版本已变化，请刷新目录')
    }
    return this.installer.start({
      revision,
      url: entry.item.url,
      sha256: entry.item.sha256,
      packageId: entry.item.id,
      catalogId: entry.sourceId,
      version: entry.item.version
    })
  }
  async sources(revision: string, sources: z.infer<typeof PluginCatalogSourceSchema>[]) {
    await this.installer.editor.mutate(revision, (config) => {
      config.pluginCatalogs = sources.map((source) => {
        const old = config.pluginCatalogs.find((entry) => {
          return entry.id === source.id
        })
        if (old && source.url === displayUrl(old.url)) {
          return { ...source, url: old.url }
        }
        return source
      })
    })
    return this.read()
  }
  async forceUpdate(id: string, revision: string) {
    const source = await this.installer.updateSource(id)
    if (source && !('catalogId' in source)) {
      return this.installer.start({ ...source, revision, targetId: id })
    }
    const bundle = this.installer.editor.configuration().resources.pluginPackage(id)
    if (!bundle) {
      throw new Error('插件未安装')
    }
    await this.refresh()
    const entries = this.cache!.filter((entry) => {
      return (
        (!source || !('catalogId' in source) || entry.sourceId === source.catalogId) &&
        entry.item.id === bundle.manifest.id &&
        this.installer.editor.configuration().resources.config.pluginCatalogs.some((source) => {
          return (
            source.id === entry.sourceId &&
            createHash('sha256').update(source.url).digest('hex') === entry.sourceRevision
          )
        })
      )
    })
    if (entries.length === 1) {
      return this.installer.start({
        revision,
        targetId: id,
        catalogId: entries[0].sourceId,
        url: entries[0].item.url,
        sha256: entries[0].item.sha256,
        packageId: entries[0].item.id,
        version: entries[0].item.version
      })
    }
    if (bundle.origin?.repository) {
      let url = bundle.origin.repository
      if (bundle.origin.ref) {
        url += '/tree/' + bundle.origin.ref
        if (bundle.origin.directory) {
          url += '/' + bundle.origin.directory
        }
      }
      return this.installer.start({ revision, targetId: id, url })
    }
    throw new Error('此插件没有唯一的更新来源，请从安装入口上传替换包或填写来源链接')
  }
}
