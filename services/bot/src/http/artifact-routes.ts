import type { Hono } from "hono"
import type { Coordinator } from "@pi-im-bot/runtime/coordinator"
import type { Configuration } from "@pi-im-bot/config/load"
import { ArtifactStore } from "@pi-im-bot/artifacts/store"
import { mediaKind } from "@pi-im-bot/contracts/channel-media"

export function registerArtifactRoutes(app: Hono, coordinator: Coordinator, configuration: () => Configuration) {
  app.get("/api/rooms/:id/artifacts/:artifactId", async (c) => {
    const room = coordinator.requireRoom(c.req.param("id"))
    const metadata = await new ArtifactStore(configuration().dataDir, room.id).metadata(c.req.param("artifactId"))
    if (metadata.access) {
      coordinator.delivery.validateReadAccess?.(room.id, metadata.access)
    }
    return c.json(metadata)
  })
  app.get("/api/rooms/:id/artifacts/:artifactId/content", async (c) => {
    const room = coordinator.requireRoom(c.req.param("id"))
    const { metadata, file } = await new ArtifactStore(configuration().dataDir, room.id).content(
      c.req.param("artifactId")
    )
    if (metadata.access) {
      coordinator.delivery.validateReadAccess?.(room.id, metadata.access)
    }
    let mimeType = "application/octet-stream"
    if (/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(metadata.mimeType)) {
      mimeType = metadata.mimeType
    }
    let disposition = "attachment"
    if (c.req.query("view") === "1" && mediaKind(mimeType) !== "file") {
      disposition = "inline"
    }
    return new Response(file, {
      headers: {
        "content-type": mimeType,
        "content-disposition": disposition + "; filename*=UTF-8''" + encodeURIComponent(metadata.name),
        "content-security-policy": "sandbox; default-src 'none'",
        "x-content-type-options": "nosniff"
      }
    })
  })
}
