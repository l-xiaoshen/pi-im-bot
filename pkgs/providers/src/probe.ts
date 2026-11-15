import { z } from 'zod'
import { normalizeContext, type Model } from '@earendil-works/pi-ai'
import { streamSimple } from '@earendil-works/pi-ai/api/openai-responses'
import type { ProviderConfig } from './schema'
import { applyBody, mergeBody, mergeHeaders } from './body'
import { redactProviderError } from './editor-secrets'

function apiKey(provider: ProviderConfig) {
  if (provider.apiKeyEnv) {
    const value = process.env[provider.apiKeyEnv]
    if (value === undefined) {
      throw new Error(`环境变量 ${provider.apiKeyEnv} 不存在。`)
    }
    return value
  }
  return provider.apiKey ?? ''
}

export async function listProviderModels(provider: ProviderConfig, signal: AbortSignal) {
  try {
    const key = apiKey(provider)
    const headers = new Headers({ accept: 'application/json' })
    if (key) {
      headers.set('authorization', `Bearer ${key}`)
    }
    for (const [name, value] of Object.entries(provider.headers)) {
      if (value === null) {
        headers.delete(name)
      } else {
        headers.set(name, value)
      }
    }
    const url = new URL(provider.baseUrl)
    url.pathname = `${url.pathname.replace(/\/+$/, '')}/models`
    const response = await fetch(url, {
      headers,
      signal: AbortSignal.any([signal, AbortSignal.timeout(Math.min(provider.timeoutMs, 15000))])
    })
    if (!response.ok) {
      throw new Error(`获取模型失败：HTTP ${response.status}。可检查地址和凭据，或手动添加模型。`)
    }
    const body = await readLimitedText(response, 2 * 1024 * 1024)
    const parsed = z
      .object({
        data: z.array(z.object({ id: z.string().min(1), owned_by: z.string().nullish() })).max(10000)
      })
      .safeParse(JSON.parse(body))
    if (!parsed.success) {
      throw new Error('服务未返回 OpenAI /models 格式，可手动添加模型。')
    }
    const models = new Map(
      parsed.data.data.map((model) => {
        return [model.id, { id: model.id, owner: model.owned_by ?? undefined }]
      })
    )
    return {
      models: [...models.values()].sort((a, b) => {
        return a.id.localeCompare(b.id)
      })
    }
  } catch (error) {
    throw new Error(redactProviderError(error, provider))
  }
}

export async function probeProviderModel(provider: ProviderConfig, modelId: string, signal: AbortSignal) {
  const config = provider.models.find((model) => {
    return model.id === modelId
  })
  if (!config) {
    throw new Error('请先添加要测试的模型。')
  }
  const started = performance.now()
  try {
    const key = apiKey(provider)
    const defaults: Record<string, string | null> = {}
    if (!key) {
      defaults.authorization = null
    }
    const input: ('text' | 'image')[] = ['text']
    if (config.images) {
      input.push('image')
    }
    const model: Model<'openai-responses'> = {
      id: config.id,
      name: config.name ?? config.id,
      api: 'openai-responses',
      provider: provider.id,
      baseUrl: provider.baseUrl.replace(/\/$/, ''),
      reasoning: config.reasoning,
      input,
      contextWindow: config.contextWindow,
      maxTokens: config.maxOutputTokens,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
    }
    const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(Math.min(provider.timeoutMs, 30000))])
    const stream = streamSimple(
      model,
      normalizeContext({ messages: [{ role: 'user', content: 'Reply with OK.', timestamp: Date.now() }] }),
      {
        apiKey: key || 'unused',
        headers: mergeHeaders(defaults, provider.headers, config.headers),
        signal: requestSignal,
        maxRetries: 0,
        timeoutMs: Math.min(provider.timeoutMs, 30000),
        onPayload(payload) {
          return {
            ...applyBody(payload, mergeBody(provider.body, config.body)),
            max_output_tokens: Math.min(config.maxOutputTokens, 256)
          }
        }
      }
    )
    const result = await stream.result()
    const ok = result.stopReason !== 'error' && result.stopReason !== 'aborted'
    let text = result.content
      .filter((part) => {
        return part.type === 'text'
      })
      .map((part) => {
        return part.text
      })
      .join('')
      .slice(0, 2000)
    if (!ok) {
      text = redactProviderError(result.errorMessage ?? '请求失败', provider)
    }
    return {
      ok,
      model: modelId,
      durationMs: performance.now() - started,
      text: redactProviderError(text, provider),
      status: result.stopReason,
      usage: {
        input: result.usage.input + result.usage.cacheRead + result.usage.cacheWrite,
        output: result.usage.output,
        cacheRead: result.usage.cacheRead
      }
    }
  } catch (error) {
    return {
      ok: false,
      model: modelId,
      durationMs: performance.now() - started,
      text: redactProviderError(error, provider),
      status: 'error',
      usage: { input: 0, output: 0, cacheRead: 0 }
    }
  }
}

async function readLimitedText(response: Response, limit: number) {
  const reader = response.body?.getReader()
  if (!reader) {
    throw new Error('模型列表响应为空。')
  }
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) {
        break
      }
      size += chunk.value.length
      if (size > limit) {
        throw new Error('模型列表过大，请手动添加模型。')
      }
      chunks.push(chunk.value)
    }
  } finally {
    await reader.cancel().catch(() => {})
  }
  return new TextDecoder().decode(Buffer.concat(chunks))
}
