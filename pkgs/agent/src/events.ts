import type { Trace } from '@pi-im-bot/contracts/run'
import type { ProviderAttempt } from '@pi-im-bot/providers/responses'

export interface AgentCallbacks {
  trace(trace: Omit<Trace, 'id' | 'at' | 'runId' | 'roomId'>): void
  preview(text: string): void
  provider(event: ProviderAttempt): void
  tool(): void
}
