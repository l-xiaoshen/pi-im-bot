import type { JobService, JobInvocation } from './service'
import { jobSummary, type JobSummary } from './schema'

export const jobCommandHelp =
  '/jobs 查看共享任务\n/job ID 查看结果\n/job cancel ID 停止指定任务\n/job update ID 版本号 补充说明：修订任务'

export function isJobCommand(text: string) {
  return /^\/jobs?(?:\s|$)/u.test(text.trim())
}

export function isJobControlCommand(text: string) {
  const trimmed = text.trim()
  return trimmed === '/jobs' || /^\/job(?:\s+(?:cancel\s+)?[a-f0-9-]{8,36})?$/u.test(trimmed)
}

function summaryLine(job: JobSummary) {
  return `${job.id.slice(0, 8)} · ${job.title} · ${job.state} · v${job.revision}`
}

async function commandJob(service: JobService, roomId: string, id: string) {
  if (id.length === 36) {
    return jobSummary(await service.repository.get(id, roomId))
  }
  const matches = (await service.repository.list(roomId)).filter((job) => {
    return job.id.startsWith(id)
  })
  if (matches.length !== 1) {
    throw new Error('任务 ID 不存在或前缀不唯一，请使用完整任务 ID 或 /jobs 查看。')
  }
  return matches[0]
}

export async function executeJobCommand(service: JobService, invocation: JobInvocation, text: string) {
  const trimmed = text.trim()
  if (trimmed === '/jobs') {
    invocation.authorize('job_list')
    const jobs = await service.repository.list(invocation.room.id)
    const lines = jobs.slice(0, 20).map(summaryLine)
    if (lines.length === 0) {
      lines.push('当前会话暂无后台任务。')
    }
    return lines.join('\n') + '\n\n' + jobCommandHelp
  }
  const match = /^\/job\s+(?:(cancel|update)\s+)?([a-f0-9-]{8,36})(?:\s+(\d+)\s+([\s\S]+))?$/u.exec(trimmed)
  if (!match) {
    return jobCommandHelp
  }
  const [, action, id, version, instruction] = match
  let capability = 'job_status'
  if (action === 'cancel') {
    capability = 'job_cancel'
  }
  if (action === 'update') {
    capability = 'job_update'
  }
  invocation.authorize(capability)
  const job = await commandJob(service, invocation.room.id, id)
  if (action === 'cancel') {
    if (version) {
      return jobCommandHelp
    }
    return summaryLine(await service.cancel(job.id, invocation.room.id))
  }
  if (action === 'update') {
    if (!version || !instruction) {
      return jobCommandHelp
    }
    return summaryLine(await service.update(invocation, job.id, Number(version), instruction, 'command'))
  }
  if (version) {
    return jobCommandHelp
  }
  return [
    summaryLine(job),
    job.result?.summary ?? job.error ?? '任务尚未完成。',
    '交付状态：' + job.delivery,
    ...(job.result?.artifactIds ?? []).map((artifactId) => {
      return '产物：' + artifactId
    })
  ].join('\n')
}
