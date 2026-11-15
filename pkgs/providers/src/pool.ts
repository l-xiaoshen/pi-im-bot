import type { Model } from '@earendil-works/pi-ai'
import type { ModelConfig, ProviderConfig, ProviderGroup } from './schema'

export interface Candidate {
  key: string
  provider: ProviderConfig
  config: ModelConfig
  model: Model<'openai-responses'>
  apiKey: string
}

export interface CandidateHealth {
  failures: number
  retryAt: number
  lastError?: string
}

export class ProviderPool {
  private readonly health = new Map<string, CandidateHealth>()

  constructor(private readonly now: () => number = Date.now) {}

  order(candidates: Candidate[], preferred?: string) {
    const ready = candidates.filter((candidate) => {
      return (this.health.get(candidate.key)?.retryAt ?? 0) <= this.now()
    })
    if (ready.length === 0) {
      return [...candidates]
        .sort((a, b) => {
          return (this.health.get(a.key)?.retryAt ?? 0) - (this.health.get(b.key)?.retryAt ?? 0)
        })
        .slice(0, 1)
    }
    if (preferred) {
      const index = ready.findIndex((candidate) => {
        return candidate.key === preferred
      })
      if (index > 0) {
        const [candidate] = ready.splice(index, 1)
        ready.unshift(candidate)
      }
    }
    return ready
  }

  failed(candidate: Candidate, group: ProviderGroup, error: string) {
    this.health.set(candidate.key, {
      failures: (this.health.get(candidate.key)?.failures ?? 0) + 1,
      retryAt: this.now() + group.cooldownMs,
      lastError: error
    })
  }

  succeeded(candidate: Candidate) {
    this.health.delete(candidate.key)
  }

  snapshot() {
    return Object.fromEntries(this.health)
  }
}
