import { comfyResources } from "./comfy"
import { element, button } from "../dom"
import { request, mutate } from "../api"
import { pageTitle, type PageActions } from "../pages"
import { ResourcesViewSchema, type ResourcesView } from "@pi-im-bot/resources/contracts"
import { editMcp } from "./mcp-form"
import { editSkill } from "./skill-form"
import { editGsvi } from "./gsvi-form"

export function showResources(container: HTMLElement, actions: PageActions) {
  const page = element("div", "settings-page resource-page")
  const header = pageTitle("服务与技能", "登记外部工具服务和技能包，在 Bot 设置中选择范围、工具和收纳策略。")
  const content = element("div")
  const feedback = element("p", "provider-feedback")
  let library: ResourcesView
  page.append(header, feedback, content)
  container.replaceChildren(page)

  async function load() {
    const next = await request("/api/resources", ResourcesViewSchema)
    if (!page.isConnected) {
      return
    }
    library = next
    render()
  }
  const headerActions = element("div", "header-actions")
  header.append(headerActions)
  headerActions.append(
    button(
      "新增 MCP",
      () => {
        editMcp(undefined, async (server) => {
          await mutate("/api/resources/mcp", { revision: library.revision, server })
          await load()
        })
      },
      "button primary"
    ),
    button(
      "刷新",
      () => {
        void load().catch(actions.notify)
      },
      "button secondary"
    )
  )
  headerActions.append(
    button(
      "新增语音服务",
      () => {
        editGsvi(undefined, async (service) => {
          await mutate("/api/resources/services", { revision: library.revision, service })
          await load()
        })
      },
      "button primary"
    )
  )
  headerActions.append(
    button(
      "新增 Skill",
      () => {
        editSkill(undefined, async (skill) => {
          await mutate("/api/resources/skills", { revision: library.revision, skill })
          await load()
        })
      },
      "button primary"
    )
  )

  function render() {
    content.replaceChildren()
    comfyResources(content, library, load, actions.notify)
    content.append(element("h2", "", "具名语音服务"))
    if (!library.services.length) {
      content.append(element("div", "card", "尚未配置语音服务。添加 GSVI 后，在插件实例配置中绑定。"))
    }
    for (const service of library.services) {
      const card = element("section", "card")
      card.append(element("h2", "", service.name), element("p", "muted", service.endpoint))
      let status = "已配置 · 可绑定 · 尚未验证连通性"
      if (!service.enabled) {
        status = "已停用 · 不可调用"
      }
      card.append(element("p", "", status))
      card.append(
        button(
          "编辑语音服务",
          () => {
            editGsvi(service, async (draft) => {
              await mutate(
                "/api/resources/services/" + service.id,
                { revision: library.revision, service: draft },
                "PUT"
              )
              await load()
            })
          },
          "button secondary"
        )
      )
      card.append(
        button(
          "删除语音服务",
          () => {
            void mutate("/api/resources/services/" + service.id, { revision: library.revision }, "DELETE")
              .then(load)
              .catch(actions.notify)
          },
          "button secondary"
        )
      )
      content.append(card)
    }
    content.append(element("h2", "", "MCP 服务"))
    if (library.mcp.length === 0) {
      content.append(
        element("div", "card", "尚未登记 MCP。保存连接设置后，点击“连接并刷新目录”，只读取工具定义，不执行工具。")
      )
    }
    for (const server of library.mcp) {
      const card = element("section", "card")
      const heading = element("div", "card-heading")
      const buttons = element("div", "button-row")
      buttons.append(
        button(
          "编辑",
          () => {
            editMcp(server, async (draft) => {
              await mutate("/api/resources/mcp/" + server.id, { revision: library.revision, server: draft }, "PUT")
              await load()
            })
          },
          "button secondary"
        )
      )
      const refresh = button("连接并刷新目录", () => {
        refresh.disabled = true
        feedback.textContent = "正在连接 " + server.name + "…"
        void mutate("/api/resources/mcp/" + server.id + "/refresh", { revision: library.revision })
          .then(async () => {
            feedback.classList.remove("is-error")
            feedback.textContent = "目录已更新。新任务使用最新定义，正在执行的任务保留原定义。"
            await load()
          })
          .catch((error) => {
            feedback.classList.add("is-error")
            feedback.textContent = String(error)
          })
          .finally(() => {
            refresh.disabled = false
          })
      })
      buttons.append(
        refresh,
        button(
          "删除",
          () => {
            void mutate("/api/resources/mcp/" + server.id, { revision: library.revision }, "DELETE")
              .then(load)
              .catch(actions.notify)
          },
          "button secondary"
        )
      )
      heading.append(element("h2", "", server.name), buttons)
      let status = "尚未读取目录"
      if (server.state === "disabled") {
        status = "已停用"
      } else if (server.state === "ready") {
        status = "目录已缓存 · " + server.tools.length + " 项工具"
      }
      card.append(heading, element("p", "muted", server.endpoint), element("p", "", status))
      for (const tool of server.tools) {
        const details = element("details", "resource-tool")
        details.append(
          element("summary", "", tool.title ?? tool.name),
          element("p", "muted", tool.capabilityId),
          element("p", "", tool.description ?? ""),
          element("pre", "settings-effective", JSON.stringify(tool.inputSchema, null, 2))
        )
        if (!tool.available) {
          details.append(element("p", "muted", "该工具要求 MCP Tasks，当前未装载。"))
        } else if (tool.asynchronous) {
          details.append(element("p", "muted", "使用持久后台任务；调用立即返回任务 ID，完成后交付结果。"))
        }
        card.append(details)
      }
      content.append(card)
    }
    content.append(element("h2", "", "Skill 包"))
    if (library.skills.length === 0) {
      content.append(element("div", "card", "尚未登记 Skill。支持标准 SKILL.md 技能包；导入不会执行包内脚本。"))
    }
    for (const skill of library.skills) {
      const card = element("section", "card")
      const heading = element("div", "card-heading")
      const buttons = element("div", "button-row")
      buttons.append(
        button(
          "编辑",
          () => {
            editSkill(skill, async (draft) => {
              await mutate("/api/resources/skills/" + skill.id, { revision: library.revision, skill: draft }, "PUT")
              await load()
            })
          },
          "button secondary"
        )
      )
      const importButton = button("导入 / 更新快照", () => {
        importButton.disabled = true
        feedback.textContent = "正在导入 " + skill.name + "…"
        void mutate("/api/resources/skills/" + skill.id + "/import", { revision: library.revision })
          .then(async () => {
            feedback.classList.remove("is-error")
            feedback.textContent = "Skill 快照已更新，新任务使用新的版本。"
            await load()
          })
          .catch((error) => {
            feedback.classList.add("is-error")
            feedback.textContent = String(error)
          })
          .finally(() => {
            importButton.disabled = false
          })
      })
      buttons.append(
        importButton,
        button(
          "删除",
          () => {
            void mutate("/api/resources/skills/" + skill.id, { revision: library.revision }, "DELETE")
              .then(load)
              .catch(actions.notify)
          },
          "button secondary"
        )
      )
      heading.append(element("h2", "", skill.name), buttons)
      let status = "尚未导入"
      if (skill.state === "disabled") {
        status = "已停用"
      } else if (skill.manifest) {
        status = "已导入 · " + skill.manifest.revision.slice(0, 12)
      }
      card.append(heading, element("p", "muted", skill.sourceDir), element("p", "", status))
      if (skill.manifest) {
        card.append(
          element("p", "", skill.manifest.description),
          element("small", "muted", `${skill.manifest.files.length} 个包文件 · 权限标识 skill:${skill.id}`)
        )
        if (skill.manifest.disableModelInvocation) {
          card.append(element("p", "muted", `需在消息中显式使用 /skill ${skill.id} 才向本轮提供。`))
        }
      }
      content.append(card)
    }
  }
  void load().catch(actions.notify)
}
