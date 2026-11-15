import type { ToolDefinition } from '@earendil-works/pi-coding-agent'

/** A framework-owned tool executor without access to CLI sessions or host extensions. */
export type BotTool = Omit<ToolDefinition, 'execute'> & {
  replay?: 'safe' | 'unsafe'
  execute(
    callId: string,
    args: unknown,
    signal: AbortSignal | undefined,
    update: Parameters<ToolDefinition['execute']>[3]
  ): ReturnType<ToolDefinition['execute']>
}
