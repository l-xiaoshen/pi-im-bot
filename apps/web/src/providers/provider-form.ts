import { element, field, button } from "../dom"
import {
  ProviderDraftSchema,
  providerDraft,
  type ProviderEditorSnapshot,
  type ProviderView
} from "@pi-im-bot/providers/editor-contracts"
import { saveProvider } from "./client"
import { editorDialog, textField, numberField, checkbox, nextId } from "./dialog"
import { requestFields } from "./advanced"

export function editProvider(
  snapshot: ProviderEditorSnapshot,
  saved: (value: ProviderEditorSnapshot, id: string, fetch: boolean) => void,
  provider?: ProviderView
) {
  const draft = ProviderDraftSchema.parse(
    provider ?? {
      id: nextId(
        "provider",
        snapshot.providers.map((item) => {
          return item.id
        })
      ),
      baseUrl: "https://api.openai.com/v1",
      models: [],
      body: { store: false }
    }
  )
  const name = textField("服务名称", provider?.name ?? "", "例如：主接口、备用接口")
  const id = textField("唯一标识", draft.id)
  id.input.required = true
  id.input.pattern = "[a-z][a-z0-9_-]*"
  const baseUrl = textField("API 基址", draft.baseUrl, "https://your-service.example/v1")
  baseUrl.input.type = "url"
  baseUrl.input.required = true
  const enabled = checkbox("启用此提供商", draft.enabled)
  const auth = element("select")
  for (const [value, label] of [
    ["key", "API Key"],
    ["env", "环境变量"],
    ["none", "自定义 Header / 无 API Key"]
  ]) {
    const option = element("option", "", label)
    option.value = value
    auth.append(option)
  }
  auth.value = "key"
  if (draft.apiKeyEnv) {
    auth.value = "env"
  }
  const key = textField("API Key", "")
  key.input.type = "password"
  key.input.setAttribute("aria-label", "API Key")
  key.input.autocomplete = "new-password"
  key.input.placeholder = "输入上游服务的 API Key"
  if (provider?.hasApiKey) {
    key.input.placeholder = "已保存；留空保持不变"
  }
  const reveal = button(
    "显示输入",
    () => {
      if (key.input.type === "password") {
        key.input.type = "text"
        reveal.textContent = "隐藏输入"
      } else {
        key.input.type = "password"
        reveal.textContent = "显示输入"
      }
    },
    "text-button"
  )
  key.row.append(reveal)
  const clear = checkbox("清除已保存的 API Key", false)
  clear.row.hidden = !provider?.hasApiKey
  const env = textField("环境变量名", draft.apiKeyEnv ?? "", "PRIMARY_API_KEY")
  const authFields = element("div", "credential-fields")
  authFields.append(key.row, clear.row, env.row)
  function authMode() {
    key.row.hidden = auth.value !== "key"
    clear.row.hidden = auth.value !== "key" || !provider?.hasApiKey
    env.row.hidden = auth.value !== "env"
    env.input.required = auth.value === "env"
  }
  auth.addEventListener("change", authMode)
  authMode()
  const timeout = numberField("请求超时（秒）", draft.timeoutMs / 1000, 1)
  timeout.input.step = "0.001"
  const fields = requestFields(draft.headers, draft.body, false)
  const advanced = element("details", "provider-advanced")
  advanced.append(element("summary", "", "高级设置 · 推理强度、服务等级、Headers / Body"), fields.root, timeout.row)
  let title = "新增 OpenAI Responses 提供商"
  if (provider) {
    title = `编辑提供商 · ${provider.name || provider.id}`
  }
  const modal = editorDialog(title, "保存配置", async (action) => {
    const next = {
      ...draft,
      ...fields.read(),
      id: id.input.value.trim(),
      name: name.input.value.trim() || undefined,
      baseUrl: baseUrl.input.value.trim(),
      enabled: enabled.input.checked,
      timeoutMs: Math.round(Number(timeout.input.value) * 1000),
      apiKey: undefined as string | undefined,
      apiKeyEnv: undefined as string | undefined,
      clearApiKey: false
    }
    if (auth.value === "key") {
      next.apiKey = key.input.value.trim() || undefined
      next.clearApiKey = clear.input.checked
    }
    if (auth.value === "env") {
      next.apiKeyEnv = env.input.value.trim()
    }
    if (auth.value === "none") {
      next.clearApiKey = true
    }
    const parsed = ProviderDraftSchema.parse(next)
    const result = await saveProvider(snapshot, parsed, provider?.id)
    saved(result, parsed.id, action === "fetch")
  })
  const grid = element("div", "provider-form-grid")
  grid.append(name.row, id.row)
  modal.body.append(
    element("div", "protocol-label", "OpenAI Responses · HTTP SSE"),
    grid,
    baseUrl.row,
    element("small", "muted", "填写 API 基址，不包含末尾的 /responses。"),
    field("认证方式", auth),
    authFields,
    enabled.row,
    advanced
  )
  const fetchButton = element("button", "button secondary", "保存并获取模型")
  fetchButton.type = "submit"
  fetchButton.dataset.action = "fetch"
  modal.footer.insertBefore(fetchButton, modal.submit)
  name.input.focus()
  return modal
}
