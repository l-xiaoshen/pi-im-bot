import { z } from 'zod'
import type { ArtifactStore } from '@pi-im-bot/artifacts/store'
import { RunLimiter } from '@pi-im-bot/support/limiter'
import { GsviModelsSchema, type GsviInput, type GsviResult, type GsviService } from './schema'
import { GsviHttpError, gsviRequest } from './http'
import { validateWav } from './wav'
import { gsviDeadline } from './deadline'

const requests = new RunLimiter(2)
const SynthesisResponseSchema = z.object({
  msg: z.string(),
  audio_url: z.string().min(1)
})

export async function callGsvi(
  service: GsviService,
  input: GsviInput,
  artifacts: ArtifactStore,
  parent: AbortSignal,
  authorize: () => void
): Promise<GsviResult> {
  const deadline = gsviDeadline(parent, service.timeoutMs)
  const signal = deadline.signal
  let release = () => {}
  let submitted = false
  let accepted = false
  try {
    release = await requests.acquire(signal)
    authorize()
    const baseText = new URL(service.url).toString().replace(/\/$/u, '')
    const base = new URL(baseText + '/')
    if (input.action === 'voices') {
      const response = await gsviRequest(
        service,
        new URL(baseText + '/models/' + input.version),
        signal,
        artifacts.maximumFileBytes
      )
      const models = GsviModelsSchema.parse(
        JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(response.bytes))
      ).models
      authorize()
      signal.throwIfAborted()
      return { status: 'voices', models }
    }
    const payload: Record<string, string> = {
      version: input.version,
      model_name: input.voice,
      text: input.text,
      text_lang: input.textLang,
      emotion: input.emotion,
      dl_url: baseText,
      media_type: 'wav'
    }
    if (input.promptTextLang) {
      payload.prompt_text_lang = input.promptTextLang
    }
    signal.throwIfAborted()
    authorize()
    submitted = true
    const response = await gsviRequest(
      service,
      new URL(baseText + '/infer_single'),
      signal,
      artifacts.maximumFileBytes,
      payload
    )
    const result = SynthesisResponseSchema.safeParse(
      JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(response.bytes))
    )
    if (!result.success) {
      throw new GsviHttpError('remote_unknown')
    }
    if (result.data.msg !== '合成成功') {
      throw new GsviHttpError('unavailable')
    }
    accepted = true
    authorize()
    const audio = await gsviRequest(
      service,
      new URL(result.data.audio_url, base),
      signal,
      artifacts.maximumFileBytes,
      undefined,
      true
    )
    if (
      !service.sourceCompatibleDownloads &&
      !['audio/wav', 'audio/x-wav', 'audio/wave', 'application/octet-stream'].includes(audio.mimeType ?? '')
    ) {
      throw new GsviHttpError('protocol')
    }
    if (service.sourceCompatibleDownloads) {
      if (
        audio.bytes.length < 12 ||
        audio.bytes.toString('ascii', 0, 4) !== 'RIFF' ||
        audio.bytes.toString('ascii', 8, 12) !== 'WAVE'
      ) {
        throw new GsviHttpError('protocol')
      }
    } else {
      validateWav(audio.bytes)
    }
    signal.throwIfAborted()
    authorize()
    const artifact = await artifacts.save('speech.wav', 'audio/wav', 'service:' + service.id, audio.bytes)
    signal.throwIfAborted()
    authorize()
    return { status: 'audio', artifactId: artifact.id, bytes: artifact.bytes, mimeType: 'audio/wav' }
  } catch (error) {
    parent.throwIfAborted()
    // Authorization errors propagate, never become successful text fallback.
    authorize()
    let code: 'unavailable' | 'protocol' | 'budget' | 'remote_unknown' = 'protocol'
    if (error instanceof GsviHttpError) {
      code = error.code
    } else if (signal.aborted) {
      code = 'budget'
    }
    if (submitted && !accepted && !(error instanceof GsviHttpError && error.code === 'unavailable')) {
      code = 'remote_unknown'
    }
    if (code === 'remote_unknown') {
      return { status: 'unknown', code, message: '合成已提交但远端结果未确认，未自动重试。' }
    }
    return { status: 'failed', code, message: '语音服务未完成，保留文字。' }
  } finally {
    release()
    deadline.close()
  }
}
