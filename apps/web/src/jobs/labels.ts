import type { JobSummary } from "@pi-im-bot/jobs/schema"

const labels: Record<JobSummary["state"], string> = {
  queued: "排队中",
  running: "运行中",
  waiting_external: "等待外部操作",
  waiting_input: "远端等待输入",
  succeeded: "已完成",
  failed: "失败",
  cancel_requested: "已请求取消",
  cancelled: "已取消",
  outcome_unknown: "外部结果未知"
}
export function jobStateLabel(state: JobSummary["state"]) {
  return labels[state]
}
