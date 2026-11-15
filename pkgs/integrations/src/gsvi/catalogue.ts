import { z } from 'zod'
import { createHash } from 'node:crypto'
import type { ArtifactStore } from '@pi-im-bot/artifacts/store'
import type { GsviService } from './schema'
import { GsviModelsSchema, GsviVersionSchema } from './schema'
import { gsviExecutionRevision } from './identity'
import { pythonCompare } from './unicode'
import { GsviCatalogueSchema, GsviCatalogueReadSchema, GsviCataloguePageSchema } from './catalogue-contract'
export async function catalogueReference(
  artifacts: ArtifactStore,
  instance: string,
  service: GsviService,
  version: z.infer<typeof GsviVersionSchema>,
  models: z.infer<typeof GsviModelsSchema>['models'],
  authorize: () => void
) {
  authorize()
  const json = JSON.stringify({ models })
  const hash = createHash('sha256').update(json).digest('hex')
  const owned = artifacts.forOwner(
    'gsvi-catalogue:' + instance + ':' + gsviExecutionRevision(service) + ':' + version + ':' + hash
  )
  const saved = await owned.owned(
    'gsvi-catalogue:' + instance + ':' + gsviExecutionRevision(service) + ':' + version + ':' + hash
  )
  let model = saved.find((entry) => entry.source === 'gsvi-catalogue:models:' + version)
  let list = saved.find((entry) => entry.source === 'gsvi-catalogue:names:' + version)
  const names = Object.keys(models).sort(pythonCompare)
  if (!model) {
    model = await owned.save(
      'gsvi-models-' + version + '.json',
      'application/json',
      'gsvi-catalogue:models:' + version,
      json
    )
  }
  if (!list) {
    list = await owned.save(
      'gsvi-names-' + version + '.txt',
      'text/plain',
      'gsvi-catalogue:names:' + version,
      names.join('\n')
    )
  }
  authorize()
  return GsviCatalogueSchema.parse({
    status: 'catalogue',
    reference: model.id,
    listReference: list.id,
    count: names.length,
    version
  })
}
export async function readCatalogue(
  artifacts: ArtifactStore,
  instance: string,
  service: GsviService,
  input: z.infer<typeof GsviCatalogueReadSchema>,
  signal: AbortSignal,
  authorize: () => void
) {
  authorize()
  signal.throwIfAborted()
  const { metadata, file } = await artifacts.content(input.reference)
  const access = metadata.access?.plugin
  if (
    !access ||
    access.instanceId !== instance ||
    !Object.values(access.services).some(
      (entry) => entry.id === service.id && entry.revision === gsviExecutionRevision(service)
    ) ||
    !metadata.source.startsWith('gsvi-catalogue:')
  ) {
    throw new Error('目录引用不属于原实例/服务版本')
  }
  if (input.action === 'page') {
    if (input.offset > metadata.bytes) {
      throw new Error('目录偏移超出范围')
    }
    const bytes = Buffer.from(await file.slice(input.offset, input.offset + 49152).arrayBuffer())
    authorize()
    signal.throwIfAborted()
    return GsviCataloguePageSchema.parse({
      offset: input.offset,
      nextOffset: input.offset + bytes.length,
      bytes: metadata.bytes,
      base64: bytes.toString('base64'),
      hasMore: input.offset + bytes.length < metadata.bytes
    })
  }
  if (!metadata.source.startsWith('gsvi-catalogue:models:')) {
    throw new Error('选择需要原模型目录引用')
  }
  const { models } = GsviModelsSchema.parse(JSON.parse(await file.text()))
  authorize()
  signal.throwIfAborted()
  const entry = models[input.voice]
  return {
    exists: entry !== undefined,
    emotion: entry !== undefined && Object.values(entry).some((list) => list.includes(input.emotion))
  }
}
