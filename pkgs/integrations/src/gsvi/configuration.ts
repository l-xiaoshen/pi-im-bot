import { z } from 'zod'
import { GsviServiceSchema, type GsviService } from './schema'
const ResourceSecretPlaceholder = '__PI_IM_BOT_SECRET_PRESERVED__'

export const GsviDraftSchema = GsviServiceSchema.omit({ url: true }).extend({ url: z.string().default('') })
export const GsviViewSchema = GsviServiceSchema.omit({ url: true }).extend({
  endpoint: z.string(),
  state: z.enum(['disabled', 'configured'])
})
export const SaveGsviSchema = z.object({ revision: z.string(), service: GsviDraftSchema }).strict()
export type GsviDraft = z.infer<typeof GsviDraftSchema>
export type GsviView = z.infer<typeof GsviViewSchema>

export function gsviPublic(service: GsviService): GsviView {
  const { url, headers, downloadHeaders, apiKey, nativeRequestHeaders, nativeDownloadHeaders, ...rest } =
    service
  let state: GsviView['state'] = 'configured'
  if (!service.enabled) {
    state = 'disabled'
  }
  function hidden(values: Record<string, string>) {
    return Object.fromEntries(
      Object.keys(values).map((key) => {
        return [key, ResourceSecretPlaceholder]
      })
    )
  }
  const result: GsviView = {
    ...rest,
    endpoint: url,
    state,
    headers: hidden(headers),
    downloadHeaders: hidden(downloadHeaders)
  }
  if (apiKey) {
    result.apiKey = ResourceSecretPlaceholder
  }
  if (nativeRequestHeaders) {
    result.nativeRequestHeaders = hidden(nativeRequestHeaders)
  }
  if (nativeDownloadHeaders) {
    result.nativeDownloadHeaders = hidden(nativeDownloadHeaders)
  }
  return result
}

export function gsviFromDraft(draft: GsviDraft, previous?: GsviService) {
  function restore(values: Record<string, string>, saved: Record<string, string> = {}) {
    return Object.fromEntries(
      Object.entries(values).map(([key, value]) => {
        if (value !== ResourceSecretPlaceholder) {
          return [key, value]
        }
        if (saved[key] !== undefined) {
          return [key, saved[key]]
        }
        const old = Object.entries(saved).find(([name]) => {
          return name.toLowerCase() === key.toLowerCase()
        })
        if (!old) {
          throw new Error('Header 占位没有可保留的值')
        }
        return [key, old[1]]
      })
    )
  }
  let apiKey = draft.apiKey
  if (apiKey === ResourceSecretPlaceholder) {
    apiKey = previous?.apiKey
  }
  if (apiKey === undefined) {
    apiKey = previous?.apiKey
  }
  let nativeRequestHeaders: GsviService['nativeRequestHeaders']
  let nativeDownloadHeaders: GsviService['nativeDownloadHeaders']
  if (draft.nativeRequestHeaders !== undefined || previous?.nativeRequestHeaders !== undefined) {
    nativeRequestHeaders = restore(
      draft.nativeRequestHeaders ?? previous?.nativeRequestHeaders ?? {},
      previous?.nativeRequestHeaders
    )
  }
  if (draft.nativeDownloadHeaders !== undefined || previous?.nativeDownloadHeaders !== undefined) {
    nativeDownloadHeaders = restore(
      draft.nativeDownloadHeaders ?? previous?.nativeDownloadHeaders ?? {},
      previous?.nativeDownloadHeaders
    )
  }
  return GsviServiceSchema.parse({
    ...draft,
    url: draft.url || previous?.url,
    headers: restore(draft.headers, previous?.headers),
    downloadHeaders: restore(draft.downloadHeaders, previous?.downloadHeaders),
    apiKey,
    nativeRequestHeaders,
    nativeDownloadHeaders
  })
}
