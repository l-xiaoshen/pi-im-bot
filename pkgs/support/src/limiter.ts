export class RunLimiter {
  private active = 0
  private readonly waiting: Array<{
    signal?: AbortSignal
    resolve(release: () => void): void
    reject(error: unknown): void
    abort(): void
  }> = []

  constructor(private limit: number) {}

  setLimit(limit: number) {
    this.limit = limit
    this.drain()
  }

  tryAcquire(): (() => void) | undefined {
    if (this.active >= this.limit || this.waiting.length > 0) {
      return undefined
    }
    this.active += 1
    return this.releaseSlot()
  }

  acquire(signal?: AbortSignal): Promise<() => void> {
    signal?.throwIfAborted()
    return new Promise((resolve, reject) => {
      const item = {
        signal,
        resolve,
        reject,
        abort: () => {
          const index = this.waiting.indexOf(item)
          if (index >= 0) {
            this.waiting.splice(index, 1)
            reject(signal?.reason ?? new Error('等待已取消'))
          }
        }
      }
      signal?.addEventListener('abort', item.abort, { once: true })
      this.waiting.push(item)
      this.drain()
    })
  }

  private drain() {
    while (this.active < this.limit && this.waiting.length > 0) {
      this.active += 1
      const item = this.waiting.shift()!
      item.signal?.removeEventListener('abort', item.abort)
      item.resolve(this.releaseSlot())
    }
  }

  private releaseSlot() {
    let released = false
    return () => {
      if (released) {
        return
      }
      released = true
      this.active -= 1
      this.drain()
    }
  }
}
