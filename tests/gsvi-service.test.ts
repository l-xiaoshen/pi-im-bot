import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Hono } from 'hono'
import { sValidator } from '@hono/standard-validator'
import { z } from 'zod'
import { GsviServiceSchema, GsviInputSchema } from '@pi-im-bot/integrations/gsvi/schema'
import { callGsvi } from '@pi-im-bot/integrations/gsvi/client'
import { validateWav } from '@pi-im-bot/integrations/gsvi/wav'
import { GsviDraftSchema, gsviPublic, gsviFromDraft } from '@pi-im-bot/integrations/gsvi/configuration'
import { ArtifactStore } from '@pi-im-bot/artifacts/store'
import { configureArtifacts } from '@pi-im-bot/artifacts/quota'
import { ArtifactLimitsSchema } from '@pi-im-bot/artifacts/limits'
import { wavAudio } from './wav-fixture'

interface TransportRequest {
  path: string
  auth: string | null
  download: string | null
}

test('GSVI configuration rejects case-insensitive duplicate request and download headers without exposing values', () => {
  for (const field of ['headers', 'downloadHeaders']) {
    const input = {
      id: 'case-test',
      name: 'Before',
      kind: 'gsvi',
      url: 'http://127.0.0.1:1',
      [field]: { Authorization: 'FAKE_FIRST_SENTINEL', authorization: 'FAKE_LAST_SENTINEL' }
    }
    for (const schema of [GsviServiceSchema, GsviDraftSchema]) {
      const parsed = schema.safeParse(input)
      expect(parsed.success).toBe(false)
      if (parsed.success) {
        throw new Error('Ambiguous header configuration was accepted')
      }
      expect(parsed.error.issues).toContainEqual({
        code: 'custom',
        path: [field],
        message: 'Header 名称不可重复（不区分大小写）'
      })
      expect(parsed.error.message).not.toContain('FAKE_FIRST_SENTINEL')
      expect(parsed.error.message).not.toContain('FAKE_LAST_SENTINEL')
    }
  }
})

test('GSVI public placeholder roundtrips preserve effective request and download authentication after single-header case and display-name edits', () => {
  const service = GsviServiceSchema.parse({
    id: 'case-test',
    name: 'Before',
    kind: 'gsvi',
    url: 'http://127.0.0.1:1',
    headers: { Authorization: 'FAKE_REQUEST_SENTINEL' },
    downloadHeaders: { authorization: 'FAKE_DOWNLOAD_SENTINEL' }
  })
  const { endpoint: _endpoint, state: _state, ...publicValues } = gsviPublic(service)
  const renamed = gsviFromDraft(GsviDraftSchema.parse({ ...publicValues, name: 'Renamed', url: '' }), service)
  const recased = gsviFromDraft(
    GsviDraftSchema.parse({
      ...publicValues,
      name: 'Renamed and recased',
      url: '',
      headers: { authorization: publicValues.headers.Authorization },
      downloadHeaders: { Authorization: publicValues.downloadHeaders.authorization }
    }),
    service
  )
  function effective(values: Record<string, string>) {
    const headers = new Headers()
    for (const [name, value] of Object.entries(values)) {
      headers.set(name, value)
    }
    return headers.get('authorization')
  }
  for (const restored of [renamed, recased]) {
    expect(effective(restored.headers)).toBe(effective(service.headers))
    expect(effective(restored.downloadHeaders)).toBe(effective(service.downloadHeaders))
  }
  expect(Object.keys(recased.headers)).toEqual(['authorization'])
  expect(Object.keys(recased.downloadHeaders)).toEqual(['Authorization'])
  expect(JSON.stringify(publicValues)).not.toContain('FAKE_REQUEST_SENTINEL')
  expect(JSON.stringify(publicValues)).not.toContain('FAKE_DOWNLOAD_SENTINEL')
})

