import type { Hono } from "hono"
import { sValidator } from "@hono/standard-validator"
import { ProviderEditor } from "@pi-im-bot/providers/editor"
import {
  SaveProviderSchema,
  RevisionSchema,
  SaveGroupSchema,
  DefaultCandidateSchema,
  ProviderProbeInputSchema
} from "@pi-im-bot/providers/editor-contracts"
import { listProviderModels, probeProviderModel } from "@pi-im-bot/providers/probe"

export function registerProviderRoutes(app: Hono, editor: ProviderEditor, changed: () => void) {
  app.get("/api/providers/config", async (c) => {
    return c.json(await editor.read())
  })
  app.post("/api/providers", sValidator("json", SaveProviderSchema), async (c) => {
    const input = c.req.valid("json")
    const result = await editor.saveProvider(input.revision, input.provider)
    changed()
    return c.json(result, 201)
  })
  app.put("/api/providers/:id", sValidator("json", SaveProviderSchema), async (c) => {
    const input = c.req.valid("json")
    const result = await editor.saveProvider(input.revision, input.provider, c.req.param("id"))
    changed()
    return c.json(result)
  })
  app.delete("/api/providers/:id", sValidator("json", RevisionSchema), async (c) => {
    const result = await editor.deleteProvider(c.req.valid("json").revision, c.req.param("id"))
    changed()
    return c.json(result)
  })
  app.post("/api/providers/models/list", sValidator("json", ProviderProbeInputSchema), async (c) => {
    const input = c.req.valid("json")
    const provider = await editor.resolveDraft(input.revision, input.provider, input.providerId)
    return c.json(await listProviderModels(provider, c.req.raw.signal))
  })
  app.post("/api/providers/models/test", sValidator("json", ProviderProbeInputSchema), async (c) => {
    const input = c.req.valid("json")
    const provider = await editor.resolveDraft(input.revision, input.provider, input.providerId)
    if (!input.modelId) {
      return c.json({ error: "请选择要测试的模型。" }, 400)
    }
    return c.json(await probeProviderModel(provider, input.modelId, c.req.raw.signal))
  })
  app.post("/api/provider-groups", sValidator("json", SaveGroupSchema), async (c) => {
    const input = c.req.valid("json")
    const result = await editor.saveGroup(input.revision, input.group)
    changed()
    return c.json(result, 201)
  })
  app.put("/api/provider-groups/:id", sValidator("json", SaveGroupSchema), async (c) => {
    const input = c.req.valid("json")
    const result = await editor.saveGroup(input.revision, input.group, c.req.param("id"))
    changed()
    return c.json(result)
  })
  app.delete("/api/provider-groups/:id", sValidator("json", RevisionSchema), async (c) => {
    const result = await editor.deleteGroup(c.req.valid("json").revision, c.req.param("id"))
    changed()
    return c.json(result)
  })
  app.post("/api/provider-groups/:id/default", sValidator("json", RevisionSchema), async (c) => {
    const result = await editor.setDefaultGroup(c.req.valid("json").revision, c.req.param("id"))
    changed()
    return c.json(result)
  })
  app.post("/api/provider-groups/default-candidate", sValidator("json", DefaultCandidateSchema), async (c) => {
    const input = c.req.valid("json")
    const result = await editor.setDefaultCandidate(input.revision, input.candidate)
    changed()
    return c.json(result)
  })
}
