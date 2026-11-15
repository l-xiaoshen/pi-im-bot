import { element, button, time, count } from "./dom"
import type { Snapshot, RoomDetail } from "@pi-im-bot/contracts/http"
import type { ChatMessage } from "@pi-im-bot/contracts/message"
import type { Trace } from "@pi-im-bot/contracts/run"
import { oneBotAllowed } from "@pi-im-bot/channels/onebot/config"
import { renderAttachment } from "./media"
import { createMediaComposer, type ChatDraft } from "./media-composer"

export interface ChatActions {
  send(draft: ChatDraft, actorId: string, actorName: string): Promise<void>
  configure(mode: "demo" | "live", group: string): Promise<void>
  stop(): Promise<void>
  reset(): Promise<void>
  selectConversation(id: string): Promise<void>
  settings(): void
  recall(message: ChatMessage): Promise<void>
  draft(draft: ChatDraft): void
  notify(error: unknown): void
}

export function createChatView(
  container: HTMLElement,
  snapshot: Snapshot,
  detail: RoomDetail,
  actions: ChatActions,
  initialDraft: ChatDraft = { text: "", attachments: [] }
) {
  const root = element("div", "chat-page")
  const header = element("header", "page-header")
  const heading = element("div")
  const roomTitle = element("h1", "", detail.room.name)
  const kindLabel = detail.room.address.kind === "direct" ? "私聊渠道" : "群渠道"
  const platformLabel =
    detail.room.address.channel === "onebot-v11"
      ? "QQ"
      : detail.room.address.channel === "mock"
        ? "Mock"
        : detail.room.address.channel
  const subtitle = element("p", "subtitle", platformLabel + " · " + kindLabel + " · 共享会话上下文")
  const isQQ = detail.room.address.channel === "onebot-v11"
  const roomEnabled = !isQQ || oneBotAllowed(snapshot.onebotSettings, detail.room.address)
  if (isQQ) {
    subtitle.textContent = "QQ 群渠道消息实时同步；从网页发起的任务会交付到此渠道，当前会话上下文独立选择。"
  }
  heading.append(roomTitle, subtitle)
  const headerActions = element("div", "header-actions")
  const inspect = button(
    "记录",
    () => {
      const visible = root.classList.toggle("show-inspector")
      inspect.textContent = "记录"
      if (visible) {
        inspect.textContent = "聊天"
      }
    },
    "button secondary mobile-only"
  )
  headerActions.append(inspect)
  headerActions.append(
    button(
      "新建共享对话",
      () => {
        void actions.reset().catch(actions.notify)
      },
      "button secondary"
    )
  )
  headerActions.append(button("渠道设置", actions.settings, "button secondary"))
  header.append(heading, headerActions)
  const toolbar = element("div", "chat-toolbar")
  const mode = element("select")
  mode.setAttribute("aria-label", "模型模式")
  const demoOption = element("option", "", "离线演示")
  demoOption.value = "demo"
  const liveOption = element("option", "", "真实模型")
  liveOption.value = "live"
  mode.append(demoOption, liveOption)
  mode.value = detail.room.mode
  const group = element("select")
  group.setAttribute("aria-label", "Provider 组")
  for (const item of snapshot.providers.groups) {
    let label = item.name
    if (!item.ready) {
      label += " · 未配置"
    }
    const option = element("option", "", label)
    option.value = item.id
    group.append(option)
  }
  group.value = detail.effective.settings.preferences.providerGroup
  async function changed() {
    let value: "demo" | "live" = "demo"
    if (mode.value === "live") {
      value = "live"
    }
    try {
      await actions.configure(value, group.value)
    } catch (error) {
      actions.notify(error)
    }
  }
  mode.addEventListener("change", () => {
    void changed()
  })
  group.addEventListener("change", () => {
    void changed()
  })
  const modeHint = element("span", "mode-hint")
  const conversations = element("select")
  conversations.setAttribute("aria-label", "当前会话上下文")
  for (const conversation of detail.conversations) {
    if (conversation.kind !== "root") {
      continue
    }
    const option = element(
      "option",
      "",
      conversation.title + " · " + new Date(conversation.createdAt).toLocaleString("zh-CN")
    )
    option.value = conversation.id
    conversations.append(option)
  }
  conversations.value = detail.room.currentConversationId
  conversations.addEventListener("change", () => {
    void actions.selectConversation(conversations.value).catch(actions.notify)
  })
  const personaHint = element("span", "mode-hint", `人格：${detail.effective.persona.name}`)
  toolbar.append(element("span", "label-muted", "执行模式"), mode, group, modeHint, conversations, personaHint)
  const body = element("div", "chat-body")
  const conversation = element("section", "conversation")
  const messages = element("div", "messages")
  messages.setAttribute("aria-label", "聊天记录")
  const composer = element("form", "composer")
  const actorBar = element("div", "actor-bar")
  const actorName = element("input")
  actorName.value = localStorage.getItem("pi.actorName") ?? "开发者"
  actorName.setAttribute("aria-label", "模拟成员名称")
  const actorId = element("input")
  actorId.value = localStorage.getItem("pi.actorId") ?? "developer"
  actorId.setAttribute("aria-label", "模拟成员 ID")
  actorBar.append(element("span", "label-muted", "模拟成员"), actorName, actorId)
  const input = element("textarea")
  input.rows = 3
  input.placeholder = "发送消息给 Pi，或输入 /help 查看指令…"
  input.setAttribute("aria-label", "消息内容")
  input.maxLength = 20000
  input.value = initialDraft.text
  input.disabled = !roomEnabled
  if (!roomEnabled) {
    input.placeholder = "此 QQ 会话已停用。历史记录保留，请在 QQ 接入中重新启用。"
  }
  input.addEventListener("input", () => {
    actions.draft(media.snapshot(input.value))
  })
  actorName.addEventListener("input", () => {
    localStorage.setItem("pi.actorName", actorName.value)
  })
  actorId.addEventListener("input", () => {
    localStorage.setItem("pi.actorId", actorId.value)
  })
  const composerFooter = element("div", "composer-footer")
  const keyboardHint = element("small", "", "Enter 发送 · Shift + Enter 换行")
  const stop = button(
    "停止",
    () => {
      void actions.stop().catch(actions.notify)
    },
    "button secondary"
  )
  const send = element("button", "button primary", "发送消息")
  send.type = "submit"
  send.disabled = !roomEnabled
  const media = createMediaComposer(
    detail.room.id,
    initialDraft,
    () => {
      send.disabled = !roomEnabled || media.busy
      actions.draft(media.snapshot(input.value))
    },
    actions.notify
  )
  const composerButtons = element("div", "button-row")
  composerButtons.append(stop, send)
  composerFooter.append(keyboardHint, composerButtons)
  composer.append(actorBar, media.root, input, composerFooter)
  composer.addEventListener("submit", async (event) => {
    event.preventDefault()
    const text = input.value.trim()
    const draft = media.snapshot(text)
    if ((!text && draft.attachments.length === 0) || !roomEnabled || media.busy) {
      return
    }
    send.disabled = true
    try {
      await actions.send(draft, actorId.value || "developer", actorName.value || "开发者")
      localStorage.setItem("pi.actorName", actorName.value)
      localStorage.setItem("pi.actorId", actorId.value)
      input.value = ""
      media.clear()
    } catch (error) {
      actions.notify(error)
    } finally {
      send.disabled = !roomEnabled
      input.focus()
    }
  })
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault()
      composer.requestSubmit()
    }
  })
  conversation.append(messages, composer)
  const inspector = element("aside", "inspector")
  body.append(conversation, inspector)
  const execution = element("div", "execution-notice", snapshot.execution.message)
  root.append(header, toolbar, execution, body)
  container.replaceChildren(root)
  const renderedMessages = new Map<string, { signature: string; node: HTMLElement }>()

  function update(next: RoomDetail, preview = "") {
    roomTitle.textContent = next.room.name
    mode.value = next.room.mode
    group.value = next.effective.settings.preferences.providerGroup
    conversations.value = next.room.currentConversationId
    personaHint.textContent = `人格：${next.effective.persona.name}`
    modeHint.textContent = "使用已配置的 Responses 服务"
    modeHint.className = "mode-hint"
    if (next.room.mode === "demo") {
      modeHint.textContent = "模拟模型 · 不产生 API 费用"
      modeHint.className = "mode-hint demo-hint"
    }
    const atBottom = messages.scrollHeight - messages.scrollTop - messages.clientHeight < 100
    const retained = new Set(
      next.messages.map((message) => {
        return message.id
      })
    )
    for (const [id, cached] of renderedMessages) {
      if (!retained.has(id)) {
        cached.node.remove()
        renderedMessages.delete(id)
      }
    }
    messages.querySelector(".chat-empty")?.remove()
    messages.querySelector(".preview")?.remove()
    if (next.messages.length === 0) {
      const empty = element("div", "chat-empty")
      empty.append(
        element("div", "empty-mark", "π"),
        element("h2", "", "从一条消息开始"),
        element("p", "", "切换成员、调用工具、观察执行过程。\n配置好 Provider 后，这里就是真实模型的测试入口。")
      )
      messages.append(empty)
    }
    for (const [index, message] of next.messages.entries()) {
      const quoted = next.messages.find((candidate) => {
        return (
          candidate.id === message.replyTo?.messageId ||
          (message.replyTo?.platformMessageId !== undefined &&
            candidate.platformMessageIds.includes(message.replyTo.platformMessageId))
        )
      })
      const signature = JSON.stringify({ message, quoteText: quoted?.text, quoteRecalled: quoted?.recalled })
      let cached = renderedMessages.get(message.id)
      if (!cached || cached.signature !== signature) {
        const node = renderMessage(
          message,
          actions,
          () => {
            media.reply(message)
            input.focus()
          },
          quoted
        )
        cached?.node.replaceWith(node)
        cached = { signature, node }
        renderedMessages.set(message.id, cached)
      }
      if (messages.children[index] !== cached.node) {
        messages.insertBefore(cached.node, messages.children[index] ?? null)
      }
    }
    if (preview) {
      const bubble = element("div", "message assistant preview")
      bubble.append(element("div", "message-meta", "Pi · 生成中，尚未交付"), element("div", "bubble", preview))
      messages.append(bubble)
    }
    if (atBottom) {
      messages.scrollTop = messages.scrollHeight
    }
    const running = next.runs.some((run) => {
      return run.status === "running" || run.status === "queued" || run.status === "batching"
    })
    const presenting =
      next.outbound.some((outbound) => {
        return outbound.state === "rendering"
      }) ||
      next.runs.some((run) => {
        return run.presentation?.state === "accepted"
      })
    stop.disabled = !running && !presenting
    renderInspector(inspector, next)
  }
  update(detail)
  return { update }
}

