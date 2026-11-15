import { z } from "zod"
import { element, field, showDialog } from "../dom"
import { GsviDraftSchema, type GsviDraft, type GsviView } from "@pi-im-bot/integrations/gsvi/configuration"

export function editGsvi(service: GsviView | undefined, save: (value: GsviDraft) => Promise<void>) {
  const id = element("input")
  id.required = true
  id.value = service?.id ?? ""
  id.disabled = Boolean(service)
  const name = element("input")
  name.required = true
  name.value = service?.name ?? ""
  const url = element("input")
  url.type = "url"
  url.autocomplete = "off"
  url.placeholder = service?.endpoint ?? "http://tts-server:8000"
  const enabled = element("input")
  enabled.type = "checkbox"
  enabled.checked = service?.enabled ?? false
  const headers = element("textarea")
  headers.value = JSON.stringify(service?.headers ?? {}, null, 2)
  const downloadHeaders = element("textarea")
  downloadHeaders.value = JSON.stringify(service?.downloadHeaders ?? {}, null, 2)
  const origins = element("textarea")
  origins.value = JSON.stringify(service?.downloadOrigins ?? [], null, 2)
  const timeout = element("input")
  timeout.type = "number"
  timeout.min = "1000"
  timeout.value = String(service?.timeoutMs ?? 180000)
  showDialog(
    "GSVI 语音服务",
    [
      field("服务 ID", id),
      field("名称", name),
      field("服务地址（留空保留）", url),
      field("启用", enabled),
      field("请求 Headers（JSON）", headers),
      field("下载 Headers（JSON）", downloadHeaders),
      element(
        "small",
        "muted",
        "Authorization 可填写 Bearer 凭据。占位符保留已保存值；凭据只由 Bot 使用。下载 Header 仅用于返回音频地址的初始来源，不向其他来源转发。"
      ),
      field("额外允许的下载来源（origin JSON 数组）", origins),
      field("总期限（毫秒）", timeout),
      element("small", "muted", "返回数据使用 Bot 通用产物单文件额度；没有独立的 GSVI 音频大小上限。"),
      element("small", "muted", "保存不发起请求。已配置只表示可以绑定，实际连通性由显式音色查询确认。")
    ],
    "保存语音服务",
    async () => {
      await save(
        GsviDraftSchema.parse({
          id: id.value,
          name: name.value,
          kind: "gsvi",
          url: url.value,
          enabled: enabled.checked,
          headers: z.record(z.string(), z.string()).parse(JSON.parse(headers.value)),
          downloadHeaders: z.record(z.string(), z.string()).parse(JSON.parse(downloadHeaders.value)),
          downloadOrigins: z.array(z.string()).parse(JSON.parse(origins.value)),
          timeoutMs: Number(timeout.value)
        })
      )
    }
  )
}
