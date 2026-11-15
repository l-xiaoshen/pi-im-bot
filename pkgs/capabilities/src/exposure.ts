import type { BotTool } from './tool'
import { z } from 'zod'
import { createToolSearchExtension, type ExtensionFactory } from '@earendil-works/pi-coding-agent'
import type { ResourceSettingsSchema } from '@pi-im-bot/settings/schema'

const ExposureStateSchema = z.object({
  turn: z.number().int().nonnegative(),
  lastUsed: z.record(z.string(), z.number().int().nonnegative())
})
const SearchResultSchema = z.object({ details: z.object({ loaded: z.array(z.string()) }) })
const entryType = 'bot-tool-exposure-v1'
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

export function createExposureExtension(
  resources: ResourceSettings,
  searchAllowed: boolean,
  authorize: (capability: string) => void
): ExtensionFactory {
  return (pi) => {
    if (searchAllowed) {
      createToolSearchExtension()(pi)
    }
    let state = ExposureStateSchema.parse({ turn: 0, lastUsed: {} })
    pi.on('session_start', (_event, context) => {
      for (const entry of context.sessionManager.getBranch()) {
        if (entry.type === 'custom' && entry.customType === entryType) {
          const parsed = ExposureStateSchema.safeParse(entry.data)
          if (parsed.success) {
            state = parsed.data
          }
        }
      }
      state.turn += 1
      const registered = pi.getAllTools()
      const active: string[] = []
      const retained: Record<string, number> = {}
      for (const tool of registered) {
        const lastUsed = state.lastUsed[tool.name]
        if (tool.name === 'tool_search' || resources.permanentTools.includes(tool.name)) {
          active.push(tool.name)
        } else if (lastUsed !== undefined && state.turn - lastUsed <= resources.idleToolTurns) {
          active.push(tool.name)
          retained[tool.name] = lastUsed
        }
      }
      state.lastUsed = retained
      pi.setActiveTools(active)
    })
    pi.on('tool_call', (event) => {
      if (event.toolName === 'tool_search') {
        try {
          authorize('tool_search')
        } catch (error) {
          return { block: true, reason: String(error) }
        }
      }
      return undefined
    })
    pi.on('tool_execution_end', (event) => {
      if (event.toolName === 'tool_search') {
        const result = SearchResultSchema.safeParse(event.result)
        if (result.success) {
          for (const name of result.data.details.loaded) {
            state.lastUsed[name] = state.turn
          }
        }
      } else {
        state.lastUsed[event.toolName] = state.turn
      }
    })
    pi.on('agent_end', () => {
      pi.appendEntry(entryType, state)
    })
    pi.on('before_agent_start', (event) => {
      event.systemPromptOptions.sections.bot_tool_catalog =
        'Tools are loaded on demand. Use tool_search to find capabilities by name or task; matching authorized tools become available on the next model call. Previously used tools stay loaded for a limited number of user turns. Loading a tool does not grant permission to execute it.'
      if (!searchAllowed) {
        event.systemPromptOptions.sections.bot_tool_catalog =
          'Only the configured permanent tools are available for this trigger. Tool search is not authorized.'
      }
    })
  }
}
