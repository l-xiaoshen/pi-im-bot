import type { Hono } from "hono"
import { sValidator } from "@hono/standard-validator"
import { z } from "zod"
import { JobSpecSchema } from "@pi-im-bot/jobs/schema"
import type { JobService } from "@pi-im-bot/jobs/service"
import type { Coordinator } from "@pi-im-bot/runtime/coordinator"
import { localIdentity } from "@pi-im-bot/permissions/identity"
import { JobDeliveryViewSchema } from "@pi-im-bot/jobs/delivery-view"

export function registerJobRoutes(app: Hono, jobs: JobService, coordinator: Coordinator) {
  app.get("/api/rooms/:id/jobs/:jobId/delivery", async (c) => {
    const job = await jobs.repository.get(c.req.param("jobId"), c.req.param("id"))
    const outbound = coordinator.store.getOutbound("job:" + job.id + ":" + job.currentRevision + ":result")
    return c.json(JobDeliveryViewSchema.parse({ delivery: outbound ?? null }))
  })
  app.get("/api/rooms/:id/jobs", async (c) => {
    coordinator.requireRoom(c.req.param("id"))
    return c.json(await jobs.repository.list(c.req.param("id")))
  })
  app.get(
    "/api/rooms/:id/jobs/history",
    sValidator(
      "query",
      z.object({
        beforePage: z.coerce.number().int().nonnegative().optional()
      })
    ),
    async (c) => {
      coordinator.requireRoom(c.req.param("id"))
      return c.json(await jobs.repository.history(c.req.param("id"), c.req.valid("query").beforePage))
    }
  )
  app.get("/api/rooms/:id/jobs/:jobId", async (c) => {
    return c.json(await jobs.repository.get(c.req.param("jobId"), c.req.param("id")))
  })
  app.post(
    "/api/rooms/:id/jobs",
    sValidator("json", z.object({ title: z.string().min(1).max(100), spec: JobSpecSchema })),
    async (c) => {
      const value = c.req.valid("json")
      const invocation = coordinator.jobInvocation(
        c.req.param("id"),
        localIdentity("web", "operator", "operator", "本地操作员"),
        value.title
      )
      return c.json(await jobs.start(invocation, value.title, value.spec, "web"), 202)
    }
  )
  app.post("/api/rooms/:id/jobs/:jobId/cancel", async (c) => {
    return c.json(await jobs.cancel(c.req.param("jobId"), c.req.param("id")), 202)
  })
  app.post(
    "/api/rooms/:id/jobs/:jobId/reconcile",
    sValidator("json", z.object({ cancel: z.boolean().default(false) })),
    async (c) => {
      return c.json(await jobs.reconcile(c.req.param("jobId"), c.req.param("id"), c.req.valid("json").cancel))
    }
  )
  app.post(
    "/api/rooms/:id/jobs/:jobId/update",
    sValidator("json", z.object({ revision: z.number().int().positive(), instruction: z.string().min(1).max(20000) })),
    async (c) => {
      const value = c.req.valid("json")
      const invocation = coordinator.jobInvocation(
        c.req.param("id"),
        localIdentity("web", "operator", "operator", "本地操作员"),
        value.instruction
      )
      return c.json(await jobs.update(invocation, c.req.param("jobId"), value.revision, value.instruction, "web"), 202)
    }
  )
}
