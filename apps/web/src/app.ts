import { z } from "zod"
import { AppEventSchema, type AppEvent } from "@pi-im-bot/contracts/events"
import { SnapshotSchema, RoomDetailSchema, type Snapshot, type RoomDetail } from "@pi-im-bot/contracts/http"
import { RoomSchema } from "@pi-im-bot/contracts/message"
import { botWebSocketUrl } from "./bot-origin"
import type { ChatMessage } from "@pi-im-bot/contracts/message"
import { request, mutate } from "./api"
import { element, button, field, showDialog } from "./dom"
import { createChatView } from "./chat"
import type { ChatDraft } from "./media-composer"
import { showSchedules, type PageActions } from "./pages"
import { showOneBot } from "./onebot/page"
import { showProviders } from "./providers/page"
import { showFramework } from "./settings/page"
import { showResources } from "./resources/page"
import { showJobs } from "./jobs/page"
import { showPluginCenter } from "./plugins/page"

const ViewSchema = z.enum(["chat", "providers", "schedules", "onebot", "settings", "resources", "jobs", "plugins"])
type View = z.infer<typeof ViewSchema>
const page = document.querySelector<HTMLElement>("#page")!
const roomList = document.querySelector<HTMLElement>("#room-list")!
const toast = document.querySelector<HTMLElement>("#toast")!
let toastTimer: ReturnType<typeof setTimeout> | undefined
let state: Snapshot
let detail: RoomDetail | undefined
let activeRoom = localStorage.getItem("pi.activeRoom") ?? ""
let view: View = "chat"
let settingsRoom = ""
let chatView: ReturnType<typeof createChatView> | undefined
let onebotView: ReturnType<typeof showOneBot> | undefined
let pluginView: ReturnType<typeof showPluginCenter> | undefined
let loadSequence = 0
let loadingRoom = ""
let loadingMessages: ChatMessage[] = []
const previews = new Map<string, string>()
const drafts = new Map<string, ChatDraft>()

function notify(error: unknown) {
  toast.textContent = String(error)
  toast.hidden = false
  if (toastTimer) {
    clearTimeout(toastTimer)
  }
  toastTimer = setTimeout(() => {
    toast.hidden = true
  }, 6500)
}

const pageActions: PageActions = {
  async reload() {
    await mutate("/api/config/reload")
    await refresh()
    notify("配置已重载，新任务将使用新配置。")
  },
  refresh,
  async openRoom(id) {
    view = "chat"
    await selectRoom(id)
  },
  notify
}

async function refresh() {
  state = await request("/api/state", SnapshotSchema)
  if (
    !state.rooms.some((room) => {
      return room.id === activeRoom
    })
  ) {
    activeRoom = state.rooms[0]?.id ?? ""
  }
  renderSidebar()
  if (view === "chat" && activeRoom) {
    await selectRoom(activeRoom, true)
  } else {
    renderPage()
  }
}

function renderSidebar() {
  roomList.replaceChildren()
  const platforms = new Map<string, typeof state.rooms>()
  for (const room of state.rooms) {
    const key = room.address.channel + ":" + room.address.accountId
    const rooms = platforms.get(key) ?? []
    rooms.push(room)
    platforms.set(key, rooms)
  }
  for (const [key, rooms] of platforms) {
    const platform = element("section", "platform-group")
    const [channel, accountId] = key.split(":")
    let platformName = channel
    if (channel === "onebot-v11") {
      platformName = "QQ"
    } else if (channel === "mock") {
      platformName = "Mock"
    }
    platform.append(element("h3", "platform-heading", platformName + " · " + accountId))
    for (const room of rooms) {
      const item = button(
        "",
        () => {
          view = "chat"
          void selectRoom(room.id).catch(notify)
        },
        "room-item"
      )
      if (room.id === activeRoom) {
        item.classList.add("active")
      }
      let marker = "#"
      let kind = "群渠道"
      if (room.address.kind === "direct") {
        marker = "↗"
        kind = "私聊渠道"
      }
      const label = element("div")
      label.append(element("strong", "", room.name), element("small", "", kind + " · " + room.address.chatId))
      item.append(element("span", "room-marker", marker), label)
      platform.append(item)
    }
    roomList.append(platform)
  }
  for (const item of document.querySelectorAll<HTMLButtonElement>("[data-view]")) {
    item.classList.toggle("active", item.dataset.view === view)
  }
}

