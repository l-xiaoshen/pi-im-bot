import { z } from 'zod'
import { createHash } from 'node:crypto'
import { mkdir, readdir, open, rename, unlink, type FileHandle } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { artifactBudget } from './quota'
import { ArtifactAccessSchema, type ArtifactAccess } from './access'

export const ArtifactSchema = z.object({
  id: z.uuid(),
  roomId: z.string(),
  name: z.string(),
  mimeType: z.string(),
  bytes: z.number().int().nonnegative(),
  createdAt: z.number(),
  source: z.string(),
  owner: z.string().optional(),
  access: ArtifactAccessSchema.optional(),
  sha256: z.string()
})
export type Artifact = z.infer<typeof ArtifactSchema>
const ArtifactIdSchema = z.uuid()

export class ArtifactStore {
  get maximumFileBytes() {
    return artifactBudget(this.dataDir).maximumFileBytes
  }
  private readonly directory: string
  private readonly scope: string
  constructor(
    private readonly dataDir: string,
    private readonly roomId: string,
    private readonly owner?: string,
    private readonly producer?: string,
    private readonly access?: () => ArtifactAccess,
    private readonly readAccess?: (access: ArtifactAccess) => void
  ) {
    this.scope = createHash('sha256').update(roomId).digest('hex').slice(0, 24)
    this.directory = join(dataDir, 'artifacts', this.scope)
  }

  forOwner(owner: string) {
    return new ArtifactStore(this.dataDir, this.roomId, owner, this.producer, this.access, this.readAccess)
  }

  async save(
    name: string,
    mimeType: string,
    source: string,
    content: string | Uint8Array
  ): Promise<Artifact> {
    const data = Buffer.from(content)
    return this.persist(name, mimeType, source, data.byteLength, async (path) => {
      const file = await open(path, 'wx', 0o600)
      try {
        await file.writeFile(data)
        await file.sync()
      } finally {
        await file.close()
      }
      return createHash('sha256').update(data).digest('hex')
    })
  }

  async saveFile(name: string, mimeType: string, source: string, file: FileHandle, signal: AbortSignal) {
    const before = await file.stat()
    if (!before.isFile()) {
      throw new Error('产物来源必须是普通文件')
    }
    return this.persist(
      name,
      mimeType,
      source,
      before.size,
      async (path) => {
        const target = await open(path, 'wx', 0o600)
        const hash = createHash('sha256')
        const buffer = Buffer.alloc(65536)
        let offset = 0
        try {
          while (offset < before.size) {
            signal.throwIfAborted()
            const chunk = await file.read(buffer, 0, Math.min(buffer.length, before.size - offset), offset)
            if (chunk.bytesRead === 0) {
              throw new Error('发布期间文件缩短，未保存不完整产物')
            }
            const bytes = buffer.subarray(0, chunk.bytesRead)
            await target.writeFile(bytes)
            hash.update(bytes)
            offset += chunk.bytesRead
          }
          const after = await file.stat()
          signal.throwIfAborted()
          if (
            after.size !== before.size ||
            after.mtimeMs !== before.mtimeMs ||
            after.ctimeMs !== before.ctimeMs
          ) {
            throw new Error('发布期间文件发生变化，请关闭写入后再发布')
          }
          await target.sync()
        } finally {
          await target.close()
        }
        return hash.digest('hex')
      },
      signal
    )
  }

