export function parseWebOrigins(value?: string) {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const origin = new URL(item)
      if (!["http:", "https:"].includes(origin.protocol) || origin.username || origin.password) {
        throw new Error("BOT_WEB_ORIGINS entries must be HTTP(S) origins without credentials")
      }
      return origin.origin
    })
}

export function webOriginAllowed(origin: string | null, allowedOrigins: readonly string[]) {
  return !origin || allowedOrigins.includes(origin)
}
