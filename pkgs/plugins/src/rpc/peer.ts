import { createServer, type Socket, type Server } from 'node:net'
import { chmod, rm } from 'node:fs/promises'
import { timingSafeEqual, createHash } from 'node:crypto'
import { BACKGROUND_CONTEXT, awaitWithContext, withAbortSignal } from '@earendil-works/chord/context'
import { PluginFrameReader, encodePluginFrame } from './codec'
import {
  WorkerMessageSchema,
  type HostMessage,
  type PluginInvocationView,
  type PluginAction,
  type PluginFailure
} from './protocol'
import { z } from 'zod'

export class PluginInvocationError extends Error {
  constructor(readonly failure: PluginFailure) {
    super(failure.message)
  }
}
interface ActiveInvocation {
  context: PluginInvocationView
  result: PromiseWithResolvers<unknown>
  host(
    method: string,
    params: Record<string, z.infer<ReturnType<typeof z.json>>>,
    signal: AbortSignal
  ): Promise<unknown>
  signal: AbortSignal
  controller: AbortController
  finished: boolean
  inFlight: number
  receivedBytes: number
  responseBytes: number
  calls: number
  replies: Map<string, HostReply>
}

interface HostReply {
  signature: string
  result: Promise<HostMessage>
}

export class PluginPeer {
  private server?: Server
  private socket?: Socket
  private active?: ActiveInvocation
  private connected = false
  private readyReceived = false
  private closing = false
  private readonly sockets = new Set<Socket>()
  private readonly readiness = Promise.withResolvers<void>()

  constructor(
    private readonly path: string,
    private readonly token: string,
    private readonly maxCalls: number,
    private readonly fault: (error: Error) => void
  ) {
    void this.readiness.promise.catch(() => {})
  }

