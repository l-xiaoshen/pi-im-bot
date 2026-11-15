import type { Configuration } from '@pi-im-bot/config/load'
import { usesGsviConfiguration } from './definition'
import { refreshGsviChoices } from './cache'

/** Core-owned, bounded cache GET maintenance; never a business/render Job or an import task. */
export class GsviConfigurationRefresh {
  private readonly active = new Map<string, { controller: AbortController; done: Promise<void> }>()
  private readonly pending = new Set<Promise<void>>()
  private closed = false

  constructor(private readonly configuration: () => Configuration) {}

  request(id: string) {
    this.active.get(id)?.controller.abort()
    const config = this.configuration()
    const instance = config.resources.config.plugins.find((entry) => entry.id === id)
    const bundle = config.resources.pluginPackage(id)
    if (
      this.closed ||
      !config.bot.plugins.enabled ||
      !instance?.enabled ||
      !bundle ||
      !usesGsviConfiguration(bundle)
    ) {
      return
    }
    const controller = new AbortController()
    const done = refreshGsviChoices(this.configuration, id, controller.signal)
      .then(() => {})
      .catch(() => {})
      .finally(() => {
        this.pending.delete(done)
        if (this.active.get(id)?.controller === controller) {
          this.active.delete(id)
        }
      })
    this.active.set(id, { controller, done })
    this.pending.add(done)
  }

  async close() {
    this.closed = true
    const active = [...this.active.values()]
    for (const entry of active) {
      entry.controller.abort()
    }
    await Promise.all(this.pending)
    this.active.clear()
  }
}
