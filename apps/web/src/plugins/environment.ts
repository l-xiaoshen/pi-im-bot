import { node, button } from "./dom"
import { field } from "../dom"
import { request } from "../api"
import { PluginEnvironmentSchema, type PluginEnvironment } from "@pi-im-bot/plugins/runtime/contracts"

export async function environmentPanel(
  root: HTMLElement,
  notify: (value: unknown) => void,
  changed: () => Promise<void>
) {
  let state = await request("/api/plugins/runtime", PluginEnvironmentSchema)
  if (!root.isConnected) {
    return
  }
  const image = node("input")
  image.value = state.image
  const mount = node("input")
  mount.value = state.mountCommand
  if (state.suggestedMountCommand) {
    mount.value = state.suggestedMountCommand
  }
  const status = node("div", "environment-checks")
  const form = node("form", "surface environment-form")
  const feedback = node("p", "form-error")
  const save = node("button", "button primary")
  save.type = "submit"
  const probe = button(
    "检测环境",
    () => {
      void check().catch(notify)
    },
    "button secondary"
  )
  async function check() {
    probe.disabled = true
    try {
      state = await request("/api/plugins/runtime/probe", PluginEnvironmentSchema, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ image: image.value, mountCommand: mount.value })
      })
      render(state)
    } finally {
      probe.disabled = false
    }
  }
  function render(value: PluginEnvironment) {
    status.replaceChildren()
    for (const check of value.checks) {
      const row = node("div", "environment-check")
      let marker = "✓"
      if (!check.ready) {
        marker = "✕"
      }
      row.append(node("span", "", marker), node("strong", "", check.name))
      if (!check.ready) {
        row.append(node("p", "form-error", check.detail))
      }
      status.append(row)
    }
    save.textContent = "启用运行环境"
    if (value.enabled) {
      save.textContent = "停用运行环境"
    }
  }
  form.append(
    node("h2", "", "插件运行环境"),
    field("Worker 镜像", image),
    field("fuse2fs 路径", mount),
    status,
    feedback
  )
  const footer = node("div", "button-row")
  footer.append(probe, save)
  form.append(footer)
  form.addEventListener("submit", async (event) => {
    event.preventDefault()
    save.disabled = true
    feedback.textContent = ""
    try {
      state = await request("/api/plugins/runtime", PluginEnvironmentSchema, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          revision: state.revision,
          enabled: !state.enabled,
          image: image.value,
          mountCommand: mount.value
        })
      })
      render(state)
      await changed()
      notify("插件运行环境已应用")
    } catch (error) {
      feedback.textContent = String(error)
    } finally {
      save.disabled = false
    }
  })
  root.replaceChildren(form)
  render(state)
  if (state.suggestedMountCommand) {
    await check()
  }
}
