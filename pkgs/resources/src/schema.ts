import { ComfyServiceSchema, WorkflowSchema } from "@pi-im-bot/integrations/comfy/resources"
import { z } from "zod"
import { GsviServiceSchema } from "@pi-im-bot/integrations/gsvi/schema"
import { McpServerSchema } from "./mcp/schema"
import { SkillConfigSchema } from "./skills/schema"
import { PluginInstanceSchema } from "@pi-im-bot/plugins/config"
import { PluginCatalogSourceSchema } from "@pi-im-bot/plugins/market/contracts"

export const ResourcesConfigSchema = z
  .object({
    version: z.literal(1).default(1),
    comfyServices: z.array(ComfyServiceSchema).max(32).default([]),
    workflows: z.array(WorkflowSchema).max(64).default([]),
    services: z.array(GsviServiceSchema).max(64).default([]),
    mcp: z.array(McpServerSchema).max(100).default([]),
    skills: z.array(SkillConfigSchema).max(100).default([]),
    plugins: z.array(PluginInstanceSchema).max(64).default([]),
    pluginCatalogs: z.array(PluginCatalogSourceSchema).max(8).default([])
  })
  .strict()
  .superRefine((value, ctx) => {
    for (const service of value.comfyServices) {
      if (
        new Set(service.workflows).size !== service.workflows.length ||
        service.workflows.some((id) => {
          return !value.workflows.some((workflow) => {
            return workflow.id === id
          })
        })
      ) {
        ctx.addIssue({ code: "custom", message: "Comfy服务引用了不存在或重复的模板" })
      }
    }
    if (
      new Set(
        [...value.services, ...value.comfyServices].map((entry) => {
          return entry.id
        })
      ).size !==
        value.services.length + value.comfyServices.length ||
      new Set(
        value.workflows.map((entry) => {
          return entry.id
        })
      ).size !== value.workflows.length
    ) {
      ctx.addIssue({ code: "custom", message: "服务/工作流ID重复" })
    }
    if (
      new Set(
        value.services.map((entry) => {
          return entry.id
        })
      ).size !== value.services.length
    ) {
      ctx.addIssue({ code: "custom", message: "具名服务 ID 不可重复" })
    }
    if (
      new Set(
        value.pluginCatalogs.map((source) => {
          return source.id
        })
      ).size !== value.pluginCatalogs.length
    ) {
      ctx.addIssue({ code: "custom", message: "插件目录源 ID 不可重复" })
    }
    if (
      new Set(
        value.plugins.map((plugin) => {
          return plugin.id
        })
      ).size !== value.plugins.length
    ) {
      ctx.addIssue({ code: "custom", message: "插件实例 ID 不可重复" })
    }
    if (
      new Set(
        value.mcp.map((server) => {
          return server.id
        })
      ).size !== value.mcp.length
    ) {
      ctx.addIssue({ code: "custom", message: "MCP 服务 ID 不可重复" })
    }
    if (
      new Set(
        value.skills.map((skill) => {
          return skill.id
        })
      ).size !== value.skills.length
    ) {
      ctx.addIssue({ code: "custom", message: "Skill ID 不可重复" })
    }
  })
export type ResourcesConfig = z.infer<typeof ResourcesConfigSchema>
