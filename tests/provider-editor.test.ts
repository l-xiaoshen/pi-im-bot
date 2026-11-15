import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import { ProviderCatalog } from '@pi-im-bot/providers/catalog'
import { ProviderEditor, ProviderEditError } from '@pi-im-bot/providers/editor'
import { providerDraft } from '@pi-im-bot/providers/editor-contracts'
import { ProvidersConfigSchema } from '@pi-im-bot/providers/schema'
import { BotConfigSchema } from '@pi-im-bot/config/schema'
import { testFramework, testResources } from './agent-input'
import { listProviderModels, probeProviderModel } from '@pi-im-bot/providers/probe'
import { responsesReply } from './responses-fixture'

const directories: string[] = []
const servers: Array<ReturnType<typeof Bun.serve>> = []
afterEach(async () => {
  for (const server of servers.splice(0)) {
    await server.stop(true)
  }
  for (const path of directories.splice(0)) {
    await rm(path, { recursive: true, force: true })
  }
})

async function setup() {
  const directory = await mkdtemp(join(tmpdir(), 'pi-provider-editor-'))
  directories.push(directory)
  const config = ProvidersConfigSchema.parse({
    defaultGroup: 'main',
    providers: [
      {
        id: 'source',
        enabled: false,
        name: 'Original',
        baseUrl: 'https://example.com/v1',
        apiKey: 'secret-key-123',
        headers: { Authorization: 'Bearer header-secret-456', 'X-Client': 'test-client' },
        body: { vendor: { token: 'body-secret-789' }, reasoning: { effort: 'low' } },
        models: [
          { id: 'alpha', headers: { 'X-Api-Key': 'model-secret-001' }, body: { service_tier: 'priority' } }
        ]
      }
    ],
    groups: [
      { id: 'main', candidates: [{ provider: 'source', model: 'alpha' }] },
      { id: 'spare', candidates: [] }
    ]
  })
  const path = join(directory, 'providers.json')
  await writeFile(path, JSON.stringify(config))
  let current = {
    bot: BotConfigSchema.parse({}),
    catalog: await ProviderCatalog.create(config, directory),
    dataDir: directory,
    configDir: directory,
    framework: testFramework(),
    resources: testResources(),
    projectDir: directory
  }
  const usage: Record<string, string[]> = {}
  const editor = new ProviderEditor({
    configuration: () => {
      return current
    },
    apply(catalog) {
      current = { ...current, catalog }
    },
    groupUsage: () => {
      return usage
    }
  })
  return {
    editor,
    path,
    config,
    usage,
    current: () => {
      return current
    }
  }
}

async function stored(path: string) {
  return ProvidersConfigSchema.parse(JSON.parse(await readFile(path, 'utf8')))
}

