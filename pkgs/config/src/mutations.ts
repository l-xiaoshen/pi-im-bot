export class ConfigurationMutations {
  private queue = Promise.resolve()

  exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const task = this.queue.then(operation)
    this.queue = task.then(
      () => {},
      () => {}
    )
    return task
  }
}
