import { expect, test } from 'bun:test'
import { mkdtemp, rm, open, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { ArtifactBudget, artifactBudget, configureArtifacts } from '@pi-im-bot/artifacts/quota'
import { ArtifactLimitsSchema } from '@pi-im-bot/artifacts/limits'
import { ArtifactStore } from '@pi-im-bot/artifacts/store'

test('reservations limit concurrent and per-producer writes, survive reload, and cancelled file copies release their reservation', async () => {
  const root = await mkdtemp('/tmp/pi-artifact-budget-')
  const limits = ArtifactLimitsSchema.parse({
    maxFileBytes: 8192,
    maxScopeBytes: 8192,
    maxProducerBytes: 8192,
    maxTotalBytes: 16384,
    maxScopeItems: 3,
    maxProducerItems: 3,
    maxTotalItems: 6,
    maxPending: 2
  })
  try {
    configureArtifacts(root, limits)
    const first = new ArtifactStore(root, 'group', undefined, 'plugin:first')
    const writes = await Promise.allSettled([
      first.save('a', 'application/octet-stream', 'fixture', Buffer.alloc(8192)),
      first.save('b', 'application/octet-stream', 'fixture', Buffer.alloc(8192))
    ])
    expect(
      writes.filter((item) => {
        return item.status === 'fulfilled'
      })
    ).toHaveLength(1)
    expect((await artifactBudget(root).status()).bytes).toBe(8192)
    await expect(
      new ArtifactStore(root, 'other', undefined, 'plugin:first').save(
        'blocked',
        'text/plain',
        'fixture',
        'x'
      )
    ).rejects.toThrow('额度')
    const other = new ArtifactStore(root, 'other', undefined, 'plugin:second')
    const path = join(root, 'input.bin')
    await Bun.write(path, Buffer.alloc(1024))
    const file = await open(path, 'r')
    const cancelled = new AbortController()
    const read = file.read.bind(file)
    Object.defineProperty(file, 'read', {
      value: async (buffer: Uint8Array, offset: number, length: number, position: number) => {
        const result = await read(buffer, offset, length, position)
        cancelled.abort(new Error('cancel copy'))
        return result
      }
    })
    try {
      await expect(
        other.saveFile('cancelled', 'application/octet-stream', 'fixture', file, cancelled.signal)
      ).rejects.toThrow('cancel copy')
    } finally {
      await file.close()
    }
    expect((await artifactBudget(root).status()).pending).toBe(0)
    await other.save('ok', 'text/plain', 'fixture', 'x')
    const restored = new ArtifactBudget(join(root, 'artifacts'), limits)
    expect((await restored.status()).bytes).toBe(8193)
    expect((await restored.status()).items).toBe(2)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('interrupted artifact staging is recovered without leaving phantom bytes or published metadata', async () => {
  const root = await mkdtemp('/tmp/pi-artifact-recovery-')
  const limits = ArtifactLimitsSchema.parse({})
  const directory = join(root, 'artifacts')
  const scope = createHash('sha256').update('group').digest('hex').slice(0, 24)
  const id = crypto.randomUUID()
  try {
    const budget = new ArtifactBudget(directory, limits)
    await budget.reserve(scope, id, 4096, 'job:interrupted')
    await mkdir(join(directory, scope), { recursive: true })
    await Bun.write(join(directory, scope, id + '.tmp'), Buffer.alloc(1024))
    const recovered = new ArtifactBudget(directory, limits)
    expect((await recovered.status()).bytes).toBe(0)
    expect((await recovered.status()).items).toBe(0)
    expect(await Bun.file(join(directory, scope, id + '.tmp')).exists()).toBe(false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