function renderMessage(message: ChatMessage, actions: ChatActions, reply: () => void, quoted?: ChatMessage) {
  const row = element("article", `message ${message.role}`)
  row.dataset.messageId = message.id
  row.id = "message-" + message.id
  const metadata = element("div", "message-meta")
  metadata.append(element("strong", "", message.actorName), element("span", "", time(message.createdAt)))
  if (!message.recalled) {
    metadata.append(button("引用", reply, "text-button"))
  }
  if (message.role !== "user" && !message.recalled) {
    metadata.append(
      button(
        "撤回",
        () => {
          void actions.recall(message).catch(actions.notify)
        },
        "text-button"
      )
    )
  }
  let content = message.text
  if (message.recalled) {
    content = "消息已撤回"
  }
  row.append(metadata)
  if (message.replyTo) {
    let preview = "未观察到引用消息：" + (message.replyTo.platformMessageId ?? message.replyTo.messageId)
    if (quoted) {
      preview = "引用 " + quoted.actorName + "：" + quoted.text.slice(0, 120)
      if (quoted.recalled) {
        preview = "引用消息已撤回"
      }
    }
    row.append(element("blockquote", "message-quote", preview))
  }
  row.append(element("div", "bubble", content))
  if (!message.recalled) {
    for (const attachment of message.attachments) {
      row.append(renderAttachment(message.roomId, attachment))
    }
  }
  if (message.deliveryState === "unknown") {
    row.append(element("small", "form-error", "此消息发送回执不完整，系统未自动重发；已知部分可撤回。"))
  }
  if (message.deliveryState === "partial") {
    row.append(element("small", "muted", "已发送部分内容，后续发送已停止；未自动重发。"))
  }
  if (!message.recalled && message.recalledPlatformIds?.length) {
    row.append(
      element(
        "small",
        "muted",
        `已撤回 ${message.recalledPlatformIds.length}/${message.platformMessageIds.length} 条平台消息`
      )
    )
  }
  if (message.recalled) {
    row.classList.add("recalled")
  }
  return row
}

