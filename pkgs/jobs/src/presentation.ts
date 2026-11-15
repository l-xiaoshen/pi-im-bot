import type { JobService } from './service'
import type { Job, JobRevision } from './schema'

export function presentationDelivery(service: JobService, value: JobRevision): JobRevision['delivery'] {
  const outbound = service.coordinator.store.getOutbound(value.presentation!.outboundId)
  if (outbound?.state === 'sent') {
    return 'sent'
  }
  if (outbound?.state === 'sending' || outbound?.state === 'unknown') {
    return 'unknown'
  }
  if (outbound?.state === 'cancelled' && outbound.platformMessageIds.length > 0) {
    return 'partial'
  }
  return 'suppressed'
}

export function suppressPresentation(service: JobService, value: JobRevision) {
  if (!value.presentation) {
    return
  }
  const outbound = service.coordinator.store.getOutbound(value.presentation.outboundId)
  if (outbound?.state === 'rendering') {
    service.coordinator.store.saveOutbound({ ...outbound, state: 'suppressed', error: '待呈现回复已停止' })
  }
}

export async function finishPresentation(
  service: JobService,
  job: Job,
  value: JobRevision,
  beforePart: () => Promise<void>
) {
  const coordinator = service.coordinator
  const id = value.presentation!.outboundId
  let result: { text: string; artifactIds: string[] } | undefined
  if (value.state === 'succeeded' && value.result) {
    result = { text: value.result.summary, artifactIds: value.result.artifactIds }
  }
  const validate = async () => {
    await beforePart()
    if (value.presentation?.parentJobId) {
      const parent = await service.repository.get(value.presentation.parentJobId)
      const revision = value.presentation.parentJobRevision!
      if (parent.currentRevision !== revision || parent.revisions[String(revision)].cancelRequested) {
        throw new Error('原 Agent Job 已停止或切换版本')
      }
    }
  }
  await coordinator.delivery.completeRender(coordinator.requireRoom(job.roomId), id, result, {
    beforePart: validate,
    authorize(capability) {
      coordinator.authorizeRetainedContext(job.roomId, value.mode, value.context, capability)
    }
  })
}
