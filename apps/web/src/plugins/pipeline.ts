import { node, button } from "./dom"
import { request } from "../api"
import { PipelineViewSchema } from "@pi-im-bot/plugins/pipeline/contracts"

export async function pipelinePanel(root: HTMLElement, notify: (value: unknown) => void, pluginId?: string) {
  let state = await request("/api/plugins/pipeline", PipelineViewSchema)
  if (!root.isConnected) {
    return
  }
  const changes = new Map<string, { key: string; priority: number; disabled: boolean }>()
  const content = node("div", "pipeline-nodes")
  const footer = node("footer", "save-bar")
  const feedback = node("span", "muted")
  const save = node("button", "button primary", "保存编排")
  save.disabled = true
  function dirty() {
    save.disabled = false
    feedback.textContent = "有未保存的编排修改"
  }
  const handlerCount = state.nodes.reduce((count, point) => {
    return (
      count +
      point.handlers.filter((handler) => {
        return !pluginId || handler.pluginId === pluginId
      }).length
    )
  }, 0)
  if (pluginId && handlerCount === 0) {
    root.replaceChildren(node("section", "surface", "此插件通过指令和模型工具调用，不参与自动流程。"))
    return
  }
  function draw() {
    content.replaceChildren()
    for (const point of state.nodes) {
      const handlers = point.handlers.filter((handler) => {
        return !pluginId || handler.pluginId === pluginId
      })
      if (pluginId && !handlers.length) {
        continue
      }
      const card = node("section", "pipeline-node surface")
      const title = node("header", "pipeline-heading")
      title.append(node("h3", "", point.title), node("code", "", point.id))
      card.append(title, node("p", "pipeline-flow", point.flow))
      for (const handler of handlers) {
        const row = node("div", "pipeline-handler")
        const enabled = node("input")
        enabled.type = "checkbox"
        enabled.checked = handler.enabled
        enabled.setAttribute("aria-label", handler.pluginName + " " + handler.key + " 启用")
        const priority = node("input")
        priority.type = "number"
        priority.value = String(handler.priority)
        priority.min = "-100000"
        priority.max = "100000"
        priority.setAttribute("aria-label", handler.key + " 优先级")
        function change() {
          changes.set(handler.key, {
            key: handler.key,
            priority: Number(priority.value),
            disabled: !enabled.checked
          })
          dirty()
        }
        enabled.addEventListener("change", change)
        priority.addEventListener("change", change)
        const information = node("div")
        information.append(node("strong", "", handler.pluginName), node("small", "muted", handler.key))
        if (!handler.available && handler.enabled) {
          information.append(node("p", "muted", "插件停用或未被全局选择"))
        }
        row.append(enabled, information, node("span", "muted", "优先级"), priority)
        card.append(row)
      }
      if (!handlers.length) {
        card.append(node("p", "muted", "未接入插件"))
      }
      const contract = node("details", "pipeline-contract")
      contract.append(node("summary", "", "数据契约"))
      contract.append(
        node("p", "", point.summary),
        node("p", "", "可修改字段：" + (point.writable.join("、") || "只读")),
        node("pre", "", JSON.stringify({ input: point.input, output: point.output }, null, 2)),
        node("code", "muted", point.source)
      )
      card.append(contract)
      content.append(card)
    }
  }
  save.addEventListener("click", () => {
    save.disabled = true
    void request("/api/plugins/pipeline", PipelineViewSchema, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ revision: state.revision, changes: [...changes.values()] })
    })
      .then((next) => {
        state = next
        changes.clear()
        feedback.textContent = ""
        draw()
        notify("编排已保存")
      })
      .catch((error) => {
        save.disabled = false
        notify(error)
      })
  })
  footer.append(feedback, save)
  root.replaceChildren(node("p", "pipeline-context", "Bot 全局编排"), content)
  if (handlerCount) {
    root.append(footer)
  }
  draw()
}