  private async persist(
    name: string,
    mimeType: string,
    source: string,
    bytes: number,
    write: (path: string) => Promise<string>,
    signal?: AbortSignal
  ): Promise<Artifact> {
    this.access?.()
    const id = crypto.randomUUID()
    let producer = this.producer ?? 'core'
    if (!this.producer && /^(?:plugin|mcp):/u.test(source)) {
      producer = source.split('/')[0]
    }
    const reservation = await artifactBudget(this.dataDir).reserve(
      this.scope,
      id,
      bytes,
      this.owner,
      producer,
      signal
    )
    const temporary = join(this.directory, id + '.tmp')
    const binary = join(this.directory, id + '.bin')
    const metadataPath = join(this.directory, id + '.json')
    const cleanup = [temporary, binary, metadataPath, metadataPath + '.tmp']
    try {
      await mkdir(this.directory, { recursive: true, mode: 0o700 })
      signal?.throwIfAborted()
      const sha256 = await write(temporary)
      signal?.throwIfAborted()
      await rename(temporary, binary)
      const metadata: Artifact = {
        id,
        roomId: this.roomId,
        name: name.slice(0, 240),
        mimeType: mimeType.slice(0, 100),
        source: source.slice(0, 512),
        owner: this.owner,
        bytes,
        createdAt: Date.now(),
        sha256,
        access: this.access?.()
      }
      if (this.owner) {
        const directory = this.ownerDirectory(this.owner)
        await mkdir(directory, { recursive: true })
        cleanup.push(join(directory, id + '.json'), join(directory, id + '.json.tmp'))
        await this.atomicMetadata(join(directory, id + '.json'), metadata)
      }
      await this.atomicMetadata(metadataPath, metadata)
      await reservation.commit()
      return metadata
    } catch (error) {
      for (const path of cleanup) {
        await unlink(path).catch((cause) => {
          if (!z.object({ code: z.literal('ENOENT') }).safeParse(cause).success) {
            throw cause
          }
        })
      }
      await reservation.cancel()
      throw error
    }
  }

  private async atomicMetadata(path: string, metadata: Artifact) {
    const file = await open(path + '.tmp', 'wx', 0o600)
    try {
      await file.writeFile(JSON.stringify(metadata))
      await file.sync()
    } finally {
      await file.close()
    }
    await rename(path + '.tmp', path)
    const directory = await open(dirname(path), 'r')
    try {
      await directory.sync()
    } finally {
      await directory.close()
    }
  }

  private ownerDirectory(owner: string) {
    return join(this.directory, 'owners', createHash('sha256').update(owner).digest('hex'))
  }

  async owned(owner: string) {
    const directory = this.ownerDirectory(owner)
    let names: string[]
    try {
      names = await readdir(directory)
    } catch (error) {
      if (z.object({ code: z.literal('ENOENT') }).safeParse(error).success) {
        return []
      }
      throw error
    }
    const artifacts: Artifact[] = []
    for (const name of names) {
      const metadata = ArtifactSchema.parse(await Bun.file(join(directory, name)).json())
      if (metadata.roomId !== this.roomId || metadata.owner !== owner) {
        throw new Error('产物归属校验失败')
      }
      artifacts.push(metadata)
    }
    return artifacts.sort((a, b) => {
      return a.createdAt - b.createdAt
    })
  }

  async metadata(id: string) {
    ArtifactIdSchema.parse(id)
    const metadataFile = Bun.file(join(this.directory, id + '.json'))
    if (!(await metadataFile.exists())) {
      throw new Error('当前聊天范围中不存在该产物')
    }
    const metadata = ArtifactSchema.parse(await metadataFile.json())
    if (metadata.roomId !== this.roomId) {
      throw new Error('产物不属于当前聊天范围')
    }
    if (metadata.access) {
      this.readAccess?.(metadata.access)
    }
    return metadata
  }

  async content(id: string) {
    const metadata = await this.metadata(id)
    const file = Bun.file(join(this.directory, id + '.bin'))
    if (!(await file.exists())) {
      throw new Error('产物内容不可读取')
    }
    return { metadata, file }
  }

  async readText(id: string, offset: number, limit: number) {
    const metadata = await this.metadata(id)
    if (!metadata.mimeType.startsWith('text/') && metadata.mimeType !== 'application/json') {
      throw new Error('此产物不是文本')
    }
    let text: string
    try {
      text = await Bun.file(join(this.directory, id + '.bin')).text()
    } catch {
      throw new Error('产物内容不可读取')
    }
    if (metadata.access) {
      this.readAccess?.(metadata.access)
    }
    return {
      artifact: metadata,
      offset,
      text: text.slice(offset, offset + limit),
      totalChars: text.length,
      hasMore: text.length > offset + limit
    }
  }
}
