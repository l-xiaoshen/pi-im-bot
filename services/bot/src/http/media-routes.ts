import type { Hono } from 'hono'
import { sValidator } from '@hono/standard-validator'
import { z } from 'zod'
import type { Coordinator } from '@pi-im-bot/runtime/coordinator'
import type { MediaService } from '@pi-im-bot/media/service'
import { mediaKind } from '@pi-im-bot/contracts/channel-media'

export function registerMediaRoutes(app: Hono, coordinator: Coordinator, media: MediaService) {
  app.post('/api/rooms/:id/media', sValidator('form', z.object({ file: z.instanceof(File) })), async (c) => {
    return c.json(
      await media.upload(coordinator.requireRoom(c.req.param('id')), c.req.valid('form').file),
      201
    )
  })
  app.get('/api/rooms/:id/media/:mediaId', (c) => {
    const record = media.require(c.req.param('id'), c.req.param('mediaId'))
    return c.json({ ...media.attachment(record), ready: Boolean(record.artifactId), error: record.error })
  })
  app.post('/api/rooms/:id/media/:mediaId/retry', (c) => {
    coordinator.requireRoom(c.req.param('id'))
    media.retry(c.req.param('id'), c.req.param('mediaId'))
    return c.json({ ok: true })
  })
  app.get('/api/rooms/:id/media/:mediaId/content', async (c) => {
    const room = coordinator.requireRoom(c.req.param('id'))
    const { metadata, file } = await media.resolve(room, c.req.param('mediaId'), c.req.raw.signal)
    let mimeType = 'application/octet-stream'
    if (/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(metadata.mimeType)) {
      mimeType = metadata.mimeType
    }
    let disposition = 'attachment'
    if (c.req.query('view') === '1' && mediaKind(mimeType) !== 'file') {
      disposition = 'inline'
    }
    return new Response(file, {
      headers: {
        'content-type': mimeType,
        'content-disposition': disposition + "; filename*=UTF-8''" + encodeURIComponent(metadata.name),
        'content-security-policy': "sandbox; default-src 'none'",
        'x-content-type-options': 'nosniff'
      }
    })
  })
}
