import { node, button, pill } from "./dom"
import type { SecretChange } from "@pi-im-bot/plugins/configuration/secrets"
import type { ConfigField } from "@pi-im-bot/plugins/configuration/schema"
import { z } from "zod"

export function secretField(
  field: ConfigField,
  path: string,
  configured: boolean,
  changes: Map<string, SecretChange>,
  changed: () => void
) {
  const root = node("div", "secret-editor")
  function render() {
    root.replaceChildren(pill("尚未设置", "neutral"))
    if (configured) {
      root.replaceChildren(pill("已设置 · 原值保留", "green"))
    }
    const change = changes.get(path)
    if (change?.action === "clear") {
      root.replaceChildren(pill("保存后清除", "amber"))
    }
    if (change?.action === "set") {
      let input: HTMLInputElement | HTMLTextAreaElement
      if (field.type === "list") {
        input = node("textarea")
        input.rows = 3
        input.value = z.array(z.string()).parse(change.value).join("\n")
      } else {
        input = node("input")
        input.type = "password"
        input.autocomplete = "new-password"
        input.value = String(change.value)
      }
      input.setAttribute("aria-label", field.description + " 新值")
      input.addEventListener("input", () => {
        let value: string | string[] = input.value
        if (field.type === "list") {
          value = input.value.split("\n").filter(Boolean)
        }
        changes.set(path, { action: "set", path, value })
      })
      root.append(input)
    }
    const buttons = node("div", "inline-controls")
    buttons.append(
      button(
        "替换",
        () => {
          let value: string | string[] = ""
          if (field.type === "list") {
            value = []
          }
          changes.set(path, { action: "set", path, value })
          changed()
          render()
        },
        "text-button"
      ),
      button(
        "清除",
        () => {
          changes.set(path, { action: "clear", path })
          changed()
          render()
        },
        "text-button danger"
      )
    )
    if (change) {
      buttons.append(
        button(
          "保留原值",
          () => {
            changes.delete(path)
            changed()
            render()
          },
          "text-button"
        )
      )
    }
    root.append(buttons)
  }
  render()
  return root
}