async function selectRoom(id: string, force = false) {
  if (!force && activeRoom === id && detail?.room.id === id) {
    renderSidebar()
    if (!chatView) {
      renderPage()
    }
    return
  }
  activeRoom = id
  localStorage.setItem("pi.activeRoom", id)
  const sequence = ++loadSequence
  loadingRoom = id
  loadingMessages = []
  page.inert = true
  page.setAttribute("aria-busy", "true")
  try {
    const loaded = await request(`/api/rooms/${id}`, RoomDetailSchema)
    if (sequence !== loadSequence || activeRoom !== id) {
      return
    }
    for (const message of loadingMessages) {
      upsert(loaded.messages, message)
    }
    loaded.messages.sort((a, b) => {
      return a.createdAt - b.createdAt
    })
    loadingRoom = ""
    loadingMessages = []
    detail = loaded
    renderSidebar()
    renderPage()
  } finally {
    if (sequence === loadSequence) {
      loadingRoom = ""
      loadingMessages = []
      page.inert = false
      page.setAttribute("aria-busy", "false")
    }
  }
}

function renderPage() {
  chatView = undefined
  onebotView = undefined
  if (view === "plugins") {
    if (!pluginView?.connected()) {
      pluginView = showPluginCenter(page, pageActions)
    }
    return
  }
  pluginView = undefined
  if (view === "providers") {
    showProviders(page, state, pageActions)
    return
  }
  if (view === "schedules") {
    showSchedules(page, state, pageActions)
    return
  }
  if (view === "onebot") {
    onebotView = showOneBot(page, state, pageActions)
    return
  }
  if (view === "settings") {
    showFramework(page, state, pageActions, settingsRoom)
    return
  }
  if (view === "resources") {
    showResources(page, pageActions)
    return
  }
  if (view === "jobs") {
    showJobs(page, state, pageActions)
    return
  }
  if (!detail) {
    page.replaceChildren(element("p", "empty-note", "请选择一个渠道，或创建 Mock 渠道。"))
    return
  }
  const roomId = detail.room.id
  chatView = createChatView(
    page,
    state,
    detail,
    {
      async send(draft, actorId, actorName) {
        await mutate(`/api/rooms/${roomId}/messages`, {
          text: draft.text,
          actorId,
          actorName,
          mediaIds: draft.attachments.map((attachment) => {
            return attachment.mediaId
          }),
          replyTo: draft.replyTo
        })
      },
      async configure(mode, providerGroup) {
        const current = await request(`/api/rooms/${roomId}`, RoomDetailSchema)
        if (current.room.mode !== mode) {
          await mutate(`/api/rooms/${roomId}`, { mode, revision: current.room.revision }, "PATCH")
        }
        const conversation = current.conversations.find((item) => {
          return item.id === current.room.currentConversationId
        })!
        await mutate(
          `/api/rooms/${roomId}/conversations/${conversation.id}`,
          {
            revision: conversation.revision,
            settings: {
              ...conversation.settings,
              preferences: { ...conversation.settings.preferences, providerGroup }
            }
          },
          "PATCH"
        )
        await refresh()
      },
      async stop() {
        await mutate(`/api/rooms/${roomId}/stop`)
      },
      async reset() {
        await mutate(`/api/rooms/${roomId}/new`)
        await selectRoom(roomId, true)
      },
      async selectConversation(id) {
        await mutate(`/api/rooms/${roomId}/conversations/${id}/select`)
        await selectRoom(roomId, true)
      },
      settings() {
        view = "settings"
        settingsRoom = roomId
        renderSidebar()
        renderPage()
      },
      async recall(message) {
        await mutate(`/api/rooms/${roomId}/recall`, { messageId: message.id })
      },
      draft(draft) {
        drafts.set(roomId, draft)
      },
      notify
    },
    drafts.get(roomId) ?? { text: "", attachments: [] }
  )
}

function upsert<T extends { id: string }>(items: T[], item: T) {
  const index = items.findIndex((current) => {
    return current.id === item.id
  })
  if (index >= 0) {
    items[index] = item
  } else {
    items.push(item)
  }
}

