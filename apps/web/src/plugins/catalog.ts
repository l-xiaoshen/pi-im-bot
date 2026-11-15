import { node, button, pluginIcon, pill } from "./dom"
import { field, showDialog } from "../dom"
import { request } from "../api"
import { MarketViewSchema } from "@pi-im-bot/plugins/market/contracts"
import { InstallationSchema, type Installation } from "@pi-im-bot/plugins/install/contracts"
import { PluginEditorViewSchema, type PluginEditorView } from "@pi-im-bot/plugins/contracts"
import { configurationId } from "@pi-im-bot/config/identity"

export async function marketPanel(
  root: HTMLElement,
  state: PluginEditorView,
  notify: (error: unknown) => void,
  open: (id: string) => void,
  install: (job: Installation) => void
) {
  let market = await request("/api/plugins/market", MarketViewSchema)
  if (!root.isConnected) {
    return
  }
  const tools = node("div", "toolbar")
  const search = node("input", "search")
  search.placeholder = "搜索插件名称或功能"
  search.setAttribute("aria-label", "搜索插件目录")
  const refresh = button(
    "刷新目录",
    () => {
      refresh.disabled = true
      void request("/api/plugins/market/refresh", MarketViewSchema, { method: "POST" })
        .then((next) => {
          market = next
          render()
        })
        .catch(notify)
        .finally(() => {
          refresh.disabled = false
        })
    },
    "button secondary"
  )
  const sources = button(
    "管理目录源",
    () => {
      const drafts = structuredClone(market.sources)
      const list = node("div")
      function fields() {
        list.replaceChildren()
        for (const [index, source] of drafts.entries()) {
          const name = node("input")
          name.value = source.name
          name.addEventListener("change", () => {
            source.name = name.value
          })
          const url = node("input")
          url.value = source.url
          url.addEventListener("change", () => {
            source.url = url.value
          })
          list.append(
            field("目录名称 " + (index + 1), name),
            field("目录 URL " + (index + 1), url),
            button(
              "移除此目录",
              () => {
                drafts.splice(index, 1)
                fields()
              },
              "text-button danger"
            )
          )
        }
      }
      fields()
      showDialog(
        "插件目录源",
        [
          list,
          button(
            "添加目录源",
            () => {
              drafts.push({ id: "catalog-" + configurationId().slice(0, 8), name: "", url: "" })
              fields()
            },
            "button secondary"
          ),
          node(
            "p",
            "muted",
            "目录源提供静态 JSON 索引。隐藏的 URL 查询参数会保留，输入新完整 URL 可替换。保存后点击刷新目录。"
          )
        ],
        "保存目录源",
        async () => {
          market = await request("/api/plugins/market/sources", MarketViewSchema, {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ revision: state.revision, sources: drafts })
          })
          state = await request("/api/plugins", PluginEditorViewSchema)
          notify("目录源已保存，可以刷新目录。")
          render()
        }
      )
    },
    "button secondary"
  )
  tools.append(search, refresh, sources)
  const list = node("div", "market-grid")
  const errors = node("div")
  const introduction = node("div", "market-intro")
  introduction.append(
    node("h2", "", "发现并安装一项能力"),
    node("p", "", "项目内样例可直接安装。添加社区静态目录源后，可在这里浏览发布包。安装后先配置，再启用。")
  )
  root.replaceChildren(tools, introduction, errors, list)
  function render() {
    if (!root.isConnected) {
      return
    }
    list.replaceChildren()
    errors.replaceChildren()
    for (const error of market.errors) {
      errors.append(node("p", "form-error", error))
    }
    for (const entry of market.entries.filter((entry) => {
      return (entry.name + entry.description).includes(search.value)
    })) {
      const card = node("article", "plugin-card")
      const info = node("div", "plugin-info")
      info.append(
        node("h3", "", entry.name),
        node("p", "description", entry.description),
        node("p", "plugin-meta", entry.author + " · v" + entry.version + " · " + entry.source)
      )
      const actions = node("div", "plugin-actions")
      actions.append(pill(entry.categories.join(" / ") || "插件", "neutral"))
      if (entry.installedId) {
        actions.append(
          button(
            "已安装 · 配置",
            () => {
              open(entry.installedId!)
            },
            "button secondary small"
          )
        )
      }
      if (!entry.installedId || entry.updateAvailable) {
        let label = "安装"
        if (entry.installedId) {
          label = "更新到此包"
        }
        const add = button(
          label,
          () => {
            add.disabled = true
            void request("/api/plugins/market/install", InstallationSchema, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ revision: state.revision, key: entry.key })
            })
              .then(install)
              .catch(notify)
              .finally(() => {
                add.disabled = false
              })
          },
          "button primary small"
        )
        actions.append(add)
      }
      if (entry.installedId && entry.updateAvailable) {
        info.append(node("p", "muted", "已安装 " + entry.installedVersion + " · 此源有不同的发布包"))
      }
      card.append(pluginIcon(entry.name), info, actions)
      list.append(card)
    }
  }
  search.addEventListener("input", render)
  render()
}
