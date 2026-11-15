import type { BotTool } from '@pi-im-bot/capabilities/tool'
import { z } from 'zod'
import {
  createBashToolDefinition,
  createBashTool,
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  truncateTail
} from '@earendil-works/pi-coding-agent'
import type { SandboxSession } from './session'
import { GUEST_WORKSPACE, virtualPath } from './path'
import { RemoteFiles } from './remote-files'
import { toolDeclaration } from './tool-definition'

const BashInputSchema = z.object({ command: z.string(), timeout: z.number().positive().optional() })

export function createRemoteBash(session: SandboxSession): BotTool {
  const declaration = createBashToolDefinition(GUEST_WORKSPACE, { exposeSessionEnvironment: false })
  return {
    ...toolDeclaration(declaration),
    description:
      declaration.description +
      ' Runs only inside the Shipyard container. No host environment or credentials are forwarded.',
    async execute(id, input, signal, update) {
      const args = BashInputSchema.parse(input)
      const remote = new RemoteFiles(session, signal)
      const tool = createBashTool(GUEST_WORKSPACE, {
        exposeSessionEnvironment: false,
        operations: {
          async exec(command, _cwd, options) {
            const result = await session.execute(command, options.signal, options.timeout)
            let output = result.output
            if (result.error) {
              output += '\n' + result.error
            }
            // Keep Pi's OutputAccumulator below its local spill thresholds.
            // Full output, when available, belongs to the guest workspace.
            const tail = truncateTail(output, {
              maxBytes: DEFAULT_MAX_BYTES - 1024,
              maxLines: DEFAULT_MAX_LINES - 10
            })
            let preview = tail.content
            if (tail.truncated) {
              if (Buffer.byteLength(output) <= session.config.maxFileBytes) {
                const path = '/workspace/.pi-output/' + crypto.randomUUID() + '.log'
                await remote.write(virtualPath(path), output)
                preview += '\n[完整输出保存在沙盒 ' + path + ']'
              } else {
                preview += '\n[输出超过传输上限；请在容器内将命令输出重定向到文件]'
              }
            }
            options.onData(Buffer.from(preview))
            return { exitCode: result.exit_code }
          }
        }
      })
      return tool.execute(id, args, signal, update)
    }
  }
}