  async listen() {
    this.server = createServer((socket) => {
      if (this.closing || this.sockets.size >= 2) {
        socket.destroy()
        return
      }
      this.sockets.add(socket)
      const reader = new PluginFrameReader()
      let authenticated = false
      const handshakeTimeout = setTimeout(() => {
        socket.destroy()
      }, 1000)
      socket.on('data', (chunk) => {
        try {
          reader.feed(z.instanceof(Uint8Array).parse(chunk), (raw, bytes) => {
            const message = WorkerMessageSchema.parse(raw)
            if (!authenticated) {
              if (message.type !== 'hello' || this.connected) {
                throw new Error('插件 RPC 握手无效')
              }
              const expected = Buffer.from(this.token)
              const actual = Buffer.from(message.token)
              if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
                throw new Error('插件 RPC 身份不匹配')
              }
              authenticated = true
              clearTimeout(handshakeTimeout)
              this.connected = true
              this.socket = socket
              return
            }
            if (message.type === 'ready') {
              if (this.readyReceived) {
                throw new Error('插件重复就绪通知')
              }
              this.readyReceived = true
              this.readiness.resolve()
              return
            }
            if (message.type === 'hello') {
              throw new Error('插件重复握手')
            }
            const active = this.active
            if (!active || active.finished || message.invocationId !== active.context.id) {
              throw new Error('插件调用上下文已过期或不匹配')
            }
            active.receivedBytes += bytes
            if (active.receivedBytes > 32 * 1024 * 1024) {
              throw new Error('插件超过本次 RPC 数据预算')
            }
            if (message.type === 'result' || message.type === 'error') {
              if (active.inFlight > 0) {
                throw new Error('插件返回时仍有未完成的宿主调用')
              }
              active.finished = true
              active.controller.abort('plugin returned')
              if (message.type === 'result') {
                active.result.resolve(message.value)
              } else {
                active.result.reject(new PluginInvocationError(message.error))
              }
              return
            }
            active.calls += 1
            if (active.calls > this.maxCalls) {
              throw new Error('插件超过本次 RPC 调用预算')
            }
            const signature = createHash('sha256')
              .update(JSON.stringify([message.method, message.params]))
              .digest('hex')
            let reply = active.replies.get(message.id)
            if (reply && reply.signature !== signature) {
              throw new Error('插件 RPC 幂等键不匹配')
            }
            if (!reply) {
              active.inFlight += 1
              const response = Promise.resolve().then(async (): Promise<HostMessage> => {
                try {
                  active.signal.throwIfAborted()
                  const value = z
                    .json()
                    .parse(await active.host(message.method, message.params, active.signal))
                  active.responseBytes += Buffer.byteLength(JSON.stringify(value))
                  if (active.responseBytes > 32 * 1024 * 1024) {
                    throw new Error('插件超过本次宿主结果预算')
                  }
                  return { type: 'host_result', id: message.id, value }
                } catch (error) {
                  let errorMessage = String(error).slice(0, 2000)
                  const io = z.object({ code: z.string().regex(/^E[A-Z0-9_]{1,30}$/u) }).safeParse(error)
                  if (io.success) {
                    errorMessage = '宿主文件或连接服务失败（' + io.data.code + '）'
                  }
                  return {
                    type: 'host_error',
                    id: message.id,
                    error: { code: 'permission', message: errorMessage }
                  }
                } finally {
                  active.inFlight -= 1
                }
              })
              reply = { signature, result: response }
              active.replies.set(message.id, reply)
            }
            void reply.result
              .then((response) => {
                if (this.active === active && !active.signal.aborted) {
                  this.send(response)
                }
              })
              .catch((error) => {
                this.fail(error)
              })
          })
        } catch (error) {
          socket.destroy()
          if (authenticated) {
            this.fail(error)
          }
        }
      })
      socket.on('error', (error) => {
        if (authenticated) {
          this.fail(error)
        }
      })
      socket.on('close', () => {
        clearTimeout(handshakeTimeout)
        this.sockets.delete(socket)
        if (authenticated && !this.closing) {
          this.fail(new Error('插件连接已关闭'))
        }
      })
    })
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject)
      this.server!.listen(this.path, resolve)
    })
    await chmod(this.path, 0o600)
  }
  ready(signal: AbortSignal) {
    return awaitWithContext(this.readiness.promise, withAbortSignal(signal, BACKGROUND_CONTEXT))
  }
  private send(message: HostMessage) {
    if (!this.socket || this.socket.destroyed) {
      throw new Error('插件连接不可用')
    }
    if (this.socket.writableLength > 1024 * 1024) {
      throw new Error('插件读取过慢')
    }
    this.socket.write(encodePluginFrame(message))
  }
  private fail(error: unknown) {
    const failure = new Error(String(error).slice(0, 2000))
    this.readiness.reject(failure)
    this.active?.result.reject(failure)
    this.active?.controller.abort(failure)
    this.fault(failure)
  }
  async invoke(
    action: PluginAction,
    context: PluginInvocationView,
    input: unknown,
    signal: AbortSignal,
    host: ActiveInvocation['host']
  ) {
    if (this.active) {
      throw new Error('插件 Worker 已有活动调用')
    }
    signal.throwIfAborted()
    const controller = new AbortController()
    const active: ActiveInvocation = {
      context,
      signal: AbortSignal.any([signal, controller.signal]),
      controller,
      finished: false,
      inFlight: 0,
      receivedBytes: 0,
      responseBytes: 0,
      host,
      result: Promise.withResolvers(),
      calls: 0,
      replies: new Map()
    }
    void active.result.promise.catch(() => {})
    this.active = active
    try {
      this.send({ type: 'invoke', action, context, input: z.json().parse(input) })
      return await awaitWithContext(active.result.promise, withAbortSignal(signal, BACKGROUND_CONTEXT))
    } finally {
      this.active = undefined
      controller.abort('invocation finished')
      if (signal.aborted) {
        try {
          this.send({ type: 'cancel', invocationId: context.id })
        } catch {}
      }
    }
  }
  async close() {
    this.closing = true
    this.readiness.reject(new Error('插件连接已关闭'))
    this.active?.result.reject(new Error('插件连接已关闭'))
    for (const socket of this.sockets) {
      socket.destroy()
    }
    await new Promise<void>((resolve) => {
      if (!this.server) {
        resolve()
        return
      }
      this.server.close(() => {
        resolve()
      })
    })
    await rm(this.path, { force: true })
  }
}
