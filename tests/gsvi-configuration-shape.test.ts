import { expect, test } from 'bun:test'
import { PluginInstanceSchema, PluginPackageSchema } from '@pi-im-bot/plugins/config'
import { ResourcesConfigSchema } from '@pi-im-bot/resources/schema'
import { parseConfigDefinition } from '@pi-im-bot/plugins/configuration/schema'
import { fillConfigDefaults } from '@pi-im-bot/plugins/configuration/values'
import { publicConfig, applyConfigSecrets } from '@pi-im-bot/plugins/configuration/secrets'
import {
  gsviBusinessValues,
  gsviWorkerDefinition,
  migrateGsviFlat,
  restoreGsviFlat
} from '@pi-im-bot/integrations/gsvi/plugin-config/definition'
import { gsviPageValues, saveGsviPage } from '@pi-im-bot/integrations/gsvi/plugin-config/values'
import { gsviServiceHeaders } from '@pi-im-bot/integrations/gsvi/headers'

// Configuration only. No service client, network fixture, Worker or operation is invoked.
const definition = parseConfigDefinition({
  api_base: { type: 'string', default: 'http://127.0.0.1:8000' },
  api_key: { type: 'string', secret: true, default: '' },
  request_headers: { type: 'string', secret: true, default: '{}' },
  download_headers: { type: 'string', secret: true, default: '{}' },
  timeout_ms: { type: 'int', default: 180000 },
  refresh_voices: { type: 'bool', default: false },
  version: { type: 'string', default: 'v4' },
  text_lang: { type: 'string', default: '中文' },
  emotion: { type: 'string', default: '默认' },
  prompt_text_lang: { type: 'string', default: '' },
  preset: {
    type: 'object',
    items: {
      voice: { type: 'string', default: '花火' },
      max_chars: { type: 'int', default: 100 },
      probability: { type: 'int', default: 100 }
    }
  }
})
function bundle() {
  return PluginPackageSchema.parse({
    instanceId: 'configuration-only',
    revision: 'a'.repeat(64),
    configRevision: 'a'.repeat(64),
    importedAt: 0,
    files: ['plugin.json', 'index.mjs', '_conf_schema.json'].map((path) => ({
      path,
      bytes: 1,
      sha256: 'b'.repeat(64)
    })),
    configuration: definition,
    manifest: {
      id: 'configuration-only',
      name: 'Configuration only',
      description: 'Pure configuration',
      version: '0.3.0',
      apiVersion: 1,
      entry: 'index.mjs',
      files: ['index.mjs'],
      configurationProjection: 'gsvi@1',
      connections: [{ alias: 'speech', title: 'Speech', kind: 'service', service: 'gsvi@1' }]
    }
  })
}

test('GSVI page secret set/preserve/clear stays in Core and never changes disabled policy or Worker projection', () => {
  const pack = bundle()
  const instance = PluginInstanceSchema.parse({
    id: 'configuration-only',
    name: 'Configuration only',
    sourceDir: '/unused',
    enabled: false,
    settings: {}
  })
  const config = ResourcesConfigSchema.parse({ plugins: [instance] })
  const actual = config.plugins[0]
  const defaults = fillConfigDefaults(definition, {})
  saveGsviPage(config, actual, pack, {
    ...defaults,
    api_key: 'CONFIG_ONLY_KEY',
    request_headers: '{"authorization":"CONFIG_ONLY_HEADER"}',
    download_headers: '{"X-Download":"CONFIG_ONLY_DOWNLOAD"}'
  })
  const before = gsviPageValues(config, actual, pack)
  const page = publicConfig(definition, before)
  expect(JSON.stringify(page)).not.toContain('CONFIG_ONLY_')
  expect(page.secrets.filter((entry) => entry.configured)).toHaveLength(3)
  const preserve = applyConfigSecrets(definition, page.values, before, [])
  saveGsviPage(config, actual, pack, preserve)
  expect(gsviPageValues(config, actual, pack)).toEqual(before)
  const clear = applyConfigSecrets(definition, page.values, before, [
    { action: 'clear', path: '/api_key' },
    { action: 'clear', path: '/request_headers' },
    { action: 'clear', path: '/download_headers' }
  ])
  saveGsviPage(config, actual, pack, clear)
  expect(config.services[0].apiKey).toBe('')
  expect(config.services[0].nativeRequestHeaders).toEqual({})
  expect(config.services[0].nativeDownloadHeaders).toEqual({})
  expect(actual.enabled).toBe(false)
  expect(actual.settings).toEqual(gsviBusinessValues(pack, defaults))
  expect(Object.keys(gsviWorkerDefinition(pack) ?? {})).toEqual([
    'version',
    'text_lang',
    'emotion',
    'prompt_text_lang',
    'preset'
  ])
  expect(JSON.stringify(actual.settings)).not.toContain('api_')
  const untouched = { ...pack, manifest: { ...pack.manifest, configurationProjection: undefined } }
  expect(gsviWorkerDefinition(untouched)).toBe(untouched.configuration)
})

