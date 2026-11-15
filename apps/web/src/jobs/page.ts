import { element, button, field, showDialog } from "../dom"
import { request, mutate } from "../api"
import { pageTitle, type PageActions } from "../pages"
import type { Snapshot } from "@pi-im-bot/contracts/http"
import { JobSchema, jobTerminal, type JobSummary } from "@pi-im-bot/jobs/schema"
import { jobStateLabel } from "./labels"
import { jobResults } from "./results"
import { botApiUrl } from "../bot-origin"

export function showJobs(container: HTMLElement, snapshot: Snapshot, actions: PageActions) {
  const page = element("div", "settings-page resource-page")
  const header = pageTitle("后台任务", "主对话继续响应；后台工作保留独立上下文、权限快照和执行环境。")
  header.append(
    button(
      "创建后台 Agent",
      () => {
        createDialog(snapshot, actions)
      },
      "button primary"
    )
  )
  page.append(header)
  if (snapshot.jobs.length === 0) {
    page.append(element("div", "card", "暂无后台任务。可以直接创建，也可以在聊天中让 Agent 委派耗时工作。"))
  }
  for (const job of snapshot.jobs) {
    const card = element("section", "card")
    card.dataset.job = job.id
    const heading = element("div", "card-heading")
    const buttons = element("div", "button-row")
    if (job.external?.hasReceipt && job.state === "outcome_unknown" && job.delivery !== "pending") {
      buttons.append(
        button(
          "核对远端状态",
          () => {
            void mutate(`/api/rooms/${job.roomId}/jobs/${job.id}/reconcile`, { cancel: false })
              .then(actions.refresh)
              .catch(actions.notify)
          },
          "button secondary"
        )
      )
      if (job.state === "outcome_unknown") {
        buttons.append(
          button(
            "取消远端任务",
            () => {
              void mutate(`/api/rooms/${job.roomId}/jobs/${job.id}/reconcile`, { cancel: true })
                .then(actions.refresh)
                .catch(actions.notify)
            },
            "button secondary"
          )
        )
      }
    }
    if (!jobTerminal(job.state) || job.delivery === "pending") {
      buttons.append(
        button(
          "停止此任务",
          () => {
            void mutate(`/api/rooms/${job.roomId}/jobs/${job.id}/cancel`).then(actions.refresh).catch(actions.notify)
          },
          "button secondary"
        )
      )
    }
    if (job.kind === "agent") {
      buttons.append(
        button(
          "补充 / 修订",
          () => {
            void revise(job, actions).catch(actions.notify)
          },
          "button secondary"
        )
      )
    }
    buttons.append(
      button(
        "查看聊天",
        () => {
          void actions.openRoom(job.roomId).catch(actions.notify)
        },
        "button secondary"
      )
    )
    heading.append(element("h2", "", job.title), buttons)
    card.append(
      heading,
      element("p", "", `${jobStateLabel(job.state)} · 版本 ${job.revision}`),
      element("small", "muted", job.id)
    )
    if (job.parentJobId) {
      card.append(element("p", "muted", "所属任务：" + job.parentJobId))
    }
    if (job.schedule) {
      card.append(
        element("p", "muted", "来源：计划任务 · " + new Date(job.schedule.scheduledAt).toLocaleString("zh-CN"))
      )
    }
    if (job.external) {
      let status = job.external.status
      if (status === "waiting_capacity") {
        status = "等待此服务的任务名额"
      }
      if (status === "submitting") {
        status = "提交中，尚未收到远端任务回执"
      }
      if (status === "working") {
        status = "远端处理中"
      }
      if (!jobTerminal(job.state)) {
        card.append(element("p", "muted", status))
      }
      if (job.external.message) {
        card.append(element("p", "muted", job.external.message))
      }
      if (job.external.nextPollAt) {
        card.append(
          element("small", "muted", "下次查询：" + new Date(job.external.nextPollAt).toLocaleTimeString("zh-CN"))
        )
      }
    }
    if (job.result?.summary) {
      card.append(element("pre", "settings-effective", job.result.summary))
    }
    jobResults(card, job, actions.notify)
    if (job.error) {
      card.append(element("p", "form-error", job.error))
    }
    if (job.delivery === "unknown") {
      card.append(element("p", "form-error", "发送回执未知，结果保留，系统未自动重发。"))
    }
    if (job.delivery === "suppressed") {
      card.append(element("p", "muted", "本版本的结果未发送到聊天。"))
    }
    if (job.delivery === "partial") {
      card.append(element("p", "muted", "部分内容已发送，后续交付已停止。"))
    }
    if (job.deliveryError) {
      card.append(element("p", "form-error", job.deliveryError))
    }
    for (const id of job.result?.artifactIds ?? []) {
      const link = element("a", "text-button", "下载产物 " + id.slice(0, 8))
      link.href = botApiUrl(`/api/rooms/${job.roomId}/artifacts/${id}/content`)
      link.target = "_blank"
      link.rel = "noopener"
      card.append(link)
    }
    page.append(card)
  }
  container.replaceChildren(page)
}

function createDialog(snapshot: Snapshot, actions: PageActions) {
  const room = element("select")
  room.setAttribute("aria-label", "任务会话")
  for (const item of snapshot.rooms) {
    const option = element("option", "", item.name)
    option.value = item.id
    room.append(option)
  }
  const title = element("input")
  title.required = true
  const prompt = element("textarea")
  prompt.rows = 6
  prompt.required = true
  showDialog(
    "创建后台 Agent",
    [field("任务会话", room), field("任务标题", title), field("任务说明", prompt)],
    "提交后台任务",
    async () => {
      await mutate(`/api/rooms/${room.value}/jobs`, {
        title: title.value,
        spec: { kind: "agent", prompt: prompt.value }
      })
      await actions.refresh()
    }
  )
}

async function revise(summary: JobSummary, actions: PageActions) {
  const job = await request(`/api/rooms/${summary.roomId}/jobs/${summary.id}`, JobSchema)
  if (job.revisions[String(job.currentRevision)].spec.kind !== "agent") {
    throw new Error("已提交的外部操作不能直接改写，请核对取消状态后创建新任务。")
  }
  const instruction = element("textarea")
  instruction.rows = 5
  instruction.required = true
  showDialog(
    "修订共享任务",
    [element("p", "muted", "新版本使用本次操作的权限；旧版本停止并抑制迟到回复。"), field("补充说明", instruction)],
    "提交新版本",
    async () => {
      await mutate(`/api/rooms/${summary.roomId}/jobs/${summary.id}/update`, {
        revision: job.currentRevision,
        instruction: instruction.value
      })
      await actions.refresh()
    }
  )
}
