import { mkdirSync, existsSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import type { Configuration } from './load'
import { BotConfigSchema } from './schema'
import { ProvidersConfigSchema } from '@pi-im-bot/providers/schema'
import { ProviderCatalog } from '@pi-im-bot/providers/catalog'
import { FrameworkConfigSchema } from '@pi-im-bot/settings/schema'
import { revision } from '@pi-im-bot/settings/resolve'
import { ResourcesConfigSchema } from '@pi-im-bot/resources/schema'
import { McpManifestSchema } from '@pi-im-bot/resources/mcp/schema'
import { SkillManifestSchema } from '@pi-im-bot/resources/skills/schema'
import { ResourceLibrary } from '@pi-im-bot/resources/library'
import { PluginPackageSchema } from '@pi-im-bot/plugins/config'
import { BoundedCache } from '@pi-im-bot/support/bounded-cache'

const ReferenceSchema = z.string().regex(/^[a-f0-9]{64}$/)
const ConfigurationSnapshotSchema = z.object({
  version: z.literal(1),
  bot: BotConfigSchema,
  providers: ProvidersConfigSchema,
  framework: FrameworkConfigSchema,
  resources: ResourcesConfigSchema,
  mcp: z.array(McpManifestSchema),
  skills: z.array(SkillManifestSchema),
  plugins: z.array(PluginPackageSchema).default([])
})

/** Private configuration archive. Only its hash is included in public run records. */
export class ConfigurationSnapshots {
  private readonly known = new BoundedCache<string, true>(128)
  private readonly restored = new BoundedCache<string, Promise<Configuration>>(32)
  private readonly directory: string

  constructor(private readonly current: () => Configuration) {
    this.directory = join(current().dataDir, 'configuration-snapshots')
    mkdirSync(this.directory, { recursive: true, mode: 0o700 })
  }

  save(config: Configuration) {
    const value = {
      version: 1,
      bot: config.bot,
      providers: config.catalog.config,
      framework: config.framework,
      resources: config.resources.config,
      mcp: config.resources.manifests,
      skills: config.resources.skillManifests,
      plugins: config.resources.pluginPackages
    }
    const id = revision(value)
    if (this.known.get(id)) {
      return id
    }
    const path = join(this.directory, id + '.json')
    if (!existsSync(path)) {
      const temporary = path + '.' + crypto.randomUUID() + '.tmp'
      writeFileSync(temporary, JSON.stringify(value) + '\n', { mode: 0o600 })
      renameSync(temporary, path)
    }
    this.known.set(id, true)
    return id
  }

  load(id: string) {
    ReferenceSchema.parse(id)
    let result = this.restored.get(id)
    if (!result) {
      result = this.restore(id)
      this.restored.set(id, result)
      const pending = result
      void result.catch(() => {
        if (this.restored.get(id) === pending) {
          this.restored.delete(id)
        }
      })
    }
    return result
  }

  private async restore(id: string): Promise<Configuration> {
    const raw: unknown = await Bun.file(join(this.directory, id + '.json')).json()
    if (revision(raw) !== id) {
      throw new Error('固定配置快照已被修改，任务不能按原配置恢复')
    }
    const snapshot = ConfigurationSnapshotSchema.parse(raw)
    const current = this.current()
    return {
      ...current,
      bot: snapshot.bot,
      framework: snapshot.framework,
      catalog: await ProviderCatalog.create(snapshot.providers, current.dataDir),
      resources: new ResourceLibrary(snapshot.resources, snapshot.mcp, snapshot.skills, snapshot.plugins)
    }
  }
}
