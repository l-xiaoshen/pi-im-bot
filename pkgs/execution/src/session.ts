import type { ShipyardConfig } from './config'
import { ShipyardClient, type Sandbox } from './shipyard-client'
import { openWorkspace } from './workspace'

export class SandboxSession {
  private readonly client: ShipyardClient
  private workspace?: Promise<Sandbox>
  private stopping?: Promise<void>
  private cancelled = false
  private listening = false
  private readonly onAbort = () => {
    void this.stop().catch(() => {})
  }

  constructor(
    readonly config: ShipyardConfig,
    private readonly dataDir: string,
    private readonly scope: string,
    private readonly signal: AbortSignal,
    private readonly connected: (sandbox: Sandbox) => void
  ) {
    this.client = new ShipyardClient(config)
  }

  async execute(command: string, signal?: AbortSignal, timeout = this.config.commandTimeoutSeconds) {
    const seconds = Math.max(1, Math.min(300, Math.ceil(timeout)))
    return this.run(
      async (sandbox, operationSignal) => {
        const result = await this.client.shell(sandbox.id, command, operationSignal, seconds)
        if (result.exit_code === null || result.exit_code < 0) {
          throw new Error('沙盒命令中断或超时，停止容器计算后持久工作区仍保留')
        }
        return result
      },
      signal,
      seconds * 1000 + this.config.timeoutMs
    )
  }

  async upload(path: string, content: string | Uint8Array, signal?: AbortSignal) {
    return this.run(
      async (sandbox, operationSignal) => {
        await this.client.upload(sandbox.id, path, content, operationSignal)
      },
      signal,
      this.config.timeoutMs
    )
  }

  private async run<T>(
    operation: (sandbox: Sandbox, signal: AbortSignal) => Promise<T>,
    signal: AbortSignal | undefined,
    timeoutMs: number
  ) {
    this.signal.throwIfAborted()
    signal?.throwIfAborted()
    if (this.cancelled) {
      throw new Error('本轮沙盒执行已停止')
    }
    if (!this.listening) {
      this.signal.addEventListener('abort', this.onAbort, { once: true })
      this.listening = true
    }
    const signals = [this.signal, AbortSignal.timeout(timeoutMs)]
    if (signal) {
      signals.push(signal)
    }
    const operationSignal = AbortSignal.any(signals)
    operationSignal.addEventListener('abort', this.onAbort, { once: true })
    try {
      this.workspace ??= openWorkspace(this.client, this.dataDir, this.scope).then((sandbox) => {
        this.connected(sandbox)
        return sandbox
      })
      const sandbox = await this.workspace
      operationSignal.throwIfAborted()
      return await operation(sandbox, operationSignal)
    } catch (error) {
      // A lost response must not leave a command writing in the background.
      await this.stop()
      throw error
    } finally {
      operationSignal.removeEventListener('abort', this.onAbort)
    }
  }

  private stop() {
    this.cancelled = true
    if (!this.workspace) {
      return Promise.resolve()
    }
    this.stopping ??= this.workspace.then(async (sandbox) => {
      try {
        await this.client.interrupt(sandbox.id)
      } catch {
        // Container teardown remains necessary if the execution endpoint is unavailable.
      } finally {
        await this.client.stop(sandbox.id)
      }
    })
    return this.stopping
  }

  async close() {
    this.signal.removeEventListener('abort', this.onAbort)
    if (this.stopping) {
      await this.stopping
    }
  }
}