function onEvent(event: AppEvent) {
  // A message can arrive after the history query starts but before its reply.
  // Merge those arrivals into the loaded snapshot instead of dropping them.
  if (event.type === "message" && event.message.roomId === loadingRoom) {
    loadingMessages.push(event.message)
    loadingMessages = loadingMessages.slice(-200)
  }
  if (event.type === "config") {
    if (view === "settings" || view === "resources") {
      return
    }
    void refresh().catch(notify)
    return
  }
  if (event.type === "room") {
    upsert(state.rooms, event.room)
    if (detail?.room.id === event.room.id) {
      const changedConversation = detail.room.currentConversationId !== event.room.currentConversationId
      detail.room = event.room
      if (changedConversation && view === "chat") {
        void selectRoom(event.room.id, true).catch(notify)
      }
    }
    renderSidebar()
  }
  if (event.type === "job") {
    upsert(state.jobs, event.job)
    state.jobs.sort((a, b) => {
      return b.createdAt - a.createdAt
    })
    if (view === "jobs") {
      renderPage()
    }
  }
  if (event.type === "run") {
    upsert(state.runs, event.run)
    if (detail?.room.id === event.run.roomId) {
      upsert(detail.runs, event.run)
      detail.runs.sort((a, b) => {
        return b.createdAt - a.createdAt
      })
    }
  }
  if (event.type === "message" && detail?.room.id === event.message.roomId) {
    detail.messages = detail.messages.filter((message) => {
      return !event.removedIds?.includes(message.id)
    })
    upsert(detail.messages, event.message)
    detail.messages.sort((a, b) => {
      return a.createdAt - b.createdAt
    })
  }
  if (event.type === "trace" && detail?.room.id === event.trace.roomId) {
    upsert(detail.traces, event.trace)
    detail.traces = detail.traces.slice(-200)
  }
  if (event.type === "preview") {
    if (event.text) {
      previews.set(event.runId, event.text)
    } else {
      previews.delete(event.runId)
    }
  }
  if (event.type === "schedules") {
    state.schedules = event.schedules
    if (view === "schedules") {
      renderPage()
    }
  }
  if (event.type === "onebot_status") {
    state.onebot = event.status
    onebotView?.update(event.status)
  }
  if (chatView && detail && view === "chat") {
    let preview = ""
    for (const run of detail.runs) {
      if (run.status === "running" && run.source !== "job") {
        preview = previews.get(run.id) ?? ""
        break
      }
    }
    chatView.update(detail, preview)
  }
}

function connectEvents() {
  const socket = new WebSocket(botWebSocketUrl("/api/events"))
  const label = document.querySelector<HTMLElement>("#connection-label")!
  const dot = document.querySelector<HTMLElement>("#connection-dot")!
  socket.addEventListener("open", () => {
    void refresh()
      .then(() => {
        label.textContent = "工作台已连接"
        dot.classList.add("online")
      })
      .catch(notify)
  })
  socket.addEventListener("message", (message) => {
    try {
      const event = AppEventSchema.safeParse(JSON.parse(String(message.data)))
      if (event.success) {
        onEvent(event.data)
      }
    } catch {
      notify("收到无法读取的事件，请刷新页面。")
    }
  })
  socket.addEventListener("close", () => {
    label.textContent = "连接断开，重试中"
    dot.classList.remove("online")
    setTimeout(connectEvents, 2000)
  })
}

async function initialize() {
  page.append(element("p", "empty-note", "正在加载工作台…"))
  await refresh()
  for (const item of document.querySelectorAll<HTMLButtonElement>("[data-view]")) {
    item.addEventListener("click", () => {
      view = ViewSchema.parse(item.dataset.view)
      settingsRoom = ""
      renderSidebar()
      if (view === "chat") {
        renderPage()
      } else {
        void refresh().catch(notify)
      }
    })
  }
  document.querySelector("#new-room")!.addEventListener("click", () => {
    const name = element("input")
    name.placeholder = "渠道名称"
    name.required = true
    const kind = element("select")
    for (const [value, label] of [
      ["group", "群聊"],
      ["direct", "私聊"]
    ]) {
      const option = element("option", "", label)
      option.value = value
      kind.append(option)
    }
    showDialog("新建 Mock 渠道", [field("渠道名称", name), field("渠道类型", kind)], "创建渠道", async () => {
      const room = await request("/api/rooms", RoomSchema, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: name.value, kind: kind.value })
      })
      view = "chat"
      await refresh()
      await selectRoom(room.id)
    })
  })
  connectEvents()
}

void initialize().catch((error) => {
  page.replaceChildren(
    element("h1", "", "工作台暂时无法连接"),
    element("p", "", String(error)),
    button("重新加载", () => {
      location.reload()
    })
  )
})
