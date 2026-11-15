import { connect } from "node:net"
import { pathToFileURL } from "node:url"
import { z } from "zod"
import { compile } from "@earendil-works/pi-schema"
import { PluginManifestSchema } from "@pi-im-bot/plugins/manifest"
import {
  HostMessageSchema,
  PluginOperationOutcomeSchema,
  PluginResultSchema,
  type WorkerMessage,
  type PluginInvocationView
} from "@pi-im-bot/plugins/rpc/protocol"
import { encodePluginFrame, PluginFrameReader } from "@pi-im-bot/plugins/rpc/codec"
import type { PluginImplementation, PluginContext } from "./index"

const EnvSchema = z.object({
  BOT_PLUGIN_RPC: z.string(),
  BOT_PLUGIN_TOKEN: z.string(),
  BOT_PLUGIN_ENTRY: z.string(),
  BOT_PLUGIN_PACKAGE: z.string().default("/plugin"),
  BOT_PLUGIN_DATA: z.string().default("/data/files"),
  BOT_PLUGIN_MODE: z.enum(["plugin", "validator", "stateless"]).default("plugin")
})
const env = EnvSchema.parse(process.env)
if (env.BOT_PLUGIN_MODE === "plugin") {
  process.chdir(env.BOT_PLUGIN_DATA)
}
const manifest = PluginManifestSchema.parse(await Bun.file(env.BOT_PLUGIN_PACKAGE + "/plugin.json").json())
let implementation: PluginImplementation = {}
if (env.BOT_PLUGIN_MODE !== "validator") {
  implementation = (await import(pathToFileURL(env.BOT_PLUGIN_ENTRY).href)).default
}
const ObjectSchema = z.object({}).passthrough()
ObjectSchema.parse(implementation)
const pending = new Map<string, PromiseWithResolvers<unknown>>()
const active = new Map<string, AbortController>()
const socket = connect(env.BOT_PLUGIN_RPC)
await new Promise<void>((resolve, reject) => {
  socket.once("connect", resolve)
  socket.once("error", reject)
})
function send(message: WorkerMessage) {
  socket.write(encodePluginFrame(message))
}
send({ type: "hello", token: env.BOT_PLUGIN_TOKEN })
send({ type: "ready" })

function validate(schema: unknown, value: unknown) {
  const result = compile(ObjectSchema.parse(schema))
  if (!result.check(value)) {
    throw new Error("输入或输出未满足插件声明的 schema")
  }
}
function pluginContext(invocation: PluginInvocationView, controller: AbortController): PluginContext {
  return {
    dataDir: env.BOT_PLUGIN_DATA,
    invocation: Object.freeze(structuredClone(invocation)),
    signal: controller.signal,
    async host(method, params = {}) {
      controller.signal.throwIfAborted()
      const id = crypto.randomUUID()
      const response = Promise.withResolvers<unknown>()
      pending.set(id, response)
      const abort = () => {
        response.reject(new Error("插件调用已取消"))
      }
      controller.signal.addEventListener("abort", abort, { once: true })
      try {
        send({
          type: "host_call",
          invocationId: invocation.id,
          id,
          method,
          params: z.record(z.string(), z.json()).parse(params)
        })
        return await response.promise
      } finally {
        pending.delete(id)
        controller.signal.removeEventListener("abort", abort)
      }
    }
  }
}

