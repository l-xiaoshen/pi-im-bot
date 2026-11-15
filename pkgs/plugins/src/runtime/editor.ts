import { join } from 'node:path'
import { mkdir, rename } from 'node:fs/promises'
import { z } from 'zod'
import type { Configuration } from '@pi-im-bot/config/load'
import { BotConfigSchema } from '@pi-im-bot/config/schema'
import { ConfigurationMutations } from '@pi-im-bot/config/mutations'
import { revision } from '@pi-im-bot/settings/resolve'
import { SettingsEditError } from '@pi-im-bot/settings/editor'
import type { PluginService } from '../service'
import { PluginWorkerManager } from './manager'
import { PluginRuntimeSchema, type PluginRuntimeConfig } from './config'
import { probePluginEnvironment } from './probe'
import type {
  PluginEnvironment,
  SavePluginEnvironmentSchema,
  PluginEnvironmentInputSchema
} from './contracts'

export class PluginRuntimeEditor {
  constructor(
    private readonly configuration: () => Configuration,
    private readonly service: PluginService,
    private readonly mutations = new ConfigurationMutations(),
    private readonly probe = probePluginEnvironment,
    private readonly create = (config: Configuration, runtime: PluginRuntimeConfig) => {
      return new PluginWorkerManager(config.projectDir, runtime, undefined, config.dataDir)
    }
  ) {}
  private async file() {
    const path = join(this.configuration().configDir, 'bot.json')
    const text = await Bun.file(path).text()
    return { path, text, revision: revision(text), bot: BotConfigSchema.parse(JSON.parse(text)) }
  }
  async read(input?: z.infer<typeof PluginEnvironmentInputSchema>): Promise<PluginEnvironment> {
    const file = await this.file()
    const runtime = structuredClone(file.bot.plugins)
    if (input) {
      runtime.image = input.image
      runtime.storage.mountCommand = input.mountCommand
    }
    return {
      revision: file.revision,
      enabled: file.bot.plugins.enabled,
      applied: revision(file.bot.plugins) === revision(this.configuration().bot.plugins),
      image: runtime.image,
      mountCommand: runtime.storage.mountCommand,
      ...(await this.probe(this.configuration(), runtime))
    }
  }
  save(input: z.infer<typeof SavePluginEnvironmentSchema>) {
    return this.mutations.exclusive(async () => {
      const file = await this.file()
      if (file.revision !== input.revision) {
        throw new SettingsEditError('执行环境配置已变化，请刷新后重试', 409)
      }
      const runtime = PluginRuntimeSchema.parse({
        ...file.bot.plugins,
        enabled: input.enabled,
        image: input.image,
        storage: { ...file.bot.plugins.storage, mountCommand: input.mountCommand }
      })
      if (runtime.enabled && !(await this.probe(this.configuration(), runtime)).ready) {
        throw new Error('执行依赖检查未通过，请先修复标记的项目')
      }
      if (runtime.enabled && this.service.manager.status().workers.length) {
        throw new Error('请先停用执行环境并等待当前 Worker 退出，再修改环境')
      }
      await this.service.changeRuntime(async () => {
        const config = this.configuration()
        const previous = this.service.manager
        const next = this.create(config, runtime)
        let closingPrevious = false
        try {
          await next.start()
          if ((await this.file()).revision !== file.revision) {
            throw new SettingsEditError('配置文件已变化，未覆盖', 409)
          }
          const backup = join(config.dataDir, 'configuration-history/plugin-runtime')
          await mkdir(backup, { recursive: true, mode: 0o700 })
          await Bun.write(join(backup, Date.now() + '-' + crypto.randomUUID() + '.json'), file.text, {
            mode: 0o600
          })
          const temporary = file.path + '.' + crypto.randomUUID() + '.tmp'
          await Bun.write(temporary, JSON.stringify({ ...file.bot, plugins: runtime }, null, 2) + '\n', {
            mode: 0o600
          })
          closingPrevious = true
          await previous.close()
          await rename(temporary, file.path)
          this.service.manager = next
          config.bot.plugins = runtime
        } catch (error) {
          await next.close().catch(() => {})
          if (closingPrevious) {
            const restored = this.create(config, previous.config)
            try {
              await restored.start()
              this.service.manager = restored
            } catch {
              const disabled = PluginRuntimeSchema.parse({ ...previous.config, enabled: false })
              this.service.manager = this.create(config, disabled)
              config.bot.plugins = disabled
              const fallback = file.path + '.' + crypto.randomUUID() + '.tmp'
              await Bun.write(fallback, JSON.stringify({ ...file.bot, plugins: disabled }, null, 2) + '\n', {
                mode: 0o600
              })
              await rename(fallback, file.path)
              throw new Error('执行环境切换失败，恢复检查未通过，已停用插件执行并保留数据', { cause: error })
            }
          }
          throw error
        }
      })
      return this.read()
    })
  }
}
