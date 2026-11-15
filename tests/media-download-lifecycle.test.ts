import { expect, test } from 'bun:test'
import { jobHarness, untilJob } from './job-harness'
import { responsesReply } from './responses-fixture'
import { createMockAdapter } from '@pi-im-bot/channels/mock'

test('shared media downloads coalesce readers, isolate cancellation and stop the underlying request only after the last reader leaves', async () => {
  const app = await jobHarness(() => {
    return responsesReply({ kind: 'text', text: 'unused' })
  })
  let calls = 0
  let aborted = false
  let gate = Promise.withResolvers<void>()
  app.channels.register({
    ...createMockAdapter(),
    async readMedia(_address, _record, signal) {
      calls += 1
      signal.addEventListener(
        'abort',
        () => {
          aborted = true
        },
        { once: true }
      )
      await gate.promise
      signal.throwIfAborted()
      return { data: Buffer.from('actual bytes'), mimeType: 'text/plain' }
    }
  })
  function capture() {
    return app.media.capture(app.room, crypto.randomUUID(), {
      type: 'file',
      name: 'file.txt',
      reference: { id: 'private' }
    }).mediaId!
  }
  try {
    const id = capture()
    const cancelled = new AbortController()
    const first = app.media.resolve(app.room, id, cancelled.signal)
    const second = app.media.resolve(app.room, id, AbortSignal.timeout(3000))
    cancelled.abort()
    await expect(first).rejects.toThrow()
    expect(aborted).toBe(false)
    gate.resolve()
    expect(await (await second).file.text()).toBe('actual bytes')
    expect(calls).toBe(1)
    gate = Promise.withResolvers<void>()
    const next = capture()
    const last = new AbortController()
    const pending = app.media.resolve(app.room, next, last.signal)
    await untilJob(() => {
      return calls === 2
    }, 'second download not dispatched')
    last.abort()
    await expect(pending).rejects.toThrow()
    expect(aborted).toBe(true)
    gate.resolve()
    await Bun.sleep(10)
    expect(app.store.getMedia(next)?.error).toBeUndefined()
    expect(await (await app.media.resolve(app.room, next, AbortSignal.timeout(3000))).file.text()).toBe(
      'actual bytes'
    )
    expect(calls).toBe(3)
  } finally {
    gate.resolve()
    await app.close()
  }
})

test('media downloads preserve the two-request limit and source expiry requires an explicit retry', async () => {
  const app = await jobHarness(() => {
    return responsesReply({ kind: 'text', text: 'unused' })
  })
  let active = 0
  let peak = 0
  let calls = 0
  let expired = true
  app.channels.register({
    ...createMockAdapter(),
    async readMedia(_address, record) {
      calls += 1
      active += 1
      peak = Math.max(peak, active)
      try {
        await Bun.sleep(15)
        if (record.reference.id === 'expired' && expired) {
          throw new Error('PRIVATE_DOWNLOAD_URL')
        }
        return { data: Buffer.from('bounded'), mimeType: 'text/plain' }
      } finally {
        active -= 1
      }
    }
  })
  try {
    const records = Array.from({ length: 5 }, (_, index) => {
      return app.media.capture(app.room, crypto.randomUUID(), {
        type: 'file',
        name: 'item',
        reference: { id: String(index) }
      }).mediaId!
    })
    await Promise.all(
      records.map((id) => {
        return app.media.resolve(app.room, id, AbortSignal.timeout(3000))
      })
    )
    expect(peak).toBe(2)
    expect(calls).toBe(5)
    const id = app.media.capture(app.room, crypto.randomUUID(), {
      type: 'file',
      name: 'expired',
      reference: { id: 'expired' }
    }).mediaId!
    await expect(app.media.resolve(app.room, id, AbortSignal.timeout(3000))).rejects.toThrow('过期')
    expired = false
    await expect(app.media.resolve(app.room, id, AbortSignal.timeout(3000))).rejects.toThrow('过期')
    expect(calls).toBe(6)
    expect(app.store.getMedia(id)?.error).not.toContain('PRIVATE')
    app.media.retry(app.room.id, id)
    expect(await (await app.media.resolve(app.room, id, AbortSignal.timeout(3000))).file.text()).toBe(
      'bounded'
    )
    expect(calls).toBe(7)
  } finally {
    await app.close()
  }
})
