import { z } from 'zod'
import { join } from 'node:path'
import { mkdir, rename, unlink } from 'node:fs/promises'
import { revision } from '@pi-im-bot/settings/resolve'
import type { Configuration } from '@pi-im-bot/config/load'
import { callGsvi } from '../client'
import { ArtifactStore } from '@pi-im-bot/artifacts/store'
import { gsviExecutionRevision } from '../identity'
import { usesGsviConfiguration } from './definition'
import { localIdentity } from '@pi-im-bot/permissions/identity'
import { isAllowed } from '@pi-im-bot/permissions/authorize'
import { pythonCompare } from '../unicode'
const CacheSchema = z.object({
  source: z.string(),
  choices: z.array(z.string().min(1)),
  status: z.string().max(300)
})
function location(config: Configuration, id: string) {
  return join(config.dataDir, 'resources/gsvi-choices', id + '.json')
}
function source(url: string, version: unknown) {
  return revision([url.replace(/\/$/u, ''), version])
}
export async function gsviChoiceState(config: Configuration, id: string) {
  const instance = config.resources.config.plugins.find((entry) => entry.id === id)
  const bundle = config.resources.pluginPackage(id)
  const empty = { voiceChoices: [] as string[], voiceHint: '尚无缓存，可手动填写；disabled时不会请求上游。' }
  if (!instance || !bundle || !usesGsviConfiguration(bundle)) {
    return empty
  }
  const file = Bun.file(location(config, id))
  if (
    !(await file.exists()) ||
    file.size > new ArtifactStore(config.dataDir, 'gsvi-configuration:' + id).maximumFileBytes
  ) {
    return empty
  }
  const cache = CacheSchema.safeParse(await file.json().catch(() => null))
  const service = config.resources.config.services.find((entry) => entry.id === instance.services.speech)
  if (!cache.success || !service || cache.data.source !== source(service.url, instance.settings.version)) {
    return empty
  }
  return { voiceChoices: cache.data.choices, voiceHint: cache.data.status }
}
/** Called only by managed save/enable/initialization paths; no import timer or detached Promise. */
export async function refreshGsviChoices(
  configuration: () => Configuration,
  id: string,
  parent: AbortSignal
) {
  const config = configuration()
  const instance = config.resources.config.plugins.find((entry) => entry.id === id)
  const bundle = config.resources.pluginPackage(id)
  if (
    !instance ||
    !bundle ||
    !usesGsviConfiguration(bundle) ||
    !instance.enabled ||
    !config.bot.plugins.enabled
  ) {
    return { executed: false, reason: 'disabled' }
  }
  const service = config.resources.config.services.find((entry) => entry.id === instance.services.speech)
  if (!service?.enabled) {
    return { executed: false, reason: 'unbound' }
  }
  const version = z.enum(['v1', 'v2', 'v4']).parse(instance.settings.version)
  const expected = gsviExecutionRevision(service)
  function authorize() {
    parent.throwIfAborted()
    const live = configuration()
    const now = live.resources.config.plugins.find((entry) => entry.id === id)
    const current = live.resources.config.services.find((entry) => entry.id === service!.id)
    if (
      !live.bot.plugins.enabled ||
      !now?.enabled ||
      now.release !== instance!.release ||
      now.settings.version !== version ||
      now.services.speech !== service!.id ||
      !current?.enabled ||
      gsviExecutionRevision(current) !== expected ||
      !now.grants.includes('service:speech') ||
      !isAllowed(live.framework.defaults, localIdentity('web', 'operator'), 'tts_voices')
    ) {
      throw new Error('GSVI配置刷新权限或绑定已改变')
    }
  }
  const path = location(config, id)
  const original = CacheSchema.safeParse(
    await Bun.file(path)
      .json()
      .catch(() => null)
  )
  try {
    authorize()
    const result = await callGsvi(
      service,
      { action: 'voices', version },
      new ArtifactStore(config.dataDir, 'gsvi-configuration:' + id),
      AbortSignal.any([parent, AbortSignal.timeout(Math.min(10000, service.timeoutMs))]),
      authorize
    )
    if (result.status !== 'voices') {
      throw new Error('refresh failed')
    }
    const choices = Object.keys(result.models).sort(pythonCompare)
    if (!choices.length) {
      throw new Error('refresh choices outside budget')
    }
    authorize()
    const record = CacheSchema.parse({
      source: source(service.url, version),
      choices,
      status: '已加载音色缓存，重新打开配置查看。'
    })
    await mkdir(join(config.dataDir, 'resources/gsvi-choices'), { recursive: true, mode: 0o700 })
    await writeCache(path, record, authorize)
    return { executed: true, success: true }
  } catch {
    try {
      authorize()
      let choices: string[] = []
      if (original.success && original.data.source === source(service.url, version)) {
        choices = original.data.choices
      }
      await mkdir(join(config.dataDir, 'resources/gsvi-choices'), { recursive: true, mode: 0o700 })
      await writeCache(
        path,
        {
          source: source(service.url, version),
          choices,
          status: '刷新失败或超时；保留已有列表和当前选择，空缓存可手填。'
        },
        authorize
      )
    } catch {}
    return { executed: true, success: false, retainedCache: original.success }
  }
}

async function writeCache(path: string, record: z.infer<typeof CacheSchema>, authorize: () => void) {
  const temp = path + '.' + crypto.randomUUID() + '.tmp'
  try {
    await Bun.write(temp, JSON.stringify(record) + '\n', { mode: 0o600 })
    authorize()
    await rename(temp, path)
  } finally {
    await unlink(temp).catch(() => {})
  }
}
