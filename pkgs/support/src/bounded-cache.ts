/** Eviction only drops a cache reference, never the underlying durable record. */
export class BoundedCache<K, V> {
  private readonly entries = new Map<K, V>()
  constructor(private readonly maximum: number) {}
  get size() {
    return this.entries.size
  }
  get(key: K) {
    const value = this.entries.get(key)
    if (value !== undefined) {
      this.entries.delete(key)
      this.entries.set(key, value)
    }
    return value
  }
  set(key: K, value: V) {
    this.entries.delete(key)
    this.entries.set(key, value)
    while (this.entries.size > this.maximum) {
      const oldest = this.entries.keys().next()
      if (!oldest.done) {
        this.entries.delete(oldest.value)
      }
    }
  }
  delete(key: K) {
    this.entries.delete(key)
  }
}