const reader = new PluginFrameReader()
socket.on("data", (chunk) => {
  try {
    reader.feed(z.instanceof(Uint8Array).parse(chunk), (raw) => {
      const message = HostMessageSchema.parse(raw)
      if (message.type === "host_result") {
        pending.get(message.id)?.resolve(message.value)
        return
      }
      if (message.type === "host_error") {
        pending.get(message.id)?.reject(new Error(message.error.message))
        return
      }
      if (message.type === "cancel") {
        active.get(message.invocationId)?.abort()
        return
      }
      const controller = new AbortController()
      active.set(message.context.id, controller)
      void (async () => {
        let phase: "validation" | "handler" = "validation"
        try {
          if (env.BOT_PLUGIN_MODE === "validator" && message.action.kind !== "validate") {
            throw new Error("契约验证 Worker 不执行插件代码")
          }
          if (env.BOT_PLUGIN_MODE !== "validator" && manifest.configSchema) {
            validate(manifest.configSchema, message.context.settings)
          }
          const context = pluginContext(message.context, controller)
          let output: unknown
          const action = message.action
          if (action.kind === "validate") {
            output = { valid: true }
            if (action.handler !== "config") {
              const point = manifest.points.find((point) => {
                return point.id === action.handler
              })
              if (!point) {
                throw new Error("插件没有声明该切入点")
              }
              let schema = point.outputSchema
              if (action.validation === "input") {
                schema = point.inputSchema
              }
              validate(schema, message.input)
            }
          } else if (action.kind === "operation") {
            const operation = manifest.operations.find((operation) => {
              return operation.id === (action.operation ?? action.handler)
            })
            if (!operation) {
              throw new Error("插件没有声明该操作")
            }
            if (env.BOT_PLUGIN_MODE === "stateless" && operation.data !== "none") {
              throw new Error("无数据 Worker 只能执行无数据操作")
            }
            if (action.phase === "recover" && operation.recoverInputSchema) {
              validate(operation.recoverInputSchema, message.input)
            }
            if ((action.phase === "poll" || action.phase === "reconcile") && operation.pollInputSchema) {
              validate(operation.pollInputSchema, message.input)
            }
            if (action.phase === "cancel" && operation.cancelInputSchema) {
              validate(operation.cancelInputSchema, message.input)
            }
            if (action.phase === "execute") {
              validate(operation.inputSchema, message.input)
            }
            const handler = implementation.operations?.[action.handler]
            if (!handler || !Object.hasOwn(implementation.operations ?? {}, action.handler)) {
              throw new Error("插件操作没有实现")
            }
            phase = "handler"
            const result = await handler(structuredClone(message.input), context)
            const outcome = PluginOperationOutcomeSchema.safeParse(result)
            if (outcome.success) {
              output = outcome.data
            } else {
              output = { status: "done", result: PluginResultSchema.parse(result) }
            }
            const checked = PluginOperationOutcomeSchema.parse(output)
            if (checked.status === "pending" && operation.handleSchema) {
              validate(operation.handleSchema, checked.handle)
            }
            if (checked.status === "done" && operation.outputSchema) {
              validate(operation.outputSchema, checked.result.value ?? checked.result)
            }
          } else if (action.kind === "hook") {
            const handler = implementation.hooks?.[action.handler]
            if (!handler || !Object.hasOwn(implementation.hooks ?? {}, action.handler)) {
              throw new Error("插件处理器没有实现")
            }
            phase = "handler"
            output = await handler(structuredClone(message.input), context)
            if (
              output === undefined &&
              manifest.hooks.find((hook) => {
                return hook.id === action.handler
              })?.mode === "observe"
            ) {
              output = null
            }
          } else {
            const handler = implementation.parsers?.[action.handler]
            if (!handler || !Object.hasOwn(implementation.parsers ?? {}, action.handler)) {
              throw new Error("指令解析器没有实现")
            }
            phase = "handler"
            output = await handler(z.object({ text: z.string() }).parse(message.input), context)
          }
          controller.signal.throwIfAborted()
          send({ type: "result", invocationId: message.context.id, value: z.json().parse(output) })
        } catch (error) {
          send({
            type: "error",
            invocationId: message.context.id,
            error: { code: phase, message: String(error).slice(0, 2000) }
          })
        } finally {
          active.delete(message.context.id)
          controller.abort()
        }
      })()
    })
  } catch {
    socket.destroy()
    process.exitCode = 1
  }
})
socket.on("close", () => {
  for (const controller of active.values()) {
    controller.abort()
  }
  process.exit(0)
})
socket.on("error", () => {
  process.exit(1)
})
