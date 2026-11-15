import { element, button } from "../dom"
import {
  ModelDraftSchema,
  providerDraft,
  type ModelDraft,
  type ProviderEditorSnapshot,
  type ProviderView
} from "@pi-im-bot/providers/editor-contracts"
import { saveProvider, testModel } from "./client"
import { editorDialog, textField, numberField, checkbox, formError } from "./dialog"
import { requestFields } from "./advanced"

export function editModel(
  snapshot: ProviderEditorSnapshot,
  provider: ProviderView,
  saved: (value: ProviderEditorSnapshot) => void,
  model?: ModelDraft,
  modelId = ""
) {
  const current = ModelDraftSchema.parse(model ?? { id: modelId || "new-model" })
  const id = textField("模型 ID", model?.id ?? modelId, "填写服务实际接受的模型 ID")
  id.input.required = true
  const name = textField("显示名称", current.name ?? "", "可选")
  const context = numberField("上下文窗口（token）", current.contextWindow, 1024)
  const output = numberField("最大输出（token）", current.maxOutputTokens, 16)
  const enabled = checkbox("启用模型", current.enabled)
  const reasoning = checkbox("支持推理", current.reasoning)
  const images = checkbox("支持图片输入", current.images)
  const fields = requestFields(current.headers, current.body, true)
  function collect() {
    return ModelDraftSchema.parse({
      ...current,
      ...fields.read(),
      id: id.input.value.trim(),
      name: name.input.value.trim() || undefined,
      contextWindow: Number(context.input.value),
      maxOutputTokens: Number(output.input.value),
      enabled: enabled.input.checked,
      reasoning: reasoning.input.checked,
      images: images.input.checked
    })
  }
  function withModel(next: ModelDraft) {
    const draft = providerDraft(provider)
    if (model) {
      draft.models = draft.models.map((item) => {
        if (item.id === model.id) {
          return next
        }
        return item
      })
    } else {
      draft.models.push(next)
    }
    return draft
  }
  let title = "手动添加模型"
  if (model) {
    title = `配置模型 · ${model.id}`
  }
  const modal = editorDialog(title, "保存模型", async () => {
    const next = collect()
    const result = await saveProvider(snapshot, withModel(next), provider.id)
    saved(result)
  })
  const grid = element("div", "provider-form-grid")
  grid.append(id.row, name.row, context.row, output.row)
  const flags = element("div", "provider-flags")
  flags.append(enabled.row, reasoning.row, images.row)
  const testStatus = element("div", "provider-test-result")
  testStatus.setAttribute("role", "status")
  const testButton = button(
    "测试模型",
    () => {
      testButton.disabled = true
      testStatus.textContent = "正在发送一条最多 256 输出 token 的 Responses 请求…"
      void (async () => {
        const next = collect()
        const result = await testModel(snapshot, withModel(next), next.id, provider.id, modal.signal)
        testStatus.classList.toggle("is-error", !result.ok)
        let label = "测试失败"
        if (result.ok) {
          label = "连接成功"
        }
        if (result.ok && result.status === "length") {
          label = "接口已响应，达到测试输出上限"
        }
        testStatus.textContent = `${label} · ${(result.durationMs / 1000).toFixed(2)} 秒\n${result.text}\n输入 ${result.usage.input} / 输出 ${result.usage.output} token`
      })()
        .catch((error) => {
          testStatus.textContent = formError(error)
          testStatus.classList.add("is-error")
        })
        .finally(() => {
          testButton.disabled = false
        })
    },
    "button secondary"
  )
  modal.body.append(
    grid,
    flags,
    fields.root,
    element("small", "muted", "测试使用当前表单参数并产生少量模型用量，不会保存或启用模型。"),
    testStatus
  )
  modal.footer.insertBefore(testButton, modal.submit)
  id.input.focus()
  return modal
}
