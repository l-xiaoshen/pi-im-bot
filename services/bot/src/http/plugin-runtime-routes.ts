import type { Hono } from 'hono'
import { sValidator } from '@hono/standard-validator'
import type { PluginRuntimeEditor } from '@pi-im-bot/plugins/runtime/editor'
import {
  PluginEnvironmentInputSchema,
  SavePluginEnvironmentSchema
} from '@pi-im-bot/plugins/runtime/contracts'

export function registerPluginRuntimeRoutes(app: Hono, editor: PluginRuntimeEditor, changed: () => void) {
  app.get('/api/plugins/runtime', async (c) => {
    return c.json(await editor.read())
  })
  app.post('/api/plugins/runtime/probe', sValidator('json', PluginEnvironmentInputSchema), async (c) => {
    return c.json(await editor.read(c.req.valid('json')))
  })
  app.put('/api/plugins/runtime', sValidator('json', SavePluginEnvironmentSchema), async (c) => {
    const result = await editor.save(c.req.valid('json'))
    changed()
    return c.json(result)
  })
}
