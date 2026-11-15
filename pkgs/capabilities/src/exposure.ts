import type { BotTool } from './tool'
import type { ResourceSettingsSchema } from '@pi-im-bot/settings/schema'
import type { z } from 'zod'

type ResourceSettings = z.infer<typeof ResourceSettingsSchema>

export function exposedDefinitions(tools: BotTool[], resources: ResourceSettings): BotTool[] {
  return tools.map((tool) => {
    let exposure: BotTool['exposure'] = 'direct'
    if (resources.toolExposure === 'deferred' && !resources.permanentTools.includes(tool.name)) {
      exposure = 'deferred'
    }
    return { ...tool, exposure }
  })
}
