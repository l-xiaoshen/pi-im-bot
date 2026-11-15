import type { Hono } from 'hono'
import { sValidator } from '@hono/standard-validator'
import { z } from 'zod'
import type { OneBotAdapter } from '@pi-im-bot/channels/onebot/adapter'
import { QQIdSchema } from '@pi-im-bot/channels/onebot/config'
import { OneBotSettingsInputSchema } from '@pi-im-bot/channels/onebot/status'
import type { OneBotSettings } from '@pi-im-bot/channels/onebot/settings'

export function registerOneBotRoutes(app: Hono, settings: OneBotSettings, adapter: OneBotAdapter) {
  app.get('/api/onebot/settings', async (c) => {
    return c.json(await settings.read())
  })
  app.put('/api/onebot/settings', sValidator('json', OneBotSettingsInputSchema), async (c) => {
    return c.json(await settings.save(c.req.valid('json')))
  })
  app.post('/api/onebot/groups/refresh', sValidator('json', z.object({ selfId: QQIdSchema })), async (c) => {
    return c.json(await adapter.refreshGroups(c.req.valid('json').selfId))
  })
}
