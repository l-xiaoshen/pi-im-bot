import { mkdir } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { BotConfigSchema } from './schema'
import { ProvidersConfigSchema } from '@pi-im-bot/providers/schema'
import { ProviderCatalog } from '@pi-im-bot/providers/catalog'
import { FrameworkConfigSchema } from '@pi-im-bot/settings/schema'
import { initialFramework } from '@pi-im-bot/settings/resolve'
import { ResourcesConfigSchema } from '@pi-im-bot/resources/schema'
import { ResourceLibrary } from '@pi-im-bot/resources/library'

export async function loadConfiguration(projectDir = process.cwd()) {
  const configDir = resolve(process.env.BOT_CONFIG_DIR ?? join(projectDir, 'config'))
  const dataDir = resolve(process.env.BOT_DATA_DIR ?? join(projectDir, 'data'))
  const examplesDir = resolve(process.env.BOT_EXAMPLES_DIR ?? join(projectDir, 'config'))
  await mkdir(dataDir, { recursive: true })
  await mkdir(configDir, { recursive: true })
  for (const name of ['bot', 'providers']) {
    const target = Bun.file(join(configDir, `${name}.json`))
    if (!(await target.exists())) {
      await Bun.write(target, await Bun.file(join(examplesDir, `${name}.example.json`)).text())
    }
  }
  const bot = BotConfigSchema.parse(await readJson(join(configDir, 'bot.json')))
  const providers = ProvidersConfigSchema.parse(await readJson(join(configDir, 'providers.json')))
  const catalog = await ProviderCatalog.create(providers)
  const frameworkFile = Bun.file(join(configDir, 'framework.json'))
  if (!(await frameworkFile.exists())) {
    await Bun.write(
      frameworkFile,
      JSON.stringify(initialFramework(bot, providers.defaultGroup), null, 2) + '\n',
      { mode: 0o600 }
    )
  }
  const framework = FrameworkConfigSchema.parse(await readJson(frameworkFile.name!))
  const resourcesFile = Bun.file(join(configDir, 'resources.json'))
  if (!(await resourcesFile.exists())) {
    await Bun.write(resourcesFile, JSON.stringify(ResourcesConfigSchema.parse({}), null, 2) + '\n', {
      mode: 0o600
    })
  }
  const resources = await ResourceLibrary.load(
    ResourcesConfigSchema.parse(await readJson(resourcesFile.name!)),
    dataDir
  )
  return { bot, catalog, framework, resources, configDir, dataDir, projectDir }
}
export type Configuration = Awaited<ReturnType<typeof loadConfiguration>>

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await Bun.file(path).text())
  } catch {
    throw new Error(`Invalid or unreadable JSON configuration: ${path}`)
  }
}
