import { element, button } from "../dom"
import { request, mutate } from "../api"
import { ObserverStatusSchema, type ObserverRecord } from "@pi-im-bot/plugins/observations/schema"
import type { PageActions } from "../pages"

export function observerPanel(container: HTMLElement, actions: PageActions) {
  const details = element("details", "card")
  details.append(element("summary", "", "观察任务与后续动作"))
  const content = element("div")
  const refresh = button(
    "刷新观察状态",
    () => {
      void load().catch(actions.notify)
    },
    "button secondary"
  )
  details.append(refresh, content)
  container.append(details)
  const labels: Record<ObserverRecord["state"], string> = {
    queued: "等待",
    running: "执行中",
    done: "完成",
    failed: "失败",
    unknown: "结果未知",
    expired: "已过期",
    cancelled: "已停止"
  }
  function row(record: ObserverRecord, active: boolean) {
    const item = element("div", "resource-tool")
    item.append(element("p", "", record.handler + " · " + labels[record.state]))
    if (record.dueAt) {
      item.append(element("p", "muted", "计划时间：" + new Date(record.dueAt).toLocaleString("zh-CN")))
    }
    if (record.error) {
      item.append(element("p", "muted", record.error))
    }
    if (active) {
      item.append(
        button(
          "停止此动作",
          () => {
            void mutate("/api/plugins/observers/" + record.taskId + "/cancel")
              .then(load)
              .catch(actions.notify)
          },
          "button secondary"
        )
      )
    }
    return item
  }
  async function load() {
    const status = await request("/api/plugins/observers", ObserverStatusSchema)
    if (!details.isConnected) {
      return
    }
    content.replaceChildren(
      element("p", "muted", `待受理 ${status.outbox} · 活动 ${status.active.length} · 本次进程丢弃 ${status.dropped}`)
    )
    if (status.lastError) {
      content.append(element("p", "form-error", status.lastError))
    }
    for (const record of status.active) {
      content.append(row(record, true))
    }
    if (status.recent.length > 0) {
      content.append(element("h3", "", "近期记录"))
      for (const record of [...status.recent].reverse()) {
        content.append(row(record, false))
      }
    }
  }
  void load().catch(actions.notify)
}