describe('Provider web configuration', () => {
  test('masked credentials survive editing and provider/model renames update references', async () => {
    const { editor, path, current } = await setup()
    const view = await editor.read()
    const serialized = JSON.stringify(view)
    for (const value of ['secret-key-123', 'header-secret-456', 'body-secret-789', 'model-secret-001']) {
      expect(serialized).not.toContain(value)
    }
    const draft = providerDraft(view.providers[0])
    draft.name = 'Edited'
    draft.id = 'renamed'
    draft.models[0].id = 'alpha-v2'
    draft.headers.authorization = draft.headers.Authorization
    delete draft.headers.Authorization
    const saved = await editor.saveProvider(view.revision, draft, 'source')
    expect(saved.groups[0].candidates).toEqual([{ provider: 'renamed', model: 'alpha-v2' }])
    const disk = ProvidersConfigSchema.parse(JSON.parse(await readFile(path, 'utf8')))
    expect(disk.providers[0].apiKey).toBe('secret-key-123')
    expect(disk.providers[0].headers.authorization).toBe('Bearer header-secret-456')
    expect(disk.providers[0].body.vendor).toEqual({ token: 'body-secret-789' })
    expect(disk.providers[0].models[0].headers['X-Api-Key']).toBe('model-secret-001')
    expect(current().catalog.config.providers[0].id).toBe('renamed')
    expect(saved.applied).toBe(true)
    expect(saved.providers[0].hasApiKey).toBe(true)
    const enabled = providerDraft(saved.providers[0])
    enabled.enabled = true
    await editor.saveProvider(saved.revision, enabled, 'renamed')
    expect(current().catalog.redact('upstream echoed body-secret-789 and model-secret-001')).not.toContain(
      'secret-'
    )
  })

  test('key replacement and explicit clearing do not expose the saved value', async () => {
    const { editor, path } = await setup()
    let view = await editor.read()
    let draft = providerDraft(view.providers[0])
    draft.apiKey = 'replacement-key-321'
    view = await editor.saveProvider(view.revision, draft, draft.id)
    expect(JSON.stringify(view)).not.toContain('replacement-key-321')
    expect((await stored(path)).providers[0].apiKey).toBe('replacement-key-321')
    draft = providerDraft(view.providers[0])
    draft.clearApiKey = true
    view = await editor.saveProvider(view.revision, draft, draft.id)
    expect(view.providers[0].hasApiKey).toBe(false)
    expect((await stored(path)).providers[0].apiKey).toBeUndefined()
  })

  test('stale pages cannot overwrite a manual file edit', async () => {
    const { editor, path } = await setup()
    const view = await editor.read()
    const file = ProvidersConfigSchema.parse(JSON.parse(await readFile(path, 'utf8')))
    file.providers[0].name = 'Manual edit'
    await writeFile(path, JSON.stringify(file))
    expect((await editor.read()).applied).toBe(false)
    try {
      await editor.saveProvider(view.revision, providerDraft(view.providers[0]), 'source')
      throw new Error('Expected conflict')
    } catch (error) {
      expect(error).toBeInstanceOf(ProviderEditError)
      expect((error as ProviderEditError).status).toBe(409)
    }
    expect((await stored(path)).providers[0].name).toBe('Manual edit')
  })

  test('validation and runtime configuration failures leave the file unchanged', async () => {
    const { editor, path } = await setup()
    const original = await readFile(path, 'utf8')
    const view = await editor.read()
    const draft = providerDraft(view.providers[0])
    draft.body.model = 'not-allowed'
    await expect(editor.saveProvider(view.revision, draft, 'source')).rejects.toThrow()
    expect(await readFile(path, 'utf8')).toBe(original)
    delete draft.body.model
    draft.enabled = true
    draft.apiKeyEnv = `MISSING_PI_TEST_${crypto.randomUUID()}`
    await expect(editor.saveProvider(view.revision, draft, 'source')).rejects.toThrow(
      'Missing provider environment variable'
    )
    expect(await readFile(path, 'utf8')).toBe(original)
  })

  test('provider deletion prunes candidates and groups in use cannot be removed', async () => {
    const { editor, usage } = await setup()
    let view = await editor.read()
    usage.main = ['Test room']
    await expect(editor.deleteGroup(view.revision, 'main')).rejects.toThrow('仍用于会话')
    view = await editor.deleteProvider(view.revision, 'source')
    expect(view.providers).toHaveLength(0)
    expect(view.groups[0].candidates).toEqual([])
    expect(view.defaultGroup).toBe('main')
  })

  test('two simultaneous edits cannot silently overwrite each other', async () => {
    const { editor } = await setup()
    const view = await editor.read()
    const first = providerDraft(view.providers[0])
    const second = providerDraft(view.providers[0])
    first.name = 'First'
    second.name = 'Second'
    const results = await Promise.allSettled([
      editor.saveProvider(view.revision, first, 'source'),
      editor.saveProvider(view.revision, second, 'source')
    ])
    expect(results[0].status).toBe('fulfilled')
    expect(results[1].status).toBe('rejected')
    expect((await editor.read()).providers[0].name).toBe('First')
  })

  test('environment variable names stay editable rather than becoming masked credentials', async () => {
    const { editor } = await setup()
    let view = await editor.read()
    const draft = providerDraft(view.providers[0])
    draft.apiKeyEnv = 'MY_PROVIDER_KEY'
    view = await editor.saveProvider(view.revision, draft, 'source')
    expect(view.providers[0].apiKeyEnv).toBe('MY_PROVIDER_KEY')
  })

  test('model discovery and direct Responses tests use the draft headers and body', async () => {
    const { config } = await setup()
    const provider = config.providers[0]
    let lists = 0
    let probes = 0
    const server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      async fetch(request) {
        expect(request.headers.get('authorization')).toBe('Bearer header-secret-456')
        if (new URL(request.url).pathname === '/v1/models') {
          lists += 1
          return Response.json({ data: [{ id: 'alpha', owned_by: null }, { id: 'beta' }, { id: 'alpha' }] })
        }
        expect(new URL(request.url).pathname).toBe('/v1/responses')
        expect(request.headers.get('x-api-key')).toBe('model-secret-001')
        const body = z
          .object({
            reasoning: z.object({ effort: z.string() }),
            service_tier: z.string(),
            max_output_tokens: z.number()
          })
          .parse(await request.json())
        expect(body.reasoning.effort).toBe('low')
        expect(body.service_tier).toBe('priority')
        expect(body.max_output_tokens).toBe(256)
        probes += 1
        return responsesReply({ kind: 'text', text: 'OK' })
      }
    })
    servers.push(server)
    provider.baseUrl = `http://127.0.0.1:${server.port}/v1`
    expect(
      (await listProviderModels(provider, new AbortController().signal)).models.map((model) => {
        return model.id
      })
    ).toEqual(['alpha', 'beta'])
    const result = await probeProviderModel(provider, 'alpha', new AbortController().signal)
    expect(result.ok).toBe(true)
    expect(result.text).toBe('OK')
    expect(lists).toBe(1)
    expect(probes).toBe(1)
  })
})
