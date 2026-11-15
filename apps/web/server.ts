import { stat } from "node:fs/promises"
import { extname, join, normalize } from "node:path"
import { z } from "zod"

const root = join(import.meta.dir, "dist")
const port = z.coerce
  .number()
  .int()
  .min(1)
  .max(65535)
  .parse(process.env.WEB_PORT ?? 3000)
const publicOrigin = new URL(process.env.BOT_PUBLIC_ORIGIN ?? "http://localhost:19335")
if (!["http:", "https:"].includes(publicOrigin.protocol) || publicOrigin.username || publicOrigin.password) {
  throw new Error("BOT_PUBLIC_ORIGIN must be an HTTP(S) origin without credentials")
}
publicOrigin.pathname = ""
publicOrigin.search = ""
publicOrigin.hash = ""
const configuration = `globalThis.__PI_IM_BOT_CONFIG__=${JSON.stringify({ apiOrigin: publicOrigin.origin })};\n`
const mime: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2"
}

const server = Bun.serve({
  hostname: process.env.WEB_HOST ?? "0.0.0.0",
  port,
  async fetch(request) {
    const path = new URL(request.url).pathname
    if (path === "/health") {
      return Response.json({ ok: true, service: "pi-im-bot-web" })
    }
    if (path === "/config.js") {
      return new Response(configuration, { headers: { "content-type": "text/javascript; charset=utf-8" } })
    }
    const relative = path === "/" ? "index.html" : normalize(decodeURIComponent(path)).replace(/^[/\\]+/, "")
    if (relative.split(/[/\\]/).includes("..")) {
      return new Response("Invalid path", { status: 400 })
    }
    const file = join(root, relative)
    const fileStat = await stat(file).catch(() => undefined)
    if (!fileStat?.isFile()) {
      return new Response("Not found", { status: 404 })
    }
    return new Response(Bun.file(file), {
      headers: { "content-type": mime[extname(file)] ?? "application/octet-stream" }
    })
  }
})
console.log(`Pi IM Bot workbench: http://localhost:${server.port}`)
console.log(`Bot API: ${publicOrigin.origin}`)
