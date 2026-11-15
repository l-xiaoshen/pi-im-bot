import type { Snapshot } from "@pi-im-bot/contracts/http"
import { element, button, field, showDialog } from "./dom"
import { mutate } from "./api"
import { jobStateLabel } from "./jobs/labels"

export interface PageActions {
  reload(): Promise<void>
  refresh(): Promise<void>
  openRoom(id: string): Promise<void>
  notify(error: unknown): void
}

export function pageTitle(title: string, subtitle: string) {
  const header = element("header", "page-header")
  const heading = element("div")
  heading.append(element("h1", "", title), element("p", "subtitle", subtitle))
  header.append(heading)
  return header
}

export function showSchedules(container: HTMLElement, snapshot: Snapshot, actions: PageActions) {
  const page = element("div", "settings-page schedule-page")
  const header = pageTitle(
    "计划任务",
    "让时间成为 Agent 的另一个入口，结果交付到指定渠道，并在该渠道的会话上下文中运行。"
  )
  header.append(
    button(
      "创建计划",
      () => {
        createScheduleDialog(snapshot, actions)
      },
      "button primary"
    )
  )
  page.append(header)
  if (snapshot.schedules.length === 0) {
    const empty = element("section", "card wide-empty")
    empty.append(
      element("h2", "", "还没有计划任务"),
      element("p", "", "先在 Mock 渠道中调试任务，再添加 Cron。默认使用独立 Pi 会话上下文。")
    )
    page.append(empty)
  }
  for (const schedule of snapshot.schedules) {
    const card = element("section", "card")
    card.dataset.schedule = schedule.id
    const title = element("div", "card-heading")
    const buttons = element("div", "button-row")
    buttons.append(
      button("立即运行", () => {
        void mutate(`/api/schedules/${schedule.id}/run`)
          .then(async () => {
            await actions.openRoom(schedule.roomId)
          })
          .catch(actions.notify)
      }),
      button(
        "删除",
        () => {
          void mutate(`/api/schedules/${schedule.id}`, undefined, "DELETE").then(actions.refresh).catch(actions.notify)
        },
        "button secondary"
      )
    )
    title.append(element("h2", "", schedule.name), buttons)
    const authorize = button(
      "以本地操作员更新权限",
      () => {
        void mutate(`/api/schedules/${schedule.id}/authorize`).then(actions.refresh).catch(actions.notify)
      },
      "button secondary"
    )
    authorize.title = "将此计划的触发来源改为本地操作员，并按当前设置重新计算可用能力。"
    buttons.append(authorize)
    let toggleLabel = "暂停自动执行"
    if (!schedule.enabled) {
      toggleLabel = "启用自动执行"
    }
    buttons.append(
      button(
        toggleLabel,
        () => {
          void mutate(
            `/api/schedules/${schedule.id}`,
            { revision: schedule.revision, enabled: !schedule.enabled },
            "PATCH"
          )
            .then(actions.refresh)
            .catch(actions.notify)
        },
        "button secondary"
      )
    )
    buttons.append(
      button(
        "停止本次工作",
        () => {
          void mutate(`/api/schedules/${schedule.id}/stop`).then(actions.refresh).catch(actions.notify)
        },
        "button secondary"
      )
    )
    if (!schedule.authority) {
      card.append(element("p", "muted", "此旧计划没有保存触发来源，自动执行已暂停。"))
    }
    card.append(
      title,
      element("code", "", `${schedule.cron} · ${schedule.timezone}`),
      element("p", "schedule-prompt", schedule.prompt)
    )
    let contextLabel = "共享主对话"
    if (schedule.isolated) {
      contextLabel = "独立上下文，持久文件按计划保留"
    }
    card.append(
      element(
        "p",
        "muted",
        (snapshot.rooms.find((room) => {
          return room.id === schedule.roomId
        })?.name ?? schedule.roomId) +
          " · " +
          contextLabel
      )
    )
    const active = snapshot.jobs.filter((job) => {
      return (
        job.schedule?.id === schedule.id &&
        (!["succeeded", "failed", "cancelled", "outcome_unknown"].includes(job.state) || job.delivery === "pending")
      )
    })
    if (active.length > 0) {
      card.append(element("p", "", `当前有 ${active.length} 个任务／子任务未收尾；后续触发将跳过重叠执行。`))
    }
    if (schedule.lastJobId) {
      card.append(element("small", "muted", "最近任务：" + schedule.lastJobId))
      const latest = snapshot.jobs.find((job) => {
        return job.id === schedule.lastJobId
      })
      if (latest) {
        card.append(element("p", "", "最近任务状态：" + jobStateLabel(latest.state)))
      }
    }
    if (schedule.lastError) {
      let prefix = "最近触发失败："
      if (schedule.lastOutcome === "skipped") {
        prefix = "最近一次触发已跳过："
      }
      card.append(element("p", "muted", prefix + schedule.lastError.replace(/^Error: /u, "")))
    }
    if (schedule.nextRunAt) {
      card.append(element("small", "muted", `下次运行：${new Date(schedule.nextRunAt).toLocaleString("zh-CN")}`))
    }
    page.append(card)
  }
  container.replaceChildren(page)
}

function createScheduleDialog(snapshot: Snapshot, actions: PageActions) {
  const name = element("input")
  name.required = true
  name.placeholder = "例如：每日检查"
  const room = element("select")
  for (const item of snapshot.rooms) {
    const option = element("option", "", item.name)
    option.value = item.id
    room.append(option)
  }
  const cron = element("input")
  cron.value = "*/10 * * * *"
  cron.required = true
  const timezone = element("input")
  timezone.value = "Asia/Shanghai"
  const isolated = element("select")
  for (const [value, label] of [
    ["true", "独立上下文（推荐）"],
    ["false", "共享主对话"]
  ]) {
    const option = element("option", "", label)
    option.value = value
    isolated.append(option)
  }
  const prompt = element("textarea")
  prompt.rows = 4
  prompt.required = true
  prompt.placeholder = "说明这次计划任务要做什么…"
  showDialog(
    "创建计划任务",
    [
      field("名称", name),
      field("交付渠道", room),
      field("Cron", cron),
      field("时区", timezone),
      field("上下文", isolated),
      field("任务描述", prompt)
    ],
    "创建",
    async () => {
      await mutate("/api/schedules", {
        name: name.value,
        roomId: room.value,
        cron: cron.value,
        timezone: timezone.value,
        prompt: prompt.value,
        enabled: true,
        isolated: isolated.value === "true"
      })
      await actions.refresh()
    }
  )
}