test('GSVI native page editing splits a shared service without replacing either another binding or a colliding owned ID', () => {
  const pack = bundle()
  const config = ResourcesConfigSchema.parse({
    plugins: [
      {
        id: 'configuration-only',
        name: 'Configuration',
        sourceDir: '/unused',
        services: { speech: 'shared' }
      },
      { id: 'other', name: 'Other', sourceDir: '/unused', services: { speech: 'shared' } }
    ],
    services: [{ id: 'shared', kind: 'gsvi', name: 'Shared', url: 'http://127.0.0.1:8000' }]
  })
  const original = structuredClone(config.services[0])
  saveGsviPage(config, config.plugins[0], pack, fillConfigDefaults(definition, {}))
  expect(config.services.find((entry) => entry.id === 'shared')).toEqual(original)
  const own = config.plugins[0].services.speech
  config.plugins[1].services.speech = own
  const firstOwn = structuredClone(config.services.find((entry) => entry.id === own))
  saveGsviPage(config, config.plugins[0], pack, fillConfigDefaults(definition, {}))
  expect(config.plugins[0].services.speech).not.toBe(own)
  expect(config.services.find((entry) => entry.id === own)).toEqual(firstOwn)
  const service = config.services.find((entry) => entry.id === config.plugins[0].services.speech)!
  service.apiKey = 'CONFIG_ONLY_AUTO'
  service.nativeRequestHeaders = { Authorization: 'CONFIG_ONLY_FIRST', authorization: 'CONFIG_ONLY_LAST' }
  expect(gsviServiceHeaders(service).get('Authorization')).toBe('CONFIG_ONLY_LAST')
})

test('GSVI release shape conversion preserves existing choices, thresholds and zero probability and is idempotent', () => {
  const old = {
    version: 'v2',
    voice: 'saved-choice',
    max_chars: 23,
    probability: 0,
    text_lang: '中文',
    emotion: '默认',
    prompt_text_lang: ''
  }
  const next = migrateGsviFlat(old)
  expect(next.preset).toEqual({ voice: 'saved-choice', max_chars: 23, probability: 0 })
  expect(migrateGsviFlat(next)).toEqual(next)
  expect(restoreGsviFlat(next)).toEqual(old)
  expect(old.voice).toBe('saved-choice')
})

test('source threshold 3000 remains a valid configuration without a GSVI text-length ceiling', () => {
  const pack = bundle()
  const config = ResourcesConfigSchema.parse({
    plugins: [{ id: 'configuration-only', name: 'Configuration', sourceDir: '/unused' }]
  })
  const values = fillConfigDefaults(definition, {
    preset: { voice: 'saved-choice', max_chars: 3000, probability: 100 }
  })
  saveGsviPage(config, config.plugins[0], pack, values)
  expect(config.plugins[0].settings.preset).toEqual({
    voice: 'saved-choice',
    max_chars: 3000,
    probability: 100
  })
})
