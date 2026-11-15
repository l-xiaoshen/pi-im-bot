import { z } from 'zod'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { PluginInstallUrlSchema } from './url'
import { PluginIdSchema } from '../manifest'
import type { InstallRequestSchema } from './contracts'

const UpdateSourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('catalog'), catalogId: PluginIdSchema, packageId: PluginIdSchema }),
  z.object({ kind: z.literal('url'), url: PluginInstallUrlSchema }),
  z.object({ kind: z.literal('directory'), directory: z.string().min(1) }),
  z.object({ kind: z.literal('builtin'), builtin: PluginIdSchema }),
  z.object({ kind: z.literal('upload') })
])

export async function saveUpdateSource(
  root: string,
  id: string,
  input: z.infer<typeof InstallRequestSchema>
) {
  let source: z.infer<typeof UpdateSourceSchema> = { kind: 'upload' }
  if (input.catalogId && input.packageId) {
    source = { kind: 'catalog', catalogId: input.catalogId, packageId: input.packageId }
  } else if (input.url) {
    source = { kind: 'url', url: input.url }
  } else if (input.directory) {
    source = { kind: 'directory', directory: input.directory }
  } else if (input.builtin) {
    source = { kind: 'builtin', builtin: input.builtin }
  }
  const directory = join(root, 'update-sources', id)
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const sourceId = crypto.randomUUID()
  await Bun.write(join(directory, sourceId + '.json'), JSON.stringify(source), {
    mode: 0o600,
    createPath: false
  })
  return sourceId
}

export async function readUpdateSource(root: string, id: string, sourceId: string) {
  const file = Bun.file(join(root, 'update-sources', id, sourceId + '.json'))
  if (!(await file.exists())) {
    return undefined
  }
  const source = UpdateSourceSchema.parse(await file.json())
  if (source.kind === 'catalog') {
    return { catalogId: source.catalogId, packageId: source.packageId }
  }
  if (source.kind === 'url') {
    return { url: source.url }
  }
  if (source.kind === 'directory') {
    return { directory: source.directory }
  }
  if (source.kind === 'builtin') {
    return { builtin: source.builtin }
  }
  return undefined
}
