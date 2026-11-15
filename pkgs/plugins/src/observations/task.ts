import type { TaskRuntime, RunningTask } from '@earendil-works/pi-durable'
import type { Observation } from './schema'

export interface DeferredRecall {
  messageId: string
  dueAt: number
}

export interface ObserverTaskInput {
  event: Observation
  handler: string
  key: string
  recall?: DeferredRecall
}
export interface ObserverCheckpoint {
  phase: 'run' | 'dispatched'
}
export type ObserverTaskRuntime = TaskRuntime<ObserverTaskInput, ObserverCheckpoint, object, object>
export type ActiveObserver = RunningTask<ObserverTaskInput, ObserverCheckpoint, object>
