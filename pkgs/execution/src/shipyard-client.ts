import { z } from 'zod'
import type { ShipyardConfig } from './config'

const IdSchema = z.string().regex(/^[a-zA-Z0-9_-]+$/u)
export const SandboxSchema = z.object({
  id: IdSchema,
  cargo_id: IdSchema,
  profile: z.string(),
  status: z.enum(['idle', 'starting', 'ready', 'failed', 'expired']),
  capabilities: z.array(z.string())
})
export type Sandbox = z.infer<typeof SandboxSchema>
const ShellResultSchema = z.object({
  success: z.boolean(),
  output: z.string(),
  error: z.string().nullable().optional(),
  exit_code: z.number().int().nullable()
})
const ErrorSchema = z.object({ error: z.object({ code: z.string() }) })

export class ShipyardError extends Error {
  constructor(
    readonly status: number,
    code: string
  ) {
    super('Shipyard 请求失败：HTTP ' + status + ' (' + code + ')')
  }
}

export class ShipyardClient {
  readonly endpoint: string
  private readonly key: string | undefined

  constructor(readonly config: ShipyardConfig) {
    this.endpoint = config.endpoint.replace(/\/+$/u, '')
    this.key = config.apiKey
    if (config.apiKeyEnv) {
      this.key = process.env[config.apiKeyEnv]
      if (!this.key) {
        throw new Error('缺少 Shipyard API Key 环境变量：' + config.apiKeyEnv)
      }
    }
  }

  async create(profile: string, requestId: string) {
    return SandboxSchema.parse(
      await this.json('/v1/sandboxes', {
        method: 'POST',
        headers: { 'Idempotency-Key': requestId },
        body: JSON.stringify({ profile, ttl: 0 })
      })
    )
  }

  async get(id: string) {
    return SandboxSchema.parse(await this.json('/v1/sandboxes/' + IdSchema.parse(id)))
  }

  async stop(id: string) {
    z.object({ status: z.literal('stopped') }).parse(
      await this.json('/v1/sandboxes/' + IdSchema.parse(id) + '/stop', { method: 'POST' })
    )
  }

  async interrupt(id: string) {
    // Bay stop grants the container a shutdown grace period. Terminate the
    // execution user's processes first; this sandbox belongs to one Bot room.
    await this.shell(id, 'kill -KILL -- -1', AbortSignal.timeout(5000), 3)
  }

  async shell(id: string, command: string, signal: AbortSignal, seconds: number) {
    return ShellResultSchema.parse(
      await this.json(
        '/v1/sandboxes/' + IdSchema.parse(id) + '/shell/exec',
        {
          method: 'POST',
          signal,
          body: JSON.stringify({ command, timeout: seconds, cwd: null })
        },
        seconds * 1000 + this.config.timeoutMs,
        this.config.maxFileBytes * 2 + 65536
      )
    )
  }

  async upload(id: string, path: string, content: string | Uint8Array, signal: AbortSignal) {
    if (Buffer.byteLength(content) > this.config.maxFileBytes) {
      throw new Error('文件超过当前传输上限')
    }
    const form = new FormData()
    form.append('path', path)
    let bytes: string | Uint8Array<ArrayBuffer> = ''
    if (typeof content === 'string') {
      bytes = content
    } else {
      bytes = new Uint8Array(content)
    }
    form.append('file', new Blob([bytes]), 'transfer')
    z.object({ status: z.literal('ok') }).parse(
      await this.json('/v1/sandboxes/' + IdSchema.parse(id) + '/filesystem/upload', {
        method: 'POST',
        body: form,
        signal
      })
    )
  }

  private async json(
    path: string,
    init: RequestInit = {},
    timeoutMs = this.config.timeoutMs,
    maximum = 2 * 1024 * 1024
  ): Promise<unknown> {
    const headers = new Headers(init.headers)
    headers.set('accept', 'application/json')
    if (typeof init.body === 'string') {
      headers.set('content-type', 'application/json')
    }
    if (this.key) {
      headers.set('authorization', 'Bearer ' + this.key)
    }
    const signals = [AbortSignal.timeout(timeoutMs)]
    if (init.signal) {
      signals.push(init.signal)
    }
    const response = await fetch(this.endpoint + path, {
      ...init,
      headers,
      signal: AbortSignal.any(signals),
      redirect: 'error'
    })
    if (!response.ok) {
      let code = 'upstream_error'
      try {
        const body = ErrorSchema.safeParse(JSON.parse((await readBounded(response, 8192)).toString('utf8')))
        if (body.success && /^[a-z_]{1,80}$/u.test(body.data.error.code)) {
          code = body.data.error.code
        }
      } catch {
        // Never expose an untrusted upstream error body or authentication header.
      }
      throw new ShipyardError(response.status, code)
    }
    return JSON.parse((await readBounded(response, maximum)).toString('utf8'))
  }
}

async function readBounded(response: Response, maximum: number) {
  const reader = response.body?.getReader()
  if (!reader) {
    return Buffer.alloc(0)
  }
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) {
        break
      }
      total += chunk.value.byteLength
      if (total > maximum) {
        throw new Error('Shipyard 返回内容超过传输上限')
      }
      chunks.push(chunk.value)
    }
    return Buffer.concat(chunks, total)
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}