test('GSVI speaks the real prefixed protocol, publishes valid audio and strips authentication at every download redirect', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-gsvi-transport-'))
  const seen: TransportRequest[] = []
  const target = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request) {
      seen.push({
        path: '/final',
        auth: request.headers.get('authorization'),
        download: request.headers.get('x-download')
      })
      return new Response(wavAudio(), { headers: { 'content-type': 'audio/wav' } })
    }
  })
  const app = new Hono()
  const PayloadSchema = z
    .object({
      version: z.literal('v4'),
      model_name: z.literal('花火'),
      text: z.literal('你好'),
      text_lang: z.literal('中文'),
      emotion: z.literal('默认'),
      dl_url: z.string(),
      media_type: z.literal('wav')
    })
    .strict()
  app.get('/prefix/models/v4', (c) => {
    expect(c.req.header('authorization')).toBe('Bearer PRIVATE_SENTINEL')
    return c.json({ models: { 花火: { 中文: ['默认'] } } })
  })
  app.post('/prefix/infer_single', sValidator('json', PayloadSchema), (c) => {
    expect(c.req.valid('json').dl_url).toEndWith('/prefix')
    seen.push({ path: 'post', auth: c.req.header('authorization') ?? null, download: null })
    return c.json({ msg: '合成成功', audio_url: 'audio' })
  })
  app.get('/prefix/audio', (c) => {
    seen.push({
      path: 'download',
      auth: c.req.header('authorization') ?? null,
      download: c.req.header('x-download') ?? null
    })
    return c.redirect('http://127.0.0.1:' + target.port + '/final', 302)
  })
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: app.fetch })
  try {
    const service = GsviServiceSchema.parse({
      id: 'speech',
      name: 'speech',
      kind: 'gsvi',
      enabled: true,
      url: 'http://127.0.0.1:' + server.port + '/prefix',
      headers: { Authorization: 'Bearer PRIVATE_SENTINEL' },
      downloadHeaders: { 'X-Download': 'PRIVATE_DOWNLOAD' },
      downloadOrigins: ['http://127.0.0.1:' + target.port]
    })
    const artifacts = new ArtifactStore(root, 'room')
    const voices = await callGsvi(
      service,
      GsviInputSchema.parse({ action: 'voices' }),
      artifacts,
      AbortSignal.timeout(3000),
      () => {}
    )
    expect(voices.status).toBe('voices')
    const result = await callGsvi(
      service,
      GsviInputSchema.parse({ action: 'synthesize', text: '你好', voice: '花火' }),
      artifacts,
      AbortSignal.timeout(3000),
      () => {}
    )
    expect(result.status).toBe('audio')
    if (result.status !== 'audio') {
      throw new Error('audio missing')
    }
    const saved = await artifacts.content(result.artifactId)
    const audio = new Uint8Array(await saved.file.arrayBuffer())
    validateWav(audio)
    expect(Buffer.from(audio).equals(wavAudio())).toBe(true)
    expect(seen).toEqual([
      { path: 'post', auth: 'Bearer PRIVATE_SENTINEL', download: null },
      { path: 'download', auth: 'Bearer PRIVATE_SENTINEL', download: 'PRIVATE_DOWNLOAD' },
      { path: '/final', auth: null, download: null }
    ])
    const view = gsviPublic(service)
    expect(JSON.stringify(view)).not.toContain('PRIVATE_SENTINEL')
    expect(JSON.stringify(view)).not.toContain('PRIVATE_DOWNLOAD')
    const { endpoint: _endpoint, state: _state, ...draft } = view
    expect(gsviFromDraft({ ...draft, url: '' }, service).headers).toEqual(service.headers)
  } finally {
    await server.stop(true)
    await target.stop(true)
    await rm(root, { recursive: true, force: true })
  }
})

test('GSVI rejects unapproved audio origins, response overflows, invalid WAV and POST redirects without leaking bodies or retrying', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-gsvi-bounds-'))
  let mode = 'origin'
  let posts = 0
  let downloads = 0
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request) {
      const url = new URL(request.url)
      if (url.pathname === '/infer_single') {
        posts += 1
        if (mode === 'redirect') {
          return Response.redirect(url.origin + '/infer_single', 307)
        }
        if (mode === 'unknown') {
          return new Response('PRIVATE_BODY http://secret.invalid', { status: 503 })
        }
        if (mode === 'origin') {
          return Response.json({ msg: '合成成功', audio_url: 'http://127.0.0.1:1/private' })
        }
        return Response.json({ msg: '合成成功', audio_url: '/audio' })
      }
      downloads += 1
      if (mode === 'overflow') {
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array(2048))
              controller.close()
            }
          }),
          { headers: { 'content-type': 'audio/wav' } }
        )
      }
      return new Response('PRIVATE_INVALID_WAV', { headers: { 'content-type': 'audio/wav' } })
    }
  })
  try {
    const service = GsviServiceSchema.parse({
      id: 'test',
      name: 'test',
      kind: 'gsvi',
      enabled: true,
      url: 'http://127.0.0.1:' + server.port
    })
    configureArtifacts(root, { ...ArtifactLimitsSchema.parse({}), maxFileBytes: 1024 })
    const input = GsviInputSchema.parse({ action: 'synthesize', text: 'hello', voice: 'test' })
    const statuses: string[] = []
    for (mode of ['origin', 'overflow', 'invalid', 'redirect', 'unknown']) {
      const result = await callGsvi(
        service,
        input,
        new ArtifactStore(root, 'room'),
        AbortSignal.timeout(3000),
        () => {}
      )
      statuses.push(result.status)
      expect(JSON.stringify(result)).not.toContain('PRIVATE')
      expect(JSON.stringify(result)).not.toContain('http:')
    }
    expect(statuses).toEqual(['failed', 'failed', 'failed', 'unknown', 'unknown'])
    expect(posts).toBe(5)
    expect(downloads).toBe(2)
    expect(() => {
      validateWav(Buffer.from('RIFFxxxxWAVE'))
    }).toThrow()
  } finally {
    await server.stop(true)
    await rm(root, { recursive: true, force: true })
  }
})
