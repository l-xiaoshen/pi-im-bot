import type { FrameworkEditor } from "@pi-im-bot/settings/editor"
import { SettingsSchema, type SettingsPatch } from "@pi-im-bot/settings/schema"
import type { Coordinator } from "@pi-im-bot/runtime/coordinator"
import type { PluginConfigTarget } from "./contracts"

export async function writePluginScope(
  target: PluginConfigTarget,
  patch: SettingsPatch,
  baseline: Awaited<ReturnType<FrameworkEditor["read"]>>,
  framework: FrameworkEditor,
  coordinator: Coordinator,
  before: () => Promise<unknown>
) {
  if (target.level === "instance" || target.level === "account") {
    const value = structuredClone(baseline.config)
    if (target.level === "instance") {
      value.defaults = SettingsSchema.parse(patch)
    } else {
      let account = value.accounts.find((entry) => {
        return entry.channel === target.channel && entry.accountId === target.accountId
      })
      if (!account) {
        account = { channel: target.channel, accountId: target.accountId, settings: {} }
        value.accounts.push(account)
      }
      account.settings = patch
    }
    await framework.save(baseline.version, value, async () => {
      await before()
    })
  } else {
    await framework.exclusive(async () => {
      await before()
      if (target.level === "room") {
        const room = coordinator.requireRoom(target.roomId)
        const next = { ...room, settings: patch, revision: room.revision + 1, updatedAt: Date.now() }
        framework.validate(baseline.config, next)
        coordinator.store.saveRoom(next)
      } else {
        const conversation = coordinator.conversations.require(target.conversationId, target.roomId)
        const next = {
          ...conversation,
          settings: patch,
          revision: conversation.revision + 1,
          updatedAt: Date.now()
        }
        framework.validate(baseline.config, undefined, next)
        coordinator.store.saveConversation(next)
      }
    })
  }
}
