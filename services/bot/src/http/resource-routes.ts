import { SaveComfySchema, SaveWorkflowSchema } from "@pi-im-bot/integrations/comfy/configuration"
import { SaveGsviSchema } from "@pi-im-bot/integrations/gsvi/configuration"
import type { Hono } from "hono"
import { sValidator } from "@hono/standard-validator"
import { SaveMcpServerSchema, ResourceRevisionSchema, SaveSkillSchema } from "@pi-im-bot/resources/contracts"
import type { ResourceEditor } from "@pi-im-bot/resources/editor"

export function registerResourceRoutes(app: Hono, editor: ResourceEditor, changed: () => void) {
  app.get("/api/resources", async (c) => {
    return c.json(await editor.read())
  })
  app.post("/api/resources/comfy", sValidator("json", SaveComfySchema), async (c) => {
    const input = c.req.valid("json")
    const result = await editor.saveComfy(input.revision, input.service)
    changed()
    return c.json(result, 201)
  })
  app.put("/api/resources/comfy/:id", sValidator("json", SaveComfySchema), async (c) => {
    const input = c.req.valid("json")
    const result = await editor.saveComfy(input.revision, input.service, c.req.param("id"))
    changed()
    return c.json(result)
  })
  app.delete("/api/resources/comfy/:id", sValidator("json", ResourceRevisionSchema), async (c) => {
    const result = await editor.removeComfy(c.req.valid("json").revision, c.req.param("id"))
    changed()
    return c.json(result)
  })
  app.get("/api/resources/workflows/:id", async (c) => {
    return c.json(await editor.workflow(c.req.param("id")))
  })
  app.post("/api/resources/workflows", sValidator("json", SaveWorkflowSchema), async (c) => {
    const input = c.req.valid("json")
    const result = await editor.saveWorkflow(input.revision, input.workflow)
    changed()
    return c.json(result, 201)
  })
  app.delete("/api/resources/workflows/:id", sValidator("json", ResourceRevisionSchema), async (c) => {
    const result = await editor.removeWorkflow(c.req.valid("json").revision, c.req.param("id"))
    changed()
    return c.json(result)
  })
  app.post("/api/resources/services", sValidator("json", SaveGsviSchema), async (c) => {
    const input = c.req.valid("json")
    const value = await editor.saveService(input.revision, input.service)
    changed()
    return c.json(value, 201)
  })
  app.put("/api/resources/services/:id", sValidator("json", SaveGsviSchema), async (c) => {
    const input = c.req.valid("json")
    const value = await editor.saveService(input.revision, input.service, c.req.param("id"))
    changed()
    return c.json(value)
  })
  app.delete("/api/resources/services/:id", sValidator("json", ResourceRevisionSchema), async (c) => {
    const value = await editor.removeService(c.req.valid("json").revision, c.req.param("id"))
    changed()
    return c.json(value)
  })
  app.post("/api/resources/mcp", sValidator("json", SaveMcpServerSchema), async (c) => {
    const input = c.req.valid("json")
    const value = await editor.save(input.revision, input.server)
    changed()
    return c.json(value, 201)
  })
  app.put("/api/resources/mcp/:id", sValidator("json", SaveMcpServerSchema), async (c) => {
    const input = c.req.valid("json")
    const value = await editor.save(input.revision, input.server, c.req.param("id"))
    changed()
    return c.json(value)
  })
  app.delete("/api/resources/mcp/:id", sValidator("json", ResourceRevisionSchema), async (c) => {
    const value = await editor.remove(c.req.valid("json").revision, c.req.param("id"))
    changed()
    return c.json(value)
  })
  app.post("/api/resources/mcp/:id/refresh", sValidator("json", ResourceRevisionSchema), async (c) => {
    const value = await editor.refresh(c.req.valid("json").revision, c.req.param("id"), c.req.raw.signal)
    changed()
    return c.json(value)
  })
  app.post("/api/resources/skills", sValidator("json", SaveSkillSchema), async (c) => {
    const input = c.req.valid("json")
    const value = await editor.saveSkill(input.revision, input.skill)
    changed()
    return c.json(value, 201)
  })
  app.put("/api/resources/skills/:id", sValidator("json", SaveSkillSchema), async (c) => {
    const input = c.req.valid("json")
    const value = await editor.saveSkill(input.revision, input.skill, c.req.param("id"))
    changed()
    return c.json(value)
  })
  app.delete("/api/resources/skills/:id", sValidator("json", ResourceRevisionSchema), async (c) => {
    const value = await editor.removeSkill(c.req.valid("json").revision, c.req.param("id"))
    changed()
    return c.json(value)
  })
  app.post("/api/resources/skills/:id/import", sValidator("json", ResourceRevisionSchema), async (c) => {
    const value = await editor.importSkill(c.req.valid("json").revision, c.req.param("id"))
    changed()
    return c.json(value)
  })
}
