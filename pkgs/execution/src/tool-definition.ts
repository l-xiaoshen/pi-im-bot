import type { ToolDefinition } from '@earendil-works/pi-coding-agent'
import { displayContainerPaths } from './path'

// The web Bot doesn't use Pi's TUI renderers. Keep the native declarations and
// schemas, and adapt unknown RPC inputs before invoking their typed executors.
type Declaration = Pick<
  ToolDefinition,
  | 'name'
  | 'label'
  | 'description'
  | 'parameters'
  | 'outputSchema'
  | 'promptSnippet'
  | 'promptGuidelines'
  | 'constrainedSampling'
>

export function toolDeclaration(tool: Declaration): Declaration {
  return {
    name: tool.name,
    label: tool.label,
    description: tool.description,
    parameters: tool.parameters,
    outputSchema: tool.outputSchema,
    promptSnippet: tool.promptSnippet,
    promptGuidelines: tool.promptGuidelines,
    constrainedSampling: tool.constrainedSampling
  }
}

export async function guestErrors<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    throw new Error(displayContainerPaths(String(error)))
  }
}

export function guestDisplay(result: Awaited<ReturnType<ToolDefinition['execute']>>) {
  return {
    ...result,
    content: result.content.map((part) => {
      if (part.type === 'text') {
        return { ...part, text: displayContainerPaths(part.text) }
      }
      return part
    })
  }
}
