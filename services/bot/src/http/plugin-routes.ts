import type { Hono } from 'hono'
import { sValidator } from '@hono/standard-validator'
import { SavePluginSchema, ManagePluginSchema } from '@pi-im-bot/plugins/contracts'
import { ResourceRevisionSchema } from '@pi-im-bot/resources/contracts'
import type { PluginEditor } from '@pi-im-bot/plugins/editor'
import { z } from 'zod'
import type { ObserverStatusSchema } from '@pi-im-bot/plugins/observations/schema'

export function registerPluginRoutes(
  app: Hono,
  editor: PluginEditor,
  changed: () => void,
  observers?: {
    status(): Promise<z.infer<typeof ObserverStatusSchema>>
    cancel(id: number): Promise<unknown>
  }
) {
  app.get('/api/plugins/observers', async (c) => {
    if (!observers) {
      return c.json({ enabled: false, outbox: 0, dropped: 0, active: [], recent: [] })
    }
    return c.json(await observers.status())
  })
  app.post('/api/plugins/observers/:id/cancel', async (c) => {
    if (!observers) {
      throw new Error('观察运行时未配置')
    }
    return c.json(await observers.cancel(z.coerce.number().int().positive().parse(c.req.param('id'))))
  })
  app.get('/api/plugins', async (c) => {
    return c.json(await editor.read())
  })
  app.post('/api/plugins', sValidator('json', SavePluginSchema), async (c) => {
    const input = c.req.valid('json')
    const result = await editor.save(input.revision, input.plugin)
    changed()
    return c.json(result, 201)
  })
  app.put('/api/plugins/:id', sValidator('json', SavePluginSchema), async (c) => {
    const input = c.req.valid('json')
    const result = await editor.save(input.revision, input.plugin, c.req.param('id'))
    changed()
    return c.json(result)
  })
  app.patch('/api/plugins/:id', sValidator('json', ManagePluginSchema), async (c) => {
    const input = c.req.valid('json')
    const result = await editor.manage(input.revision, c.req.param('id'), input.patch)
    changed()
    return c.json(result)
  })
  app.delete('/api/plugins/:id', sValidator('json', ResourceRevisionSchema), async (c) => {
    const result = await editor.remove(c.req.valid('json').revision, c.req.param('id'))
    changed()
    return c.json(result)
  })
  app.post('/api/plugins/:id/import', sValidator('json', ResourceRevisionSchema), async (c) => {
    const result = await editor.import(c.req.valid('json').revision, c.req.param('id'))
    changed()
    return c.json(result)
  })
}
