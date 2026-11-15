import { node, button } from "./dom"
import { request, ApiValidationError } from "../api"
import {
  PluginConfigViewSchema,
  type PluginConfigTarget,
  type PluginConfigView
} from "@pi-im-bot/plugins/configuration/contracts"
import type { ConfigValues } from "@pi-im-bot/plugins/configuration/schema"
import type { SecretChange } from "@pi-im-bot/plugins/configuration/secrets"
import { configForm } from "./fields"

export function configurationPanel(
  container: HTMLElement,
  id: string,
  notify: (message: unknown) => void,
  saved: () => Promise<void>,
  target: PluginConfigTarget = { level: "instance" }
) {
  let view: PluginConfigView
  let values: ConfigValues = {}
  const secrets = new Map<string, SecretChange>()
  let dirty = false
  let sequence = 0
  async function load(selected: PluginConfigTarget = target) {
    const generation = ++sequence
    const query = new URLSearchParams(selected)
    container.inert = true
    container.setAttribute("aria-busy", "true")
    try {
      const next = await request("/api/plugins/" + id + "/configuration?" + query, PluginConfigViewSchema)
      if (!container.isConnected || generation !== sequence) {
        return
      }
      view = next
      values = structuredClone(next.values)
      secrets.clear()
      dirty = false
      render()
    } finally {
      if (generation === sequence) {
        container.inert = false
        container.setAttribute("aria-busy", "false")
      }
    }
  }
  function render() {
    container.replaceChildren()
    if (!view.definition && !view.bindings.length) {
      container.append(node("section", "surface", "此插件无需配置。"))
      return
    }
    const form = node("form", "plugin-config-form")
    const body = node("section", "surface config-main")
    if (view.gsviConfiguration?.projectionActive) {
      let note = "保存配置或启用插件时自动刷新音色缓存；refresh_voices执行一次后复位。"
      if (view.gsviConfiguration.refreshDisabled) {
        note = "插件或执行环境未启用：当前不会请求上游音色。可编辑并保存全部配置，空缓存时可手填音色。"
      }
      body.append(node("p", "muted", note))
    }
    let base = structuredClone(view.inherited)
    if (view.target.level === "instance") {
      base = values
    }
    try {
      let definition = view.definition ?? {}
      if (view.gsviConfiguration?.projectionActive) {
        definition = structuredClone(definition)
        const voice = definition.preset?.items?.voice
        if (voice) {
          voice.hint = (voice.hint ?? "") + " " + view.gsviConfiguration.voiceHint
          if (view.gsviConfiguration.voiceChoices.length) {
            const choices = [...view.gsviConfiguration.voiceChoices]
            const preset = base.preset
            let current = ""
            if (preset && typeof preset === "object" && !Array.isArray(preset) && typeof preset.voice === "string") {
              current = preset.voice
            }
            if (current && !choices.includes(current)) {
              choices.push(current)
            }
            voice.options = choices
            voice.labels = choices.map((value) => {
              if (view.gsviConfiguration!.voiceChoices.includes(value)) {
                return value
              }
              return value + "（当前选择，服务列表未列出）"
            })
          }
        }
      }
      body.append(
        configForm(definition, {
          scope: view.target.level,
          base,
          overrides: values,
          choices: view.choices,
          secrets: view.secrets,
          secretChanges: secrets,
          changed: () => {
            dirty = true
            render()
          }
        })
      )
    } catch {
      body.append(node("p", "form-error", "配置与当前 schema 不一致，请检查下方字段错误或重新安装可兼容的版本。"))
    }
    for (const issue of view.issues) {
      body.append(node("p", "form-error", issue.path + "：" + issue.message))
    }
    for (const binding of view.bindings) {
      const row = node("div", "config-row")
      const info = node("label", "", binding.title)
      info.htmlFor = "binding-" + binding.alias
      const select = node("select")
      select.id = info.htmlFor
      select.setAttribute("aria-label", binding.title)
      const empty = node("option", "", "请选择服务")
      empty.value = ""
      select.append(empty)
      for (const choice of binding.choices) {
        let name = choice.name
        if (!choice.enabled) {
          name += "（已停用）"
        }
        const option = node("option", "", name)
        option.value = choice.id
        select.append(option)
      }
      select.value = binding.value
      select.required = binding.required
      select.addEventListener("change", () => {
        binding.value = select.value
        dirty = true
      })
      row.append(info, select)
      const selected = binding.choices.find((choice) => {
        return choice.id === binding.value
      })
      let status = "未绑定 · 不可调用"
      if (selected?.enabled) {
        status = "已绑定；调用时复核运行环境、实例 grant 和来源权限"
      }
      if (selected && !selected.enabled) {
        status = "服务已停用 · 不可调用"
      }
      row.append(node("small", "muted", status))
      body.append(row)
    }
    const footer = node("footer", "save-bar")
    const feedback = node("span", "muted")
    const submit = node("button", "button primary", "保存配置")
    submit.type = "submit"
    footer.append(
      feedback,
      button(
        "放弃修改",
        () => {
          void load(view.target).catch(notify)
        },
        "button secondary"
      ),
      submit
    )
    form.addEventListener(
      "input",
      () => {
        dirty = true
        feedback.textContent = "有未保存的修改"
      },
      { capture: true }
    )
    form.addEventListener(
      "change",
      () => {
        dirty = true
      },
      { capture: true }
    )
    form.addEventListener(
      "click",
      (event) => {
        if (event.target instanceof Element && event.target.closest(".secret-editor, .list-editor, .dict-editor")) {
          dirty = true
        }
      },
      { capture: true }
    )
    form.addEventListener("submit", async (event) => {
      event.preventDefault()
      submit.disabled = true
      try {
        view = await request("/api/plugins/" + id + "/configuration", PluginConfigViewSchema, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            revision: view.revision,
            release: view.release,
            target: view.target,
            values,
            secrets: [...secrets.values()],
            services: Object.fromEntries(
              view.bindings
                .filter((entry) => {
                  return entry.kind === "service"
                })
                .map((entry) => {
                  return [entry.alias, entry.value]
                })
            ),
            connectors: Object.fromEntries(
              view.bindings
                .filter((entry) => {
                  return entry.kind === "mcp"
                })
                .map((entry) => {
                  return [entry.alias, entry.value]
                })
            ),
            dependencies: Object.fromEntries(
              view.bindings
                .filter((entry) => {
                  return entry.kind === "plugin"
                })
                .map((entry) => {
                  return [entry.alias, entry.value]
                })
            )
          })
        })
        values = structuredClone(view.values)
        secrets.clear()
        dirty = false
        await saved()
        render()
        notify("插件配置已保存，新请求使用新配置。")
      } catch (error) {
        if (error instanceof ApiValidationError) {
          for (const issue of error.issues) {
            const input = form.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
              "#" + CSS.escape("config-" + issue.path)
            )
            if (input) {
              input.setCustomValidity(issue.message)
              input.addEventListener(
                "input",
                () => {
                  input.setCustomValidity("")
                },
                { once: true }
              )
              input.reportValidity()
              break
            }
          }
        }
        notify(error)
      } finally {
        submit.disabled = false
      }
    })
    form.append(body, footer)
    container.append(form)
  }
  void load().catch(notify)
  return {
    hasDraft() {
      return dirty
    }
  }
}
