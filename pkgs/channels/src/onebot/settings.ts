import { createHash } from "node:crypto"
import { readFile, rename, writeFile, unlink } from "node:fs/promises"
import { join } from "node:path"
import { BotConfigSchema, type BotConfig } from "@pi-im-bot/config/schema"
import { OneBotSettingsInputSchema, type OneBotSettingsInput } from "./status"

export class OneBotSettingsError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 409
  ) {
    super(message)
  }
}

export class OneBotSettings {
  private queue = Promise.resolve()

  constructor(
    private readonly configDir: string,
    private readonly apply: (config: BotConfig) => void
  ) {}

  async read() {
    const { config, version } = await this.load()
    return this.publicSettings(config, version)
  }

  async save(input: OneBotSettingsInput) {
    const update = OneBotSettingsInputSchema.parse(input)
    return this.exclusive(async () => {
      const current = await this.load()
      if (current.version !== update.version) {
        throw new OneBotSettingsError("QQ 配置已被修改，请刷新后重试；当前输入未覆盖文件。", 409)
      }
      let accessToken = current.config.onebot.accessToken
      if (update.clearToken) {
        accessToken = ""
      } else if (update.accessToken) {
        accessToken = update.accessToken
      }
      const config = BotConfigSchema.parse({
        ...current.config,
        onebot: {
          ...current.config.onebot,
          enabled: update.enabled,
          commandPrefix: update.commandPrefix,
          targets: update.targets,
          mediaOrigins: update.mediaOrigins ?? current.config.onebot.mediaOrigins,
          accessToken
        }
      })
      const content = JSON.stringify(config, null, 2) + "\n"
      const path = join(this.configDir, "bot.json")
      const temporary = path + "." + crypto.randomUUID() + ".tmp"
      try {
        await writeFile(temporary, content, { mode: 0o600 })
        // Detect manual edits made while preparing the replacement as well.
        if ((await this.load()).version !== current.version) {
          throw new OneBotSettingsError("配置文件已变化，请刷新后重试。", 409)
        }
        await rename(temporary, path)
      } finally {
        await unlink(temporary).catch(() => {})
      }
      this.apply(config)
      return this.publicSettings(config, revision(content))
    })
  }

  async exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const task = this.queue.then(operation)
    this.queue = task.then(
      () => {},
      () => {}
    )
    return task
  }

  private async load() {
    const content = await readFile(join(this.configDir, "bot.json"), "utf8")
    return { config: BotConfigSchema.parse(JSON.parse(content)), version: revision(content) }
  }

  private publicSettings(config: BotConfig, version: string) {
    return {
      version,
      enabled: config.onebot.enabled,
      path: config.onebot.path,
      commandPrefix: config.onebot.commandPrefix,
      tokenConfigured: Boolean(config.onebot.accessToken),
      allowPrivate: config.onebot.allowPrivate,
      mediaOrigins: config.onebot.mediaOrigins,
      targets: config.onebot.targets
    }
  }
}

function revision(content: string) {
  return createHash("sha256").update(content).digest("hex")
}
