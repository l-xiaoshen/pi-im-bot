import { z } from 'zod'
import { GraphSchema, resourceRisks, type Workflow, type ParameterSchema } from './resources'
export const ParametersSchema = z.record(
  z.string().max(48),
  z.union([z.string().max(16000), z.number().finite(), z.boolean()])
)
export type Parameters = z.infer<typeof ParametersSchema>
export function compileWorkflow(workflow: Workflow, input: Parameters) {
  const parameters = ParametersSchema.parse(input)
  if (resourceRisks(parameters).length) {
    throw new Error('参数包含未允许的URL、秘密或宿主路径')
  }
  const graph = structuredClone(workflow.graph)
  for (const name of Object.keys(parameters)) {
    if (!workflow.parameters[name]) {
      throw new Error('参数未登记：' + name)
    }
  }
  function assign(name: string, binding: z.infer<typeof ParameterSchema>, value: string | number | boolean) {
    if (typeof value !== binding.type) {
      throw new Error('参数类型不匹配：' + name)
    }
    if (
      typeof value === 'number' &&
      ((binding.min !== undefined && value < binding.min) ||
        (binding.max !== undefined && value > binding.max))
    ) {
      throw new Error('参数超出范围：' + name)
    }
    if (typeof value === 'string' && value.length > binding.maxLength) {
      throw new Error('参数过长：' + name)
    }
    for (const [index, path] of binding.paths.entries()) {
      let output: string | number | boolean = value
      if (typeof value === 'number') {
        output = value + (binding.offsets[index] ?? 0)
        if (
          !Number.isFinite(output) ||
          (binding.integer && !Number.isSafeInteger(output)) ||
          (binding.min !== undefined && output < binding.min) ||
          (binding.max !== undefined && output > binding.max)
        ) {
          throw new Error('参数变换超出登记范围：' + name)
        }
        if (binding.encoding === 'number-string') {
          output = String(output)
        }
      } else if (binding.encoding !== 'identity') {
        throw new Error('非数值参数不能使用数值编码')
      }
      let cursor: object = graph
      for (const segment of path.slice(0, -1)) {
        const child: unknown = Reflect.get(cursor, String(segment))
        if (!child || typeof child !== 'object') {
          throw new Error('模板参数路径已失效')
        }
        cursor = child
      }
      Reflect.set(cursor, String(path.at(-1)), output)
    }
  }
  for (const [name, binding] of Object.entries(workflow.parameters)) {
    if (binding.default !== undefined) {
      assign(name, binding, binding.default)
    }
  }
  for (const [name, value] of Object.entries(parameters)) {
    assign(name, workflow.parameters[name], value)
  }
  return GraphSchema.parse(graph)
}
