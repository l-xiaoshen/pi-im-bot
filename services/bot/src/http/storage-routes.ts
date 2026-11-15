import type { Hono } from 'hono'
import type { Configuration } from '@pi-im-bot/config/load'
import type { PluginService } from '@pi-im-bot/plugins/service'
import { artifactBudget } from '@pi-im-bot/artifacts/quota'

export function registerStorageRoutes(app: Hono, configuration: () => Configuration, plugins: PluginService) {
  app.get('/api/plugins/storage', async (c) => {
    return c.json({
      executionEnabled: plugins.available(),
      data: await plugins.manager.volumes.status(),
      artifacts: await artifactBudget(configuration().dataDir).status()
    })
  })
  app.post('/api/plugins/storage/reconcile', async (c) => {
    return c.json(await artifactBudget(configuration().dataDir).reconcile())
  })
}
