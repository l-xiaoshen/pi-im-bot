import type { Configuration } from "@pi-im-bot/config/load"
import type { StateStore } from "@pi-im-bot/storage/state"
import type { SettingsPatch } from "@pi-im-bot/settings/schema"

export function resourceReferences(
  config: Configuration,
  store: Pick<StateStore, keyof StateStore>,
  kind: "mcp" | "skill" | "plugin",
  id: string
) {
  const matches: string[] = []
  function record(patch: SettingsPatch, label: string) {
    let selection = patch.resources?.mcp
    if (kind === "skill") {
      selection = patch.resources?.skills
    }
    if (kind === "plugin") {
      selection = patch.resources?.plugins
    }
    if (selection?.mode === "selected" && selection.ids.includes(id)) {
      matches.push(label)
      return
    }
    const capabilities = [...(patch.resources?.permanentTools ?? [])]
    if (patch.resources?.tools?.mode === "selected") {
      capabilities.push(...patch.resources.tools.ids)
    }
    for (const rule of patch.permissions?.rules ?? []) {
      capabilities.push(...rule.capabilities)
    }
    if (
      capabilities.some((capability) => {
        if (kind === "skill") {
          return capability === "skill:" + id
        }
        if (kind === "plugin") {
          return (
            capability.startsWith(`plugin:${id}/`) ||
            capability.startsWith(`command:plugin:${id}/`) ||
            capability.startsWith(`hook:plugin:${id}/`)
          )
        }
        return capability.startsWith(`mcp:${id}/`)
      })
    ) {
      matches.push(label)
    }
    if (
      kind === "plugin" &&
      (Object.hasOwn(patch.extensions?.settings ?? {}, id) ||
        Object.keys({ ...patch.extensions?.disabled, ...patch.extensions?.priorities }).some((key) => {
          return key.startsWith(id + "/")
        }))
    ) {
      matches.push(label)
    }
  }
  record(config.framework.defaults, "默认设置")
  for (const account of config.framework.accounts) {
    record(account.settings, account.channel + "/" + account.accountId)
  }
  for (const room of store.listRooms()) {
    record(room.settings, room.name)
  }
  for (const conversation of store.listConversations()) {
    record(conversation.settings, conversation.title)
  }
  if (kind === "mcp") {
    for (const plugin of config.resources.config.plugins) {
      if (Object.values(plugin.connectors).includes(id)) {
        matches.push("插件 " + plugin.id + " 的连接器")
      }
    }
  }
  return matches
}
