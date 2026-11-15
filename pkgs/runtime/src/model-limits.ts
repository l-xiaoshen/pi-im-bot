type Lane = 'root' | 'background'
interface Waiting {
  scope: string
  lane: Lane
  resolve(release: () => void): void
  reject(error: unknown): void
  signal?: AbortSignal
  abort(): void
}

/** Models occupy permits only while requesting an LLM, never while awaiting external tools. */
export class ModelLimits {
  private active = 0
  private background = 0
  private readonly scopes = new Map<string, { root: number; background: number }>()
  private readonly waiting: Waiting[] = []

  constructor(private readonly limit: () => number) {}

  acquire(scope: string, lane: Lane, signal?: AbortSignal): Promise<() => void> {
    signal?.throwIfAborted()
    return new Promise((resolve, reject) => {
      const waiting: Waiting = {
        scope,
        lane,
        signal,
        resolve,
        reject,
        abort: () => {
          const index = this.waiting.indexOf(waiting)
          if (index >= 0) {
            this.waiting.splice(index, 1)
            reject(signal?.reason ?? new Error('模型请求已取消'))
          }
        }
      }
      signal?.addEventListener('abort', waiting.abort, { once: true })
      this.waiting.push(waiting)
      this.drain()
    })
  }

  drain() {
    const limit = Math.max(1, this.limit())
    while (this.active < limit) {
      const eligible = (item: Waiting) => {
        const scope = this.scopes.get(item.scope)
        if (item.lane === 'root') {
          return !scope?.root
        }
        return !scope?.background && this.background < Math.max(1, limit - 1)
      }
      let index = this.waiting.findIndex((item) => {
        return item.lane === 'root' && eligible(item)
      })
      if (index < 0) {
        index = this.waiting.findIndex(eligible)
      }
      if (index < 0) {
        return
      }
      const item = this.waiting.splice(index, 1)[0]
      item.signal?.removeEventListener('abort', item.abort)
      const scope = this.scopes.get(item.scope) ?? { root: 0, background: 0 }
      scope[item.lane] += 1
      this.scopes.set(item.scope, scope)
      this.active += 1
      if (item.lane === 'background') {
        this.background += 1
      }
      let released = false
      item.resolve(() => {
        if (released) {
          return
        }
        released = true
        this.active -= 1
        scope[item.lane] -= 1
        if (item.lane === 'background') {
          this.background -= 1
        }
        if (scope.root === 0 && scope.background === 0) {
          this.scopes.delete(item.scope)
        }
        this.drain()
      })
    }
  }
}
