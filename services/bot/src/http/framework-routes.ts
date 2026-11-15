import type { Hono } from 'hono'
import { sValidator } from '@hono/standard-validator'
import { z } from 'zod'
import type { Coordinator } from '@pi-im-bot/runtime/coordinator'
import type { FrameworkEditor } from '@pi-im-bot/settings/editor'
import { SettingsEditError } from '@pi-im-bot/settings/editor'
import { FrameworkConfigSchema, SettingsPatchSchema } from '@pi-im-bot/settings/schema'
import type { Configuration } from '@pi-im-bot/config/load'

export function registerFrameworkRoutes(
  app: Hono,
  editor: FrameworkEditor,
  coordinator: Coordinator,
  configuration: () => Configuration
) {
  app.get('/api/framework', async (c) => {
    return c.json({ ...(await editor.read()), capabilities: configuration().resources.publicCapabilities() })
  })
  app.put(
    '/api/framework',
    sValidator('json', z.object({ version: z.string(), config: FrameworkConfigSchema })),
    async (c) => {
      const input = c.req.valid('json')
      const result = await editor.save(input.version, input.config)
      coordinator.events.emit({ type: 'config' })
      return c.json({ ...result, capabilities: configuration().resources.publicCapabilities() })
    }
  )
  app.post(
    '/api/rooms/:id/conversations',
    sValidator('json', z.object({ title: z.string().min(1).max(100).optional() })),
    (c) => {
      return c.json(coordinator.newConversation(c.req.param('id'), c.req.valid('json').title), 201)
    }
  )
  app.post('/api/rooms/:id/conversations/:conversationId/select', (c) => {
    const room = coordinator.switchConversation(c.req.param('id'), c.req.param('conversationId'))
    return c.json(room)
  })
  app.patch(
    '/api/rooms/:id/conversations/:conversationId',
    sValidator(
      'json',
      z.object({
        revision: z.number().int(),
        title: z.string().min(1).max(100).optional(),
        settings: SettingsPatchSchema.optional()
      })
    ),
    async (c) => {
      return editor.exclusive(async () => {
        const room = coordinator.requireRoom(c.req.param('id'))
        const conversation = coordinator.conversations.require(c.req.param('conversationId'), room.id)
        const input = c.req.valid('json')
        if (input.revision !== conversation.revision) {
          throw new SettingsEditError('对话设置已变化，请刷新后重试。', 409)
        }
        const next = { ...conversation, ...input, revision: conversation.revision + 1, updatedAt: Date.now() }
        editor.validate((await editor.read()).config, undefined, next)
        coordinator.store.saveConversation(next)
        coordinator.events.emit({ type: 'config' })
        return c.json(next)
      })
    }
  )
}
