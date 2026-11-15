import type { ResourceLibrary } from "@pi-im-bot/resources/library"
import type { PluginInstance, PluginPackage } from "./config"
import type { PluginGrantSchema } from "./manifest"
import type { z } from "zod"
import { configIssues } from "./configuration/values"
import { gsviWorkerDefinition } from "@pi-im-bot/integrations/gsvi/plugin-config/definition"

export function requestedGrants(bundle: PluginPackage): z.infer<typeof PluginGrantSchema>[] {
  return [
    ...new Set(
      [...bundle.manifest.operations, ...bundle.manifest.hooks].flatMap((entry) => {
        return entry.grants
      })
    )
  ]
}
export function pluginConnections(bundle: PluginPackage) {
  const connections = [...bundle.manifest.connections]
  for (const grant of requestedGrants(bundle)) {
    let kind: "mcp" | "plugin" | "service" = "mcp"
    let alias = ""
    if (grant.startsWith("connector:")) {
      alias = grant.slice(10)
    }
    if (grant.startsWith("service:")) {
      alias = grant.slice(8)
      kind = "service"
    }
    if (grant.startsWith("operation:")) {
      alias = grant.slice(10).split("/")[0]
      kind = "plugin"
    }
    if (
      kind !== "service" &&
      alias &&
      !connections.some((connection) => {
        return connection.alias === alias && connection.kind === kind
      })
    ) {
      connections.push({ alias, kind, title: alias, description: "", required: false })
    }
  }
  return connections
}
export function resolvePluginConnections(instance: PluginInstance, bundle: PluginPackage) {
  for (const connection of pluginConnections(bundle)) {
    if (!connection.setting) {
      continue
    }
    const value = instance.settings[connection.setting]
    if (typeof value !== "string") {
      throw new Error("服务绑定配置必须是字符串：" + connection.setting)
    }
    let mapping = instance.connectors
    if (connection.kind === "plugin") {
      mapping = instance.dependencies
    }
    if (connection.kind === "service") {
      mapping = instance.services
    }
    if (value) {
      mapping[connection.alias] = value
    } else {
      delete mapping[connection.alias]
    }
  }
}
export function pluginIssues(instance: PluginInstance, bundle: PluginPackage, library: ResourceLibrary) {
  const issues = []
  if (bundle.configuration) {
    issues.push(...configIssues(gsviWorkerDefinition(bundle) ?? {}, instance.settings))
  }
  for (const connection of pluginConnections(bundle)) {
    if (!connection.required) {
      continue
    }
    let mapping = instance.connectors
    if (connection.kind === "plugin") {
      mapping = instance.dependencies
    }
    if (connection.kind === "service") {
      mapping = instance.services
    }
    const target = mapping[connection.alias]
    let available = false
    if (connection.kind === "mcp") {
      available = library.config.mcp.some((entry) => {
        return entry.id === target && entry.enabled
      })
    } else if (connection.kind === "service") {
      available =
        ["gsvi@1", "comfy@1"].includes(connection.service ?? "") &&
        [...library.config.services, ...library.config.comfyServices].some((entry) => {
          return entry.id === target && entry.enabled
        })
    } else {
      available = library.config.plugins.some((entry) => {
        return entry.id === target && entry.enabled && entry.id !== instance.id
      })
    }
    if (!available) {
      issues.push({ path: connection.alias, message: "请绑定已启用的" + connection.title })
    }
  }
  return issues
}
