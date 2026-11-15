import { mkdir } from "node:fs/promises"
import { join } from "node:path"

const sourceDir = join(import.meta.dir, "src")
const outdir = process.env.WEB_DIST_DIR ?? join(import.meta.dir, "dist")
await mkdir(outdir, { recursive: true })
const result = await Bun.build({
  entrypoints: [join(sourceDir, "app.ts")],
  outdir,
  target: "browser",
  minify: true,
  sourcemap: "external"
})
if (!result.success) {
  for (const log of result.logs) {
    console.error(log)
  }
  process.exit(1)
}
const indexHtml = await Bun.file(join(sourceDir, "index.html")).text()
await Bun.write(
  join(outdir, "index.html"),
  indexHtml.replace(
    '<script type="module" src="/app.js"></script>',
    '<script src="/config.js"></script><script type="module" src="/app.js"></script>'
  )
)
await Bun.write(
  join(outdir, "config.js"),
  `globalThis.__PI_IM_BOT_CONFIG__=${JSON.stringify({ apiOrigin: process.env.BOT_PUBLIC_ORIGIN ?? "" })};\n`
)
for (const [target, source] of [
  ["styles.css", "styles.css"],
  ["providers.css", "providers/styles.css"],
  ["plugins.css", "plugins/styles.css"]
] as const) {
  await Bun.write(join(outdir, target), await Bun.file(join(sourceDir, source)).text())
}
console.log(`Built workbench: ${outdir}`)
