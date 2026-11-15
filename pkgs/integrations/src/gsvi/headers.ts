import type { GsviService } from './schema'
/** Native source precedence: API key first, explicit headers override case-insensitively. */
export function gsviServiceHeaders(service: GsviService) {
  const headers = new Headers()
  if (service.apiKey) {
    headers.set('Authorization', 'Bearer ' + service.apiKey)
  }
  for (const [name, value] of Object.entries(service.nativeRequestHeaders ?? service.headers)) {
    headers.set(name, value)
  }
  return headers
}
