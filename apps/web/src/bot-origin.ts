declare global {
  // Injected by apps/web/server.ts; an empty origin supports same-origin static hosting.
  var __PI_IM_BOT_CONFIG__: { apiOrigin?: string } | undefined
}

const configuredOrigin = globalThis.__PI_IM_BOT_CONFIG__?.apiOrigin ?? ""
const defaultOrigin = configuredOrigin || globalThis.location?.origin || "http://localhost:19335"

export function botApiUrl(path: string, origin = defaultOrigin) {
  if (!path.startsWith("/")) {
    throw new Error(`Bot API paths must be absolute: ${path}`)
  }
  return new URL(path, new URL(origin)).toString()
}

export function botWebSocketUrl(path: string, origin = defaultOrigin) {
  const url = new URL(botApiUrl(path, origin))
  if (url.protocol === "https:") {
    url.protocol = "wss:"
  } else {
    url.protocol = "ws:"
  }
  return url.toString()
}
