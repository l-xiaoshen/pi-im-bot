import { element, button, showDialog } from "../dom"
import { request } from "../api"
import type { JobSummary } from "@pi-im-bot/jobs/schema"
import { JobDeliveryViewSchema } from "@pi-im-bot/jobs/delivery-view"
import { botApiUrl } from "../bot-origin"
const businessLabels = { succeeded: "全部成功", partial: "部分成功", failed: "失败", unknown: "结果未知" }
const itemLabels: Record<string, string> = {
  succeeded: "成功",
  failed: "失败",
  cancelled: "已取消",
  outcome_unknown: "结果未知",
  abandoned: "已停止等待，可核对远端",
  not_started: "未提交",
  submitted: "已接纳",
  running: "运行中"
}
export function jobResults(card: HTMLElement, job: JobSummary, notify: (error: unknown) => void) {
  const result = job.result
  if (result?.businessStatus) {
    card.append(element("p", "", "生成结果：" + businessLabels[result.businessStatus]))
    if (result.factsComplete === false) {
      card.append(element("p", "muted", "仍有结果未确认，可手动核对；已发送内容不会再次发送。"))
    }
  }
  for (const item of result?.items ?? []) {
    const row = element("div", "card")
    row.append(element("strong", "", "第" + (item.item + 1) + "项 · " + (itemLabels[item.status] ?? item.status)))
    if (item.workflow) {
      row.append(element("p", "muted", "工作流：" + item.workflow))
    }
    if (item.requestArtifactId) {
      const link = element("a", "text-button", "查看提交JSON")
      link.href = botApiUrl("/api/rooms/" + job.roomId + "/artifacts/" + item.requestArtifactId + "/content")
      link.target = "_blank"
      link.rel = "noopener"
      row.append(link)
    }
    card.append(row)
  }
  card.append(
    button(
      "查看发送回执",
      () => {
        void request("/api/rooms/" + job.roomId + "/jobs/" + job.id + "/delivery", JobDeliveryViewSchema)
          .then(({ delivery }) => {
            const fields: HTMLElement[] = []
            if (!delivery) {
              fields.push(element("p", "", "还没有发送记录。"))
            } else {
              let format = "直发"
              if (delivery.effectiveFormat === "forward") {
                format = "合并转发"
              }
              fields.push(element("p", "", "实际格式：" + format))
              if (delivery.format === "forward" && delivery.effectiveFormat === "direct") {
                fields.push(element("p", "muted", "此渠道不支持合并转发，发送前已改用直发。"))
              }
              fields.push(
                element(
                  "p",
                  "",
                  "已确认平台消息：" +
                    delivery.platformMessageIds.length +
                    " · 已确认分段：" +
                    (delivery.deliveryParts?.length ?? 0)
                )
              )
              if (delivery.error) {
                fields.push(element("p", "form-error", delivery.error))
              }
              fields.push(element("pre", "settings-effective", JSON.stringify(delivery.deliveryParts ?? [], null, 2)))
            }
            showDialog("发送回执", fields, "关闭", async () => {})
          })
          .catch(notify)
      },
      "button secondary"
    )
  )
}
