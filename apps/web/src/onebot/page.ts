import type { Snapshot } from "@pi-im-bot/contracts/http"
import { targetKey } from "@pi-im-bot/channels/onebot/config"
import type { OneBotStatus, RouteReason } from "@pi-im-bot/channels/onebot/status"
import { element, button, time } from "../dom"
import { botWebSocketUrl } from "../bot-origin"
import { mutate } from "../api"
import { pageTitle, type PageActions } from "../pages"
import { connectionDialog, saveSettings, targetDialog } from "./dialogs"

const ROUTES: Record<RouteReason, string> = {
  recorded: "已同步，未触发 Agent",
  command: "已处理内置指令",
  agent: "已触发 Agent",
  duplicate: "重复消息已去重",
  uncertain: "指令结果不确定，请核对",
  unmatched: "未找到对应会话",
  not_selected: "未启用的测试目标",
  self: "自身账号消息，仅同步",
  invalid: "消息格式或账号不匹配",
  disabled: "QQ 接入已停用",
  error: "处理失败，请查看服务日志"
}

export function showOneBot(container: HTMLElement, snapshot: Snapshot, actions: PageActions) {
  const settings = snapshot.onebotSettings
  let status = snapshot.onebot
  const page = element("div", "settings-page")
  const header = pageTitle("QQ 接入", "OneBot v11 反向 WebSocket · NapCat")
  header.append(
    button("刷新状态", () => {
      void actions.refresh().catch(actions.notify)
    })
  )
  const connection = element("section", "card")
  const heading = element("div", "card-heading")
  heading.append(
    element("h2", "", "连接配置"),
    button("配置连接", () => {
      connectionDialog(settings, actions)
    })
  )
  let token = "未设置 Token"
  if (settings.tokenConfigured) {
    token = "Token 已配置"
  }
  connection.append(
    heading,
    element("code", "file-path", botWebSocketUrl(settings.path)),
    element("p", "muted", token + " · NapCat 消息格式建议 Array。Token 使用反向 WS 客户端的 Token 字段。"),
    element(
      "p",
      "",
      "QQ 群渠道消息会同步到对应渠道窗口。/help、/status、/stop、/new 可直接发送；" +
        settings.commandPrefix +
        " 内容触发 Agent。"
    )
  )
  const diagnostics = element("section", "card onebot-diagnostics")
  const targets = element("section", "card")
  const title = element("div", "card-heading")
  title.append(
    element("h2", "", "测试渠道（群）"),
    button(
      "新增测试渠道",
      () => {
        targetDialog(settings, status, actions)
      },
      "button primary"
    )
  )
  targets.append(title)
  if (settings.targets.length === 0) {
    targets.append(element("p", "empty-note", "尚未启用测试渠道。可以从已发现 QQ 渠道选择，或手动填写账号和群号。"))
  }
  for (const target of settings.targets) {
    const row = element("div", "candidate onebot-target")
    row.dataset.target = targetKey(target)
    const info = element("div")
    info.append(
      element("strong", "", target.name),
      element("small", "", "群 " + target.chatId + " · 机器人 " + target.selfId)
    )
    const controls = element("div", "button-row")
    let label = "已停用"
    if (target.enabled && settings.enabled) {
      label = "已启用"
    }
    if (target.enabled && !settings.enabled) {
      label = "接入总开关已关闭"
    }
    controls.append(element("span", "badge", label))
    const room = snapshot.rooms.find((room) => {
      return (
        room.address.channel === "onebot-v11" &&
        room.address.accountId === target.selfId &&
        room.address.chatId === target.chatId
      )
    })
    if (room) {
      controls.append(
        button("查看渠道", () => {
          void actions.openRoom(room.id).catch(actions.notify)
        })
      )
    }
    controls.append(
      button("更换群", () => {
        targetDialog(settings, status, actions, target)
      })
    )
    let toggleLabel = "启用"
    if (target.enabled) {
      toggleLabel = "停用"
    }
    controls.append(
      button(toggleLabel, () => {
        const next = settings.targets.map((item) => {
          if (targetKey(item) === targetKey(target)) {
            return { ...item, enabled: !item.enabled }
          }
          return item
        })
        void saveSettings(settings, { targets: next }).then(actions.refresh).catch(actions.notify)
      })
    )
    row.append(info, controls)
    targets.append(row)
  }
  const discovered = element("section", "card")
  page.append(header, connection, diagnostics, targets, discovered)
  container.replaceChildren(page)

  function update(next: OneBotStatus) {
    status = next
    let connectionLabel = "尚未连接"
    if (status.connected) {
      connectionLabel = "已连接 · " + status.accounts.join(", ")
    }
    diagnostics.replaceChildren(
      element("h2", "", connectionLabel),
      element("p", "", "收到 " + status.received + " 条消息 · 已同步处理 " + status.recorded + " 条")
    )
    if (status.lastReceivedAt) {
      diagnostics.append(element("p", "muted", "最后收消息：" + time(status.lastReceivedAt)))
    }
    if (status.lastAuthFailure) {
      diagnostics.append(
        element(
          "p",
          "form-error",
          "最近握手拒绝：" + time(status.lastAuthFailure.at) + " · " + status.lastAuthFailure.reason
        )
      )
    }
    const recent = element("div", "onebot-recent")
    for (const entry of status.recent.slice(0, 8)) {
      recent.append(
        element(
          "p",
          "muted",
          time(entry.at) + " · 账号 " + entry.selfId + " · 群 " + (entry.chatId ?? "—") + " · " + ROUTES[entry.reason]
        )
      )
    }
    diagnostics.append(recent)
    const discoveryTitle = element("div", "card-heading")
    discoveryTitle.append(element("h2", "", "已发现 QQ 渠道"))
    const refresh = button("刷新 QQ 群列表", () => {
      void refreshGroups().catch(actions.notify)
    })
    refresh.disabled = status.accounts.length === 0
    discoveryTitle.append(refresh)
    discovered.replaceChildren(discoveryTitle)
    if (status.chats.length === 0) {
      discovered.append(
        element("p", "empty-note", "等待 NapCat 上报，或刷新 QQ 渠道列表。讨论组可通过新消息上报发现标识。")
      )
    }
    for (const chat of status.chats) {
      if (chat.kind !== "group") {
        continue
      }
      const row = element("div", "candidate")
      const info = element("div")
      info.append(
        element("strong", "", chat.name),
        element("small", "", "群 " + chat.chatId + " · 账号 " + chat.selfId)
      )
      row.append(
        info,
        button("选择为测试群", () => {
          targetDialog(settings, status, actions, undefined, chat)
        })
      )
      discovered.append(row)
    }
  }
  async function refreshGroups() {
    for (const selfId of status.accounts) {
      await mutate("/api/onebot/groups/refresh", { selfId })
    }
    await actions.refresh()
  }
  update(status)
  return { update }
}
