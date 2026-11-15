import type { Configuration } from '@pi-im-bot/config/load'
import type { Room, ChatMessage } from '@pi-im-bot/contracts/message'
import type { Run, PreparedRunInput, Trace } from '@pi-im-bot/contracts/run'
import { runObserver } from './run-observer'
import type { AgentCallbacks } from '@pi-im-bot/agent/events'
import { DeliveryUncertain, DeliverySuppressed, DeliveryAdmissionUnknown } from './delivery'
import type { HostToolServices } from '@pi-im-bot/agent/host-tools'
import type { EventHub } from '@pi-im-bot/contracts/events'
import { projectOutput } from '@pi-im-bot/messages/projection'
import { DeliveryDeferred } from '@pi-im-bot/contracts/rendering'

interface ExecutionHost {
  tools: HostToolServices
  invoke(callbacks: AgentCallbacks): Promise<string>
  events: EventHub
  deliver(text: string, role?: 'assistant' | 'system'): Promise<ChatMessage>
  update(run: Run): void
  trace(run: Run, trace: Omit<Trace, 'id' | 'at' | 'runId' | 'roomId'>): void
}

export async function executeRun(
  config: Configuration,
  room: Room,
  input: PreparedRunInput,
  run: Run,
  controller: AbortController,
  host: ExecutionHost
) {
  run.deadlineAt ??= (run.startedAt ?? Date.now()) + input.context.effective.settings.behavior.timeoutMs
  const timeout = setTimeout(
    () => {
      controller.abort(new Error('任务执行超时'))
    },
    Math.max(0, run.deadlineAt - Date.now())
  )
  try {
    const assertActive = () => {
      controller.signal.throwIfAborted()
      if (Date.now() >= run.deadlineAt!) {
        controller.abort(new Error('任务执行超时'))
        controller.signal.throwIfAborted()
      }
    }
    assertActive()
    run.status = 'running'
    run.error = undefined
    run.finishedAt = undefined
    run.startedAt ??= Date.now()
    host.update(run)
    host.trace(run, { kind: 'started', title: 'Pi 开始执行', detail: room.mode })
    const finalText = await host.invoke(
      runObserver(
        run,
        host.events,
        () => {
          host.update(run)
        },
        (event) => {
          host.trace(run, event)
        }
      )
    )
    assertActive()
    run.rawReply = finalText
    if (finalText.trim() && !input.context.jobId) {
      try {
        await host.deliver(projectOutput(finalText, input.context.effective.settings))
        run.presentation = { state: 'sent' }
        host.trace(run, { kind: 'delivery', title: '最终回复已交付', detail: room.address.channel })
      } catch (error) {
        if (error instanceof DeliveryDeferred) {
          run.presentation = { state: 'accepted', jobId: error.jobId }
          host.trace(run, { kind: 'delivery', title: '最终回复呈现已受理，尚未发送', detail: error.jobId })
        } else if (error instanceof DeliveryAdmissionUnknown) {
          run.presentation = { state: 'unknown' }
          host.trace(run, { kind: 'delivery', title: '最终回复呈现受理待核对', detail: error.outboundId })
        } else {
          if (!(error instanceof DeliverySuppressed)) {
            throw error
          }
          host.trace(run, { kind: 'delivery', title: '最终回复已按策略隐藏', detail: error.message })
        }
      }
    }
    assertActive()
    run.status = 'completed'
    host.trace(run, { kind: 'completed', title: '任务完成', detail: '' })
  } catch (error) {
    run.status = 'failed'
    if (controller.signal.aborted && controller.signal.reason === 'user') {
      run.status = 'cancelled'
    }
    if (controller.signal.aborted && controller.signal.reason === 'shutdown') {
      run.status = 'interrupted'
    }
    run.error = config.catalog.redact(String(error))
    if (controller.signal.aborted) {
      run.error = config.catalog.redact(String(controller.signal.reason))
    }
    let kind: Trace['kind'] = 'error'
    if (run.status === 'cancelled') {
      kind = 'cancelled'
    }
    host.trace(run, { kind, title: run.status, detail: run.error })
    if (run.status === 'failed' && !(error instanceof DeliveryUncertain) && !input.context.jobId) {
      await host.deliver(`任务失败：${run.error}`, 'system').catch(() => {})
    }
  } finally {
    clearTimeout(timeout)
    run.finishedAt = Date.now()
    host.update(run)
  }
}
