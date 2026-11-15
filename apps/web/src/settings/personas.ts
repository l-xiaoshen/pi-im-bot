import { element, button, field, showDialog } from "../dom"
import type { FrameworkEditorState } from "@pi-im-bot/contracts/http"
import { PersonaSchema, type Persona } from "@pi-im-bot/settings/schema"

export function personaLibrary(library: FrameworkEditorState, save: (personas: Persona[]) => Promise<void>) {
  const card = element("section", "card persona-library")
  card.append(element("h2", "", "人格资源"))
  function edit(persona?: Persona) {
    const id = element("input")
    id.value = persona?.id ?? ""
    id.required = true
    id.disabled = Boolean(persona)
    const name = element("input")
    name.value = persona?.name ?? ""
    name.required = true
    const prompt = element("textarea")
    prompt.rows = 10
    prompt.value = persona?.prompt ?? ""
    showDialog(
      "编辑人格",
      [field("人格 ID", id), field("名称", name), field("人格提示", prompt)],
      "保存人格",
      async () => {
        const next = PersonaSchema.parse({ id: id.value, name: name.value, prompt: prompt.value })
        const personas = library.config.personas.filter((item) => {
          return item.id !== next.id
        })
        personas.push(next)
        await save(personas)
      }
    )
  }
  card.append(element("p", "muted", "同一聊天范围共享人格。编辑后新任务使用新版本，正在执行的任务保留原版本。"))
  for (const persona of library.config.personas) {
    const row = element("div", "persona-row")
    row.append(
      element("span", "", `${persona.name} · ${persona.id}`),
      button(
        "编辑",
        () => {
          edit(persona)
        },
        "button secondary"
      )
    )
    card.append(row)
  }
  card.append(
    button("新增人格", () => {
      edit()
    })
  )
  return card
}
