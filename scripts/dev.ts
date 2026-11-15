export {}

const build = Bun.spawnSync(["bun", "run", "build:web"], {
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit"
})
if (build.exitCode !== 0) {
  process.exit(build.exitCode)
}

const env = {
  ...process.env,
  BOT_PUBLIC_ORIGIN: process.env.BOT_PUBLIC_ORIGIN ?? "http://localhost:19335",
  BOT_WEB_ORIGINS: process.env.BOT_WEB_ORIGINS ?? "http://localhost:3000"
}
const children = [
  Bun.spawn(["bun", "run", "dev:bot"], { env, stdin: "inherit", stdout: "inherit", stderr: "inherit" }),
  Bun.spawn(["bun", "run", "dev:web"], { env, stdin: "inherit", stdout: "inherit", stderr: "inherit" })
]
let closing = false
async function shutdown(code = 0) {
  if (closing) {
    return
  }
  closing = true
  for (const child of children) {
    child.kill("SIGTERM")
  }
  await Promise.all(children.map((child) => child.exited))
  process.exit(code)
}
process.on("SIGINT", () => void shutdown())
process.on("SIGTERM", () => void shutdown())
await Promise.race(
  children.map(async (child) => {
    const code = await child.exited
    if (!closing) {
      await shutdown(code)
    }
  })
)