function renderInspector(container: HTMLElement, detail: RoomDetail) {
  const previousScroll = container.scrollTop
  const openIds = new Set(
    [...container.querySelectorAll<HTMLDetailsElement>("details[open]")].map((node) => {
      return node.dataset.id
    })
  )
  container.replaceChildren(element("div", "inspector-title", "执行记录"))
  const latest = detail.runs[0]
  if (latest) {
    const summary = element("div", "run-summary")
    summary.append(
      element("span", `badge ${latest.status}`, statusLabel(latest.status)),
      element("small", "", `${latest.source} · ${time(latest.createdAt)}`)
    )
    const metrics = element("div", "metrics")
    for (const [label, value] of [
      ["输入", count(latest.usage.input + latest.usage.cacheRead + latest.usage.cacheWrite)],
      ["缓存读取", count(latest.usage.cacheRead)],
      ["输出", count(latest.usage.output)],
      ["模型 / 工具", `${latest.modelCalls} / ${latest.toolCalls}`]
    ]) {
      const metric = element("div")
      metric.append(element("strong", "", value), element("small", "", label))
      metrics.append(metric)
    }
    summary.append(metrics)
    if (latest.input?.parts && latest.input.parts.length > 1) {
      summary.append(element("small", "muted", `${latest.input.parts.length} 条发言合并处理 · 共用当前上下文`))
    }
    if (latest.context) {
      summary.append(
        element(
          "small",
          "muted",
          `人格 ${latest.context.effective.persona.name} · ${latest.context.effective.persona.revision.slice(0, 8)}`
        )
      )
      summary.append(
        element(
          "small",
          "muted",
          `触发来源 ${latest.context.authority.identities
            .map((identity) => {
              return identity.origin + ":" + identity.actorName
            })
            .join(", ")} · ${latest.context.authority.capabilities.length} 项权限`
        )
      )
    }
    if (latest.presentation?.state === "accepted") {
      summary.append(element("small", "muted", "回复呈现已受理，尚未确认发送。可在任务页查看或停止。"))
    }
    if (latest.presentation?.state === "sent") {
      summary.append(element("small", "muted", "回复已确认发送。"))
    }
    if (latest.presentation?.state === "unknown") {
      summary.append(element("small", "form-error", "回复交付结果待核对，尚未确认发送。"))
    }
    const uncertain = detail.outbound.filter((operation) => {
      return operation.runId === latest.id && operation.state === "unknown"
    })
    if (uncertain.length > 0) {
      let message = "部分发送回执未知，系统未自动重发。"
      if (
        uncertain.some((operation) => {
          return operation.uncertaintyStage === "presentation"
        })
      ) {
        message = "呈现处理结果未知，系统未重新生成或发送。"
      }
      summary.append(element("small", "form-error", message))
    }
    if (
      detail.outbound.some((operation) => {
        return operation.runId === latest.id && operation.state === "suppressed"
      })
    ) {
      summary.append(element("small", "muted", "部分输出已按交付策略隐藏，模型原文仍保留。"))
    }
    if (latest.mode === "demo") {
      summary.append(element("small", "demo-usage", "离线模拟用量，不产生 API 费用"))
    }
    container.append(summary)
  } else {
    container.append(element("p", "empty-note", "发起任务后，这里会显示模型尝试、工具执行和发送回执。"))
  }
  const timeline = element("div", "timeline")
  let traces = detail.traces
  if (latest) {
    traces = traces.filter((trace) => {
      return trace.runId === latest.id
    })
  }
  for (const trace of traces) {
    timeline.append(renderTrace(trace, openIds.has(trace.id)))
  }
  container.append(timeline)
  container.scrollTop = previousScroll
}

function renderTrace(trace: Trace, open: boolean) {
  const details = element("details", `trace ${trace.kind}`)
  details.dataset.id = trace.id
  details.open = open
  const summary = element("summary")
  summary.append(element("span", "trace-title", trace.title), element("small", "", time(trace.at)))
  details.append(summary)
  if (trace.durationMs !== undefined) {
    details.append(element("p", "trace-duration", `${(trace.durationMs / 1000).toFixed(2)} 秒`))
  }
  if (trace.detail) {
    details.append(element("pre", "", trace.detail))
  }
  return details
}

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    batching: "合并发言中",
    queued: "排队中",
    running: "运行中",
    completed: "已完成",
    failed: "失败",
    cancelled: "已取消",
    interrupted: "已中断"
  }
  return labels[status] ?? status
}
