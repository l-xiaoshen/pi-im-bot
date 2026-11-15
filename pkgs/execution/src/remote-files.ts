import { z } from 'zod'
import { posix } from 'node:path'
import { fileCommand } from './guest-files'
import { containerPath, guestPath } from './path'
import type { SandboxSession } from './session'

const DataSchema = z.object({ data: z.base64() })
const StatSchema = z.object({ directory: z.boolean() })
const ListSchema = z.object({
  entries: z.array(z.object({ name: z.string().min(1), directory: z.boolean() })).max(10000)
})
const ErrorSchema = z.object({ error: z.string(), code: z.string().optional() })
const OkSchema = z.object({ ok: z.literal(true) })

export class RemoteFiles {
  private readonly contents = new Map<string, Promise<Buffer>>()
  private readonly stats = new Map<string, boolean>()

  constructor(
    private readonly session: SandboxSession,
    private readonly signal?: AbortSignal
  ) {}

  async resolve(input: string) {
    if (input === '~' || input.startsWith('~/')) {
      return z
        .object({ path: z.string() })
        .parse(await this.call(fileCommand({ operation: 'resolve', path: input }))).path
    }
    return guestPath(input)
  }

  read(virtual: string) {
    const path = containerPath(virtual)
    let content = this.contents.get(path)
    if (!content) {
      content = this.call(
        fileCommand({ operation: 'read', path, maxBytes: this.session.config.maxFileBytes })
      ).then((value) => {
        return Buffer.from(DataSchema.parse(value).data, 'base64')
      })
      this.contents.set(path, content)
    }
    return content
  }

  async access(virtual: string) {
    await this.read(virtual)
  }

  async imageMime(virtual: string) {
    const data = await this.read(virtual)
    if (data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
      return 'image/png'
    }
    if (data[0] === 255 && data[1] === 216 && data[2] === 255) {
      return 'image/jpeg'
    }
    if (['GIF87a', 'GIF89a'].includes(data.subarray(0, 6).toString('ascii'))) {
      return 'image/gif'
    }
    if (
      data.subarray(0, 4).toString('ascii') === 'RIFF' &&
      data.subarray(8, 12).toString('ascii') === 'WEBP'
    ) {
      return 'image/webp'
    }
    if (data.subarray(0, 2).toString('ascii') === 'BM') {
      return 'image/bmp'
    }
    return undefined
  }

  async write(virtual: string, content: string) {
    const path = containerPath(virtual)
    const transfer = '.pi-transfer/' + crypto.randomUUID()
    await this.session.upload(transfer, content, this.signal)
    OkSchema.parse(
      await this.call(fileCommand({ operation: 'write', path, source: '/workspace/' + transfer }))
    )
    this.contents.delete(path)
  }

  async mkdir(virtual: string) {
    OkSchema.parse(await this.call(fileCommand({ operation: 'mkdir', path: containerPath(virtual) })))
  }

  async exists(virtual: string) {
    await this.stat(virtual)
    return true
  }

  async stat(virtual: string) {
    let directory = this.stats.get(virtual)
    if (directory === undefined) {
      directory = StatSchema.parse(
        await this.call(fileCommand({ operation: 'stat', path: containerPath(virtual) }))
      ).directory
      this.stats.set(virtual, directory)
    }
    return {
      isDirectory() {
        return directory
      }
    }
  }

  async readdir(virtual: string) {
    const entries = ListSchema.parse(
      await this.call(fileCommand({ operation: 'list', path: containerPath(virtual) }))
    ).entries
    for (const entry of entries) {
      this.stats.set(posix.join(virtual, entry.name), entry.directory)
    }
    return entries.map((entry) => {
      return entry.name
    })
  }

  private async call(command: string): Promise<unknown> {
    const result = await this.session.execute(command, this.signal)
    let body: unknown
    try {
      body = JSON.parse(result.output)
    } catch {
      throw new Error('沙盒文件操作未返回有效结果：' + (result.error ?? '请检查容器内 Node 运行时'))
    }
    if (result.exit_code !== 0) {
      const error = ErrorSchema.parse(body)
      throw new Error(error.error)
    }
    return body
  }
}
