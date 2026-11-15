import type { BotTool } from '@pi-im-bot/capabilities/tool'
import { z } from 'zod'
import { obj, str, int, opt } from '@earendil-works/pi-schema'
import type { ArtifactStore } from './store'

const ReadArtifactSchema = z.object({
  id: z.uuid(),
  offset: z.number().int().min(0).default(0),
  limit: z.number().int().min(1).max(20000).default(8000)
})
export function artifactTool(store: ArtifactStore): BotTool {
  return {
    name: 'artifact_read',
    label: '读取会话产物',
    description:
      'Read a page of a text artifact returned by tools in this chat scope. Use the artifact ID, never a host file path. offset and limit count characters.',
    parameters: obj({
      id: str(),
      offset: opt(int({ minimum: 0 })),
      limit: opt(int({ minimum: 1, maximum: 20000 }))
    }),
    async execute(_id, args, signal) {
      signal?.throwIfAborted()
      const input = ReadArtifactSchema.parse(args)
      const result = await store.readText(input.id, input.offset, input.limit)
      signal?.throwIfAborted()
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        details: { artifactId: result.artifact.id }
      }
    }
  }
}
