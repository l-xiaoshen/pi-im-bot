import { z } from "zod"
import { botApiUrl } from "./bot-origin"

export class ApiValidationError extends Error {
  constructor(
    message: string,
    readonly issues: Array<{ path: string; message: string }>
  ) {
    super(message)
  }
}

export async function request<T>(path: string, schema: z.ZodType<T>, options: RequestInit = {}) {
  const response = await fetch(botApiUrl(path), options)
  const value: unknown = await response.json()
  if (!response.ok) {
    const error = z
      .object({
        error: z.string(),
        issues: z.array(z.object({ path: z.string(), message: z.string() })).optional()
      })
      .safeParse(value)
    if (error.success) {
      if (error.data.issues) {
        throw new ApiValidationError(error.data.error, error.data.issues)
      }
      throw new Error(error.data.error)
    }
    throw new Error(`请求失败 (${response.status})，请检查输入。`)
  }
  return schema.parse(value)
}

export async function mutate(path: string, body?: object, method = "POST") {
  const options: RequestInit = { method }
  if (body !== undefined) {
    options.headers = { "content-type": "application/json" }
    options.body = JSON.stringify(body)
  }
  return request(path, z.unknown(), options)
}
