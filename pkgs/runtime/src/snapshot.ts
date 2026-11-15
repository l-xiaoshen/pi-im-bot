// Only used on framework-owned snapshots, never on provider runtimes or services.
export function freezeSnapshot<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) {
      freezeSnapshot(child)
    }
    Object.freeze(value)
  }
  return value
}
