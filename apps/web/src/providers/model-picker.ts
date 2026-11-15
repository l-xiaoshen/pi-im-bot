import { element, field, button } from "../dom"
import {
  ModelDraftSchema,
  providerDraft,
  type ProviderEditorSnapshot,
  type ProviderView,
  type RemoteModel
} from "@pi-im-bot/providers/editor-contracts"
import { editorDialog } from "./dialog"
import { saveProvider } from "./client"

export function pickModels(
  snapshot: ProviderEditorSnapshot,
  provider: ProviderView,
  models: RemoteModel[],
  saved: (value: ProviderEditorSnapshot) => void
) {
  const configured = new Set(
    provider.models.map((model) => {
      return model.id
    })
  )
  const selected = new Set<string>()
  const search = element("input")
  search.placeholder = "搜索模型 ID"
  const list = element("div", "model-picker-list")
  const summary = element("p", "muted")
  let shown: RemoteModel[] = []
  const modal = editorDialog("选择模型", "添加所选模型", async () => {
    if (selected.size === 0) {
      throw new Error("请选择要添加的模型。")
    }
    const draft = providerDraft(provider)
    for (const id of selected) {
      draft.models.push(ModelDraftSchema.parse({ id }))
    }
    saved(await saveProvider(snapshot, draft, provider.id))
  })
  function render() {
    const query = search.value.trim().toLowerCase()
    const filtered = models.filter((model) => {
      return model.id.toLowerCase().includes(query)
    })
    shown = filtered.slice(0, 100)
    list.replaceChildren()
    for (const model of shown) {
      const row = element("label", "model-picker-row")
      const input = element("input")
      input.type = "checkbox"
      input.checked = selected.has(model.id) || configured.has(model.id)
      input.disabled = configured.has(model.id)
      input.addEventListener("change", () => {
        if (input.checked) {
          selected.add(model.id)
        } else {
          selected.delete(model.id)
        }
        summary.textContent = `显示 ${shown.length} / ${filtered.length} · 已选择 ${selected.size}`
      })
      row.append(input, element("span", "", model.id))
      if (configured.has(model.id)) {
        row.append(element("small", "muted", "已添加"))
      }
      list.append(row)
    }
    if (shown.length === 0) {
      list.append(element("p", "empty-note", "没有匹配的模型。"))
    }
    summary.textContent = `显示 ${shown.length} / ${filtered.length} · 已选择 ${selected.size}`
  }
  search.addEventListener("input", render)
  const toolbar = element("div", "button-row")
  toolbar.append(
    button(
      "选择当前显示",
      () => {
        for (const model of shown) {
          if (!configured.has(model.id)) {
            selected.add(model.id)
          }
        }
        render()
      },
      "button secondary"
    ),
    button(
      "清空选择",
      () => {
        selected.clear()
        render()
      },
      "text-button"
    )
  )
  modal.body.append(
    field("搜索模型", search),
    toolbar,
    summary,
    list,
    element(
      "small",
      "muted",
      "列表来自服务的 /models。是否支持 Responses 请在添加后测试；能力与上下文大小可以逐模型修改。"
    )
  )
  render()
  search.focus()
}
