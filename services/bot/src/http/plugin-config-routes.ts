import type { Hono } from "hono"
import { sValidator } from "@hono/standard-validator"
import type { PluginConfigurationEditor } from "@pi-im-bot/plugins/configuration/editor"
import { PluginConfigTargetSchema, SavePluginConfigSchema } from "@pi-im-bot/plugins/configuration/contracts"
import { PluginOrderEditor } from "@pi-im-bot/plugins/configuration/order"
import { SavePluginOrderSchema } from "@pi-im-bot/plugins/configuration/order-contracts"
import { PluginPipelineEditor } from "@pi-im-bot/plugins/pipeline/editor"
import { SavePipelineSchema } from "@pi-im-bot/plugins/pipeline/contracts"

export function registerPluginConfigRoutes(app: Hono, editor: PluginConfigurationEditor, changed: () => void) {
  const order = new PluginOrderEditor(editor)
  const pipeline = new PluginPipelineEditor(editor)
  app.get("/api/plugins/pipeline", async (c) => {
    return c.json(await pipeline.read())
  })
  app.put("/api/plugins/pipeline", sValidator("json", SavePipelineSchema), async (c) => {
    const result = await pipeline.save(c.req.valid("json"))
    changed()
    return c.json(result)
  })
  app.get("/api/plugins/:id/order", async (c) => {
    let target: unknown = c.req.query()
    if (!Object.keys(c.req.query()).length) {
      target = { level: "instance" }
    }
    return c.json(await order.read(c.req.param("id"), PluginConfigTargetSchema.parse(target)))
  })
  app.put("/api/plugins/:id/order", sValidator("json", SavePluginOrderSchema), async (c) => {
    const result = await order.save(c.req.param("id"), c.req.valid("json"))
    changed()
    return c.json(result)
  })
  app.get("/api/plugins/:id/configuration", async (c) => {
    let query: unknown = c.req.query()
    if (Object.keys(c.req.query()).length === 0) {
      query = { level: "instance" }
    }
    return c.json(await editor.read(c.req.param("id"), PluginConfigTargetSchema.parse(query)))
  })
  app.put("/api/plugins/:id/configuration", sValidator("json", SavePluginConfigSchema), async (c) => {
    const value = await editor.save(c.req.param("id"), c.req.valid("json"))
    changed()
    return c.json(value)
  })
}
