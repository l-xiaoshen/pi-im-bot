import { defineTask, type RunningTask, type TaskRuntime } from '@earendil-works/pi-durable'
import type { Context } from '@earendil-works/chord/context'

export interface JobTaskInput {
  jobId: string
  revision: number
}
export type JobCheckpoint =
  | { phase: 'work' }
  | { phase: 'dispatching' }
  | { phase: 'poll' }
  | { phase: 'report' }
export type JobReceipt = { jobId: string; revision: number }
export type JobTaskRuntime = TaskRuntime<JobTaskInput, JobCheckpoint, JobReceipt, object>
export type ActiveJobTask = RunningTask<JobTaskInput, JobCheckpoint, JobReceipt>

export interface JobTaskHandlers {
  work(task: ActiveJobTask, runtime: JobTaskRuntime, context: Context): Promise<void>
  unknown(task: ActiveJobTask, runtime: JobTaskRuntime, context: Context): Promise<void>
  poll(task: ActiveJobTask, runtime: JobTaskRuntime, context: Context): Promise<void>
  report(task: ActiveJobTask, runtime: JobTaskRuntime, context: Context): Promise<void>
  abort(task: ActiveJobTask, runtime: JobTaskRuntime, context: Context): Promise<void>
}

export function createJobTask(handlers: JobTaskHandlers) {
  return defineTask<JobTaskInput, JobCheckpoint, JobReceipt>({
    name: 'bot.job',
    version: 1,
    initial: () => ({ phase: 'work' }),
    phases: {
      work: handlers.work,
      dispatching: handlers.unknown,
      poll: handlers.poll,
      report: handlers.report
    },
    abort: handlers.abort
  })
}
