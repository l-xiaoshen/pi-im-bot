import type { BotTool } from "@pi-im-bot/capabilities/tool"
import { z } from "zod"
import { createHash } from "node:crypto"
import {
  createReadToolDefinition,
  createWriteToolDefinition,
  createEditToolDefinition,
  createLsToolDefinition,
  createReadTool,
  createWriteTool,
  createEditTool,
  createLsTool
} from "@earendil-works/pi-coding-agent"
import type { ShipyardConfig } from "./config"
import { GUEST_WORKSPACE, displayContainerPaths, virtualPath } from "./path"
import { RemoteFiles } from "./remote-files"
import type { Sandbox } from "./shipyard-client"
import { SandboxSession } from "./session"
import { createRemoteBash } from "./bash-tool"
import { guestDisplay, guestErrors, toolDeclaration } from "./tool-definition"

const ReadInputSchema = z.object({
  path: z.string(),
  offset: z.number().optional(),
  limit: z.number().optional()
})
const WriteInputSchema = z.object({ path: z.string(), content: z.string() })
const EditInputSchema = z.object({
  path: z.string(),
  edits: z.array(z.object({ oldText: z.string(), newText: z.string() }))
})
const LsInputSchema = z.object({ path: z.string().optional(), limit: z.number().optional() })

export function createWorkspaceTools(
  config: ShipyardConfig,
  dataDir: string,
  scope: string,
  signal: AbortSignal,
  connected: (sandbox: Sandbox) => void
) {
  const session = new SandboxSession(config, dataDir, scope, signal, connected)
  // Pi serializes edits by resolved path. Different containers must not share that queue.
  const namespace = createHash("sha256").update(scope).digest("hex")
  const virtualCwd = virtualPath(GUEST_WORKSPACE, namespace)
  function inContainer(path: string) {
    return virtualPath(path, namespace)
  }
  const tools: BotTool[] = [
    {
      ...toolDeclaration(createReadToolDefinition(virtualCwd)),
      async execute(id, args, toolSignal, update) {
        const input = ReadInputSchema.parse(args)
        const remote = new RemoteFiles(session, toolSignal)
        return guestErrors(async () => {
          const path = inContainer(await remote.resolve(input.path))
          const result = await createReadTool(virtualCwd, {
            operations: {
              readFile: remote.read.bind(remote),
              access: remote.access.bind(remote),
              detectImageMimeType: remote.imageMime.bind(remote)
            }
          }).execute(id, { ...input, path }, toolSignal, update)
          // Preserve file contents exactly; only fix Pi's generated long-line hint.
          for (const part of result.content) {
            if (part.type === "text" && result.details?.truncation?.firstLineExceedsLimit) {
              part.text = displayContainerPaths(part.text)
            }
          }
          return result
        })
      }
    },
    {
      ...toolDeclaration(createWriteToolDefinition(virtualCwd)),
      async execute(id, args, toolSignal, update) {
        const input = WriteInputSchema.parse(args)
        const remote = new RemoteFiles(session, toolSignal)
        return guestErrors(async () => {
          const path = inContainer(await remote.resolve(input.path))
          return guestDisplay(
            await createWriteTool(virtualCwd, {
              operations: {
                writeFile: remote.write.bind(remote),
                mkdir: remote.mkdir.bind(remote)
              }
            }).execute(id, { ...input, path }, toolSignal, update)
          )
        })
      }
    },
    {
      ...toolDeclaration(createEditToolDefinition(virtualCwd)),
      async execute(id, args, toolSignal, update) {
        const input = EditInputSchema.parse(args)
        const remote = new RemoteFiles(session, toolSignal)
        return guestErrors(async () => {
          const path = inContainer(await remote.resolve(input.path))
          return guestDisplay(
            await createEditTool(virtualCwd, {
              operations: {
                readFile: remote.read.bind(remote),
                writeFile: remote.write.bind(remote),
                access: remote.access.bind(remote)
              }
            }).execute(id, { ...input, path }, toolSignal, update)
          )
        })
      }
    },
    {
      ...toolDeclaration(createLsToolDefinition(virtualCwd)),
      async execute(id, args, toolSignal, update) {
        const input = LsInputSchema.parse(args)
        const remote = new RemoteFiles(session, toolSignal)
        return guestErrors(async () => {
          const path = inContainer(await remote.resolve(input.path ?? "."))
          return createLsTool(virtualCwd, {
            operations: {
              exists: remote.exists.bind(remote),
              stat: remote.stat.bind(remote),
              readdir: remote.readdir.bind(remote)
            }
          }).execute(id, { ...input, path }, toolSignal, update)
        })
      }
    },
    createRemoteBash(session)
  ]
  for (const tool of tools) {
    tool.description += " Paths refer to the remote container, never the Bot host. /workspace is persistent."
  }
  return {
    tools,
    close: session.close.bind(session),
    upload: session.upload.bind(session),
    async download(path: string, toolSignal?: AbortSignal) {
      const remote = new RemoteFiles(session, toolSignal)
      return remote.read(inContainer(await remote.resolve(path)))
    }
  }
}
