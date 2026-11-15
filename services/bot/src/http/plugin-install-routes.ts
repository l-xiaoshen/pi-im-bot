import type { Hono } from "hono"
import { sValidator } from "@hono/standard-validator"
import { z } from "zod"
import { join } from "node:path"
import { InstallRequestSchema } from "@pi-im-bot/plugins/install/contracts"
import type { PluginInstaller } from "@pi-im-bot/plugins/install/service"
import { maxArchiveBytes } from "@pi-im-bot/plugins/install/archive"
import type { PluginMarket } from "@pi-im-bot/plugins/market/service"
import { PluginCatalogSourceSchema } from "@pi-im-bot/plugins/market/contracts"
import { pluginPaths } from "@pi-im-bot/plugins/runtime/config"
import { pluginPackageRoot, verifyPlugin } from "@pi-im-bot/plugins/package"

export function registerPluginInstallRoutes(
  app: Hono,
  installer: PluginInstaller,
  market: PluginMarket,
  changed: () => void
) {
  app.get("/api/plugins/market", async (c) => {
    return c.json(await market.read())
  })
  app.post("/api/plugins/market/refresh", async (c) => {
    return c.json(await market.refresh())
  })
  app.put(
    "/api/plugins/market/sources",
    sValidator("json", z.object({ revision: z.string(), sources: z.array(PluginCatalogSourceSchema).max(8) }).strict()),
    async (c) => {
      const input = c.req.valid("json")
      const result = await market.sources(input.revision, input.sources)
      changed()
      return c.json(result)
    }
  )
  app.post(
    "/api/plugins/market/install",
    sValidator("json", z.object({ revision: z.string(), key: z.string().max(200) }).strict()),
    async (c) => {
      const input = c.req.valid("json")
      return c.json(await market.install(input.key, input.revision), 202)
    }
  )
  app.get("/api/plugins/installations", async (c) => {
    return c.json(await installer.list())
  })
  app.post("/api/plugins/:id/update", sValidator("json", z.object({ revision: z.string() }).strict()), async (c) => {
    return c.json(await market.forceUpdate(c.req.param("id"), c.req.valid("json").revision), 202)
  })
  app.post("/api/plugins/installations/:id/cancel", async (c) => {
    return c.json(await installer.cancel(z.uuid().parse(c.req.param("id"))))
  })
  app.post("/api/plugins/install", sValidator("json", InstallRequestSchema), async (c) => {
    return c.json(await installer.start(c.req.valid("json")), 202)
  })
  app.post(
    "/api/plugins/install/upload",
    sValidator(
      "form",
      z.object({
        revision: z.string(),
        targetId: z.string().optional(),
        archive: z.instanceof(File).refine((file) => {
          return file.size <= maxArchiveBytes
        }, "ZIP 超过 32 MiB")
      })
    ),
    async (c) => {
      const input = c.req.valid("form")
      return c.json(
        await installer.start(
          { revision: input.revision, targetId: input.targetId },
          new Uint8Array(await input.archive.arrayBuffer())
        ),
        202
      )
    }
  )
  app.get("/api/plugins/:id/archive", async (c) => {
    const result = await installer.archive(c.req.param("id"))
    c.header("Content-Type", "application/zip")
    c.header("Content-Disposition", 'attachment; filename="' + result.name + '"')
    return c.body(result.content)
  })
  app.get("/api/plugins/:id/documents/:name", async (c) => {
    const config = installer.editor.configuration()
    const bundle = config.resources.pluginPackage(c.req.param("id"))
    if (!bundle) {
      throw new Error("插件未安装")
    }
    const name = z.enum(["README.md", "CHANGELOG.md"]).parse(c.req.param("name"))
    const entry = bundle.files.find((file) => {
      return file.path === name
    })
    if (!entry) {
      return c.json({ text: "", name })
    }
    if (entry.bytes > 256 * 1024) {
      throw new Error("文档超过显示预算")
    }
    const root = pluginPaths(config.projectDir, config.bot.plugins).packageDir
    await verifyPlugin(root, bundle)
    return c.json({ text: await Bun.file(join(pluginPackageRoot(root, bundle), name)).text(), name })
  })
  app.get("/api/plugins/:id/releases", (c) => {
    return c.json(
      installer.editor
        .configuration()
        .resources.pluginPackages.filter((bundle) => {
          return bundle.instanceId === c.req.param("id")
        })
        .map((bundle) => {
          return { release: bundle.revision, version: bundle.manifest.version, importedAt: bundle.importedAt }
        })
        .reverse()
    )
  })
  app.post(
    "/api/plugins/:id/releases/select",
    sValidator("json", z.object({ revision: z.string(), release: z.string().regex(/^[a-f0-9]{64}$/u) }).strict()),
    async (c) => {
      const config = installer.editor.configuration()
      const input = c.req.valid("json")
      const bundle = config.resources.pluginPackages.find((bundle) => {
        return bundle.instanceId === c.req.param("id") && bundle.revision === input.release
      })
      if (!bundle) {
        throw new Error("未保存此版本")
      }
      const root = pluginPaths(config.projectDir, config.bot.plugins).packageDir
      await verifyPlugin(root, bundle)
      const result = await installer.editor.publish(
        input.revision,
        c.req.param("id"),
        bundle,
        pluginPackageRoot(root, bundle)
      )
      changed()
      return c.json(result)
    }
  )
}
