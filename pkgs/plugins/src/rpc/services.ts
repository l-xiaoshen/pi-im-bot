import { z } from 'zod'
import type { PluginBinding } from '../registry'
import { PluginGrantSchema } from '../manifest'
import { PluginInvocationViewSchema, type PluginInvocationView } from './protocol'

interface PluginHostCall {
  invocation: Readonly<PluginInvocationView>
  signal: AbortSignal
}

/** Registered by the core only. A Worker receives method names, never service instances. */
export class PluginHostServices {
  validateResult = () => {}
  private readonly methods = new Map<
    string,
    {
      grant: string
      call(input: unknown, context: PluginHostCall): Promise<unknown>
    }
  >()

  register<Schema extends z.ZodType>(
    name: string,
    grant: string,
    schema: Schema,
    handle: (input: z.output<Schema>, context: PluginHostCall) => Promise<unknown>
  ) {
    if (this.methods.has(name)) {
      throw new Error('插件宿主方法重复：' + name)
    }
    this.methods.set(name, {
      grant: PluginGrantSchema.parse(grant),
      async call(input, context) {
        return handle(schema.parse(input), context)
      }
    })
  }

  bind(
    binding: PluginBinding,
    context: PluginInvocationView,
    declaredGrants: readonly string[],
    authorize: (grant: string, invocation: Readonly<PluginInvocationView>) => void
  ) {
    const invocation = PluginInvocationViewSchema.parse(structuredClone(context))
    if (invocation.instanceId !== binding.instance.id || invocation.generation !== binding.bundle.revision) {
      throw new Error('插件宿主服务与调用版本不匹配')
    }
    const grants = new Set(
      invocation.grants.filter((grant) => {
        return binding.instance.grants.includes(grant) && declaredGrants.includes(grant)
      })
    )
    return async (name: string, input: unknown, signal: AbortSignal) => {
      signal.throwIfAborted()
      if (Date.now() >= invocation.deadlineAt) {
        throw new Error('插件宿主调用已过期')
      }
      const method = this.methods.get(name)
      if (!method || !grants.has(method.grant)) {
        throw new Error('插件未获准调用宿主服务：' + name)
      }
      authorize(method.grant, structuredClone(invocation))
      return method.call(input, { invocation: structuredClone(invocation), signal })
    }
  }
}
